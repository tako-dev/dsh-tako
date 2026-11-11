/**
 * Host half of the Web UI: the Models-page "Sign in to Tako" button and the
 * Tako console panel's four routes.
 *
 * All routes are exact Fetch routes on the Web connection, behind the browser
 * authentication fence; only the owner reaches them. `/api/tako.login` runs
 * the loopback sign-in on the dsh host; the console routes report the stored
 * key (masked), revoke it on logout, expose the synced model catalog, and
 * compare the installed version with npm's `dist-tags.latest` (POST installs
 * that latest into the profile; restart dsh to load it). Issued and stored
 * keys go through the installation's own `ctx.credentials`, which also tells
 * the Models page to refresh. A resolved key value never leaves the host:
 * status answers carry `maskKey()` output only.
 * @module dsh-tako/web
 */

import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type { TakoModel, TakoModelCard } from './catalog.ts'
import type { BrowserLoginHandle, BrowserLoginOptions, TakoIdentity } from './login.ts'
import { defaultDeviceName, fetchMe, fetchUserQuota, maskKey, revokeKey, startBrowserLogin, TakoLoginError, type TakoPlanQuota } from './login.ts'
import { refreshTakoSearchPin } from './search.ts'
import { normalizeOrigin } from './shared.ts'
import { createUpdateService, profileFromPluginPath, type PluginManagerLike } from './upgrade.ts'

export {
  createUpdateService,
  pluginVersion,
  UPDATE_CACHE_MS,
  UPDATE_ERROR_CACHE_MS,
  type UpdateAnswer,
  type UpdateServiceOptions,
} from './upgrade.ts'

/** Route path below `/api`; the browser calls the relative `api/tako.login`. */
export const LOGIN_ROUTE = '/api/tako.login'
/** Console route: whether a key is stored (masked) plus the account behind it. */
export const STATUS_ROUTE = '/api/tako.status'
/** Console route: revoke the stored key on Tako and remove it from dsh credentials. */
export const LOGOUT_ROUTE = '/api/tako.logout'
/** Console route: the model catalog the plugin last synced, and when it refreshes. */
export const CATALOG_ROUTE = '/api/tako.catalog'
/** Console route: GET compares with npm latest; POST installs it (restart to load). */
export const UPDATE_ROUTE = '/api/tako.update'
/**
 * Console route: paste a key instead of signing in with the browser. POST
 * `{ key }` verifies it against `/api/desktop/me` before storing it in the
 * profile's credentials; POST `{ action: 'clear' }` removes a file-sourced key
 * without revoking it on Tako.
 */
export const KEY_ROUTE = '/api/tako.key'
/** Console route: the stored key's own recent request log on Tako. */
export const LOGS_ROUTE = '/api/tako.logs'
/** Console route: token quota detail plus today's spend and per-model usage. */
export const USAGE_ROUTE = '/api/tako.usage'
/** Console route: the site's public announcements; no key is involved. */
export const NOTICE_ROUTE = '/api/tako.notice'
/** Console route: read or patch the plugin's own settings row and the search pin. */
export const CONFIG_ROUTE = '/api/tako.config'
/** Console route: ask the sync loop for an immediate catalog refresh. */
export const SYNC_ROUTE = '/api/tako.sync'
/** Browser/Host console protocol implemented by this running plugin instance. */
export const CONSOLE_API_VERSION = 2

/** Same grammar the settings controller enforces for credential references. */
const CREDENTIAL_REF = /^[A-Za-z_][A-Za-z0-9_]*$/u

interface FetchRoute {
  path: string
  methods: readonly ('GET' | 'HEAD' | 'POST')[]
  requestBody: 'buffered' | 'streaming'
  fetch: (request: Request) => Promise<Response>
}
/** The slice of `ctx.connection` this module uses. */
export interface ConnectionLike {
  fetch: { register: (route: FetchRoute) => () => Promise<void> }
}
/** The slice of `ctx.credentials` the sign-in button uses. */
export interface CredentialSetter {
  set: (ref: never, value: string) => Promise<void>
}
/** The extra slice of `ctx.credentials` the console routes use. */
export interface CredentialStore {
  resolve: (ref: string) => Promise<{ value: string, source: string } | undefined>
  unset: (ref: string) => Promise<void>
}

/** What a GET returns. */
export type LoginStatus =
  | { status: 'idle' }
  | { status: 'pending', id: string, url: string, redirectUri: string, expiresAt: number }
  | { status: 'success', id: string, user?: string, plan?: string, key: string, credential: string }
  | { status: 'error', id: string, code: string, message: string }

export interface LoginServiceOptions {
  baseURL: string
  apiKeyEnv: string
  credentials: () => CredentialSetter | undefined
  logger: { info: (...args: unknown[]) => void, warn: (...args: unknown[]) => void }
  /** Seams for tests. */
  startLogin?: (options: BrowserLoginOptions) => Promise<BrowserLoginHandle>
  timeoutMs?: number
  fetch?: typeof fetch
  /** After a key is stored, so search can pin the Tako provider. */
  onCredentialChange?: () => void
}

const json = (body: unknown, status = 200): Response => Response.json(body, { status, headers: { 'cache-control': 'no-store' } })

/**
 * One sign-in at a time per dsh host: starting again cancels the pending one.
 * Returns the route handler and a disposer that cancels any pending sign-in.
 */
export function createLoginService(options: LoginServiceOptions): { handle: (request: Request) => Promise<Response>, dispose: () => void } {
  let current: { id: string, handle: BrowserLoginHandle, status: LoginStatus } | undefined
  let counter = 0

  const start = async (): Promise<Response> => {
    const credentials = options.credentials()
    if (credentials === undefined) return json({ status: 'error', code: 'no-credentials', message: 'this dsh profile mounts no credential service' }, 503)
    if (!CREDENTIAL_REF.test(options.apiKeyEnv)) return json({ status: 'error', code: 'bad-config', message: `invalid apiKeyEnv ${JSON.stringify(options.apiKeyEnv)}` }, 500)
    current?.handle.cancel()
    const id = `${Date.now().toString(36)}-${(++counter).toString(36)}`
    const loginOptions: BrowserLoginOptions = {
      origin: normalizeOrigin(options.baseURL),
      deviceName: defaultDeviceName(),
      onGrant: async grant => {
        await credentials.set(options.apiKeyEnv as never, grant.key)
        options.onCredentialChange?.()
      },
    }
    if (options.timeoutMs !== undefined) loginOptions.timeoutMs = options.timeoutMs
    if (options.fetch !== undefined) loginOptions.fetch = options.fetch
    let handle: BrowserLoginHandle
    try {
      handle = await (options.startLogin ?? startBrowserLogin)(loginOptions)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      return json({ status: 'error', id, code: error instanceof TakoLoginError ? error.code : 'listen-failed', message }, 500)
    }
    const expiresAt = Date.now() + (options.timeoutMs ?? 5 * 60_000)
    const entry: { id: string, handle: BrowserLoginHandle, status: LoginStatus } = {
      id,
      handle,
      status: { status: 'pending', id, url: handle.authorizeUrl, redirectUri: handle.redirectUri, expiresAt },
    }
    current = entry
    handle.result.then(grant => {
      const done: LoginStatus = { status: 'success', id, key: maskKey(grant.key), credential: options.apiKeyEnv }
      if (grant.userName !== undefined) done.user = grant.userName
      if (grant.planName !== undefined) done.plan = grant.planName
      entry.status = done
      options.logger.info('Tako sign-in from the Models page stored key %s as %s', maskKey(grant.key), options.apiKeyEnv)
    }, (error: unknown) => {
      const code = error instanceof TakoLoginError ? error.code : 'failed'
      entry.status = { status: 'error', id, code, message: error instanceof Error ? error.message : String(error) }
      if (code !== 'cancelled') options.logger.warn('Tako sign-in from the Models page failed: %s', entry.status.message)
    })
    return json(entry.status)
  }

  const handle = async (request: Request): Promise<Response> => {
    if (request.method === 'POST') {
      let body: { action?: unknown } = {}
      try {
        const text = await request.text()
        if (text.trim() !== '') body = JSON.parse(text) as { action?: unknown }
      } catch {
        return json({ status: 'error', code: 'bad-request', message: 'invalid JSON body' }, 400)
      }
      if (body.action === 'cancel') {
        current?.handle.cancel()
        return json(current?.status ?? { status: 'idle' })
      }
      if (body.action !== undefined && body.action !== 'start') return json({ status: 'error', code: 'bad-request', message: 'unknown action' }, 400)
      return start()
    }
    const id = new URL(request.url).searchParams.get('id')
    if (current === undefined || (id !== null && id !== current.id)) return json({ status: 'idle' })
    return json(current.status)
  }

  return { handle, dispose: () => { current?.handle.cancel(); current = undefined } }
}

/** The host plugin manager, if this profile mounted one. Read at POST time. */
function pluginManagerOf(ctx: Context): PluginManagerLike | undefined {
  try {
    const fromGet = (ctx as unknown as { get?: (name: string) => unknown }).get?.('pluginManager')
    if (fromGet !== undefined && fromGet !== null) return fromGet as PluginManagerLike
  } catch { /* not mounted */ }
  try {
    return (ctx as unknown as { pluginManager?: PluginManagerLike }).pluginManager
  } catch {
    return undefined
  }
}

/** Mount the routes while the Web connection and the credential service are both up. */
export function applyWeb(ctx: Context, config: { baseURL: string, apiKeyEnv: string }, web: { catalog: () => CatalogState, requestSync?: () => void } = { catalog: () => emptyCatalogState() }): void {
  ctx.inject(['connection', 'credentials'], inner => {
    const connection = (inner as unknown as { connection: ConnectionLike }).connection
    const onCredentialChange = (): void => {
      void refreshTakoSearchPin(ctx, config).catch((error: unknown) => {
        inner.logger.warn('could not refresh Tako search provider pin: %s', error instanceof Error ? error.message : String(error))
      })
    }
    const service = createLoginService({
      baseURL: config.baseURL,
      apiKeyEnv: config.apiKeyEnv,
      credentials: () => (inner as unknown as { credentials?: CredentialSetter }).credentials,
      logger: inner.logger,
      onCredentialChange,
    })
    const consoleService = createConsoleService({
      baseURL: config.baseURL,
      apiKeyEnv: config.apiKeyEnv,
      credentials: () => (inner as unknown as { credentials?: CredentialSetter & CredentialStore }).credentials,
      catalog: web.catalog,
      logger: inner.logger,
      onCredentialChange,
      settings: ctx.settings as ConsoleSettings | undefined,
      requestSync: web.requestSync,
    })
    const updateService = createUpdateService({
      logger: inner.logger,
      pluginManager: () => pluginManagerOf(ctx),
      profile: () => profileFromPluginPath(fileURLToPath(import.meta.url)) ?? { name: 'web' },
    })
    inner.effect(() => {
      const unregisters = [
        connection.fetch.register({
          path: LOGIN_ROUTE,
          methods: ['GET', 'POST'],
          requestBody: 'buffered',
          fetch: request => service.handle(request),
        }),
        connection.fetch.register({
          path: STATUS_ROUTE,
          methods: ['GET'],
          requestBody: 'buffered',
          fetch: () => consoleService.handleStatus(),
        }),
        connection.fetch.register({
          path: LOGOUT_ROUTE,
          methods: ['POST'],
          requestBody: 'buffered',
          fetch: () => consoleService.handleLogout(),
        }),
        connection.fetch.register({
          path: CATALOG_ROUTE,
          methods: ['GET'],
          requestBody: 'buffered',
          fetch: () => consoleService.handleCatalog(),
        }),
        connection.fetch.register({
          path: KEY_ROUTE,
          methods: ['POST'],
          requestBody: 'buffered',
          fetch: request => consoleService.handleKey(request),
        }),
        connection.fetch.register({
          path: UPDATE_ROUTE,
          methods: ['GET', 'POST'],
          requestBody: 'buffered',
          fetch: request => request.method === 'POST' ? updateService.handleInstall() : updateService.handleUpdate(),
        }),
        connection.fetch.register({
          path: LOGS_ROUTE,
          methods: ['GET'],
          requestBody: 'buffered',
          fetch: request => consoleService.handleLogs(request),
        }),
        connection.fetch.register({
          path: USAGE_ROUTE,
          methods: ['GET'],
          requestBody: 'buffered',
          fetch: () => consoleService.handleUsage(),
        }),
        connection.fetch.register({
          path: NOTICE_ROUTE,
          methods: ['GET'],
          requestBody: 'buffered',
          fetch: () => consoleService.handleNotice(),
        }),
        connection.fetch.register({
          path: CONFIG_ROUTE,
          methods: ['GET', 'POST'],
          requestBody: 'buffered',
          fetch: request => consoleService.handleConfig(request),
        }),
        connection.fetch.register({
          path: SYNC_ROUTE,
          methods: ['POST'],
          requestBody: 'buffered',
          fetch: () => consoleService.handleSync(),
        }),
      ]
      return async () => {
        service.dispose()
        for (const unregister of unregisters) await unregister()
      }
    })
  })
}

// ---------------------------------------------------------------- console routes

/**
 * Instance-owned sync progress and the last successfully written model list,
 * including a fallback seed. Read by {@link CATALOG_ROUTE}.
 */
export interface CatalogState {
  /** The filtered catalog of the last successful sync; empty before the first. */
  models: readonly TakoModel[]
  /** Display-only plaza cards paired with `models`; absent on hosts synced before cards existed. */
  cards?: readonly TakoModelCard[]
  /** When that sync finished, in epoch ms; `null` before the first. */
  lastSyncAt: number | null
  /** Next recovery or regular refresh in epoch ms; `null` when no further attempt is scheduled. */
  nextSyncAt: number | null
  /** Current operation phase, distinct from whether an older model list exists. */
  status?: 'syncing' | 'retrying' | 'ready' | 'failed'
  /** Lifetime count of attempts within this plugin instance. */
  attempts?: number
  /** Configured regular refresh interval, even before a successful sync. */
  refreshIntervalMs?: number
  /** Safe stage-specific error; never includes remote bodies or settings values. */
  lastError?: { code: 'directory-unavailable' | 'settings-not-ready' | 'write-failed' | 'runtime-transaction' | 'read-only' | 'empty-catalog', message: string, at: number } | null
}

/** A catalog state that has never seen a sync. */
export function emptyCatalogState(): CatalogState {
  return { models: [], lastSyncAt: null, nextSyncAt: null }
}

/**
 * Tako's quota unit, exactly as the site itself converts: its public status
 * (`GET /api/status`, no key) answers `quota_per_unit: 500000` together with
 * `quota_display_type: 'USD'`, and the official docs page
 * <https://tako.shiroha.tech/docs/account/balance> spells out
 * 「500000 内部额度 = 1 美元」 — 500,000 internal points = 1 USD — with the
 * console displaying that division. The `*Usd` fields below are it; the raw
 * points stay alongside them.
 */
export const QUOTA_PER_UNIT = 500_000

/**
 * The account fields the console page shows: the raw `/api/desktop/me` view
 * plus its USD conversion at the site's own rate.
 */
export type ConsoleIdentity = Pick<TakoIdentity, 'userName' | 'planName' | 'quotaRemain' | 'quotaUsed'> & {
  /** `quotaRemain / QUOTA_PER_UNIT`; present exactly when {@link TakoIdentity.quotaRemain} is. */
  quotaRemainUsd?: number
  /** `quotaUsed / QUOTA_PER_UNIT`; present exactly when {@link TakoIdentity.quotaUsed} is. */
  quotaUsedUsd?: number
}

export type { TakoPlanQuota }

/** How long a `whoami` answer stays fresh, so opening the panel does not hit Tako each time. */
export const STATUS_CACHE_MS = 45_000

/** The slice of the installation's settings service the config route uses. */
export interface ConsoleSettings {
  describe: () => readonly { ns: string, value?: unknown, user?: unknown }[]
  mutate: (ns: string, ops: readonly { op: 'set', path: readonly string[], value: unknown }[]) => Promise<void>
  writable?: boolean
}

export interface ConsoleServiceOptions {
  baseURL: string
  apiKeyEnv: string
  credentials: () => (CredentialSetter & CredentialStore) | undefined
  catalog: () => CatalogState
  logger: { info: (...args: unknown[]) => void, warn: (...args: unknown[]) => void }
  /** Seams for tests. */
  fetch?: typeof fetch
  statusCacheMs?: number
  now?: () => number
  /** After a file-source key is unset, so search can restore the bundle default. */
  onCredentialChange?: () => void
  /** The settings service; absent on hosts where it was not injected. */
  settings?: ConsoleSettings
  /** Kick an immediate catalog sync when the console asks for one. */
  requestSync?: () => void
}

interface StatusCache {
  fingerprint: string
  at: number
  me: ConsoleIdentity | null
  meError: string | undefined
  plan: TakoPlanQuota | null
  planError: string | undefined
}

/**
 * The console panel's route handlers. One service instance per Web
 * connection; the resolved key only travels as `maskKey()` output.
 */
export function createConsoleService(options: ConsoleServiceOptions): {
  handleStatus: () => Promise<Response>
  handleLogout: () => Promise<Response>
  handleCatalog: () => Promise<Response>
  handleKey: (request: Request) => Promise<Response>
  handleLogs: (request: Request) => Promise<Response>
  handleUsage: () => Promise<Response>
  handleNotice: () => Promise<Response>
  handleConfig: (request: Request) => Promise<Response>
  handleSync: () => Promise<Response>
} {
  const origin = normalizeOrigin(options.baseURL)
  const cacheMs = options.statusCacheMs ?? STATUS_CACHE_MS
  const now = options.now ?? Date.now
  let cache: StatusCache | undefined

  const handleStatus = async (): Promise<Response> => {
    const credentials = options.credentials()
    if (credentials === undefined) return json({ consoleApiVersion: CONSOLE_API_VERSION, configured: false })
    let current: { value: string, source: string } | undefined
    try {
      current = await credentials.resolve(options.apiKeyEnv)
    } catch (error: unknown) {
      options.logger.warn('resolving %s failed: %s', options.apiKeyEnv, error instanceof Error ? error.message : String(error))
      return json({ consoleApiVersion: CONSOLE_API_VERSION, configured: false })
    }
    if (current === undefined) return json({ consoleApiVersion: CONSOLE_API_VERSION, configured: false })
    const maskedKey = maskKey(current.value)
    const fingerprint = createHash('sha256').update(current.value).digest('hex')
    // A display mask is not an account identity. Neither the key nor its fingerprint leaves the host.
    if (cache !== undefined && cache.fingerprint === fingerprint && now() - cache.at < cacheMs) {
      return json({
        consoleApiVersion: CONSOLE_API_VERSION,
        configured: true, origin, baseURL: origin, maskedKey, credential: options.apiKeyEnv, me: cache.me, plan: cache.plan,
        ...(cache.meError === undefined ? {} : { meError: cache.meError }),
        ...(cache.planError === undefined ? {} : { planError: cache.planError }),
      })
    }
    let me: ConsoleIdentity | null = null
    let meError: string | undefined
    let plan: TakoPlanQuota | null = null
    let planError: string | undefined
    try {
      me = identityOf(await fetchMe(origin, current.value, options.fetch))
    } catch (error: unknown) {
      meError = error instanceof Error ? error.message : String(error)
    }
    try {
      plan = await fetchUserQuota(origin, current.value, options.fetch)
    } catch (error: unknown) {
      planError = error instanceof Error ? error.message : String(error)
    }
    cache = { fingerprint, at: now(), me, meError, plan, planError }
    return json({
      consoleApiVersion: CONSOLE_API_VERSION,
      configured: true, origin, baseURL: origin, maskedKey, credential: options.apiKeyEnv, me, plan,
      ...(meError === undefined ? {} : { meError }),
      ...(planError === undefined ? {} : { planError }),
    })
  }

  const handleLogout = async (): Promise<Response> => {
    const credentials = options.credentials()
    if (credentials === undefined) return json({ ok: true, action: 'not-configured' })
    let current: { value: string, source: string } | undefined
    try {
      current = await credentials.resolve(options.apiKeyEnv)
    } catch (error: unknown) {
      return json({ ok: false, error: `could not read the credential: ${error instanceof Error ? error.message : String(error)}` }, 500)
    }
    if (current === undefined) return json({ ok: true, action: 'not-configured' })
    cache = undefined
    // Same rule as the logout CLI: a key from the environment is not ours to revoke or delete.
    if (current.source !== 'file') return json({ ok: true, action: 'external', source: current.source })
    let revoked = false
    let warning: string | undefined
    try {
      await revokeKey(origin, current.value, options.fetch)
      revoked = true
      options.logger.info('Tako console revoked %s on %s', maskKey(current.value), origin)
    } catch (error: unknown) {
      warning = `could not revoke ${maskKey(current.value)} on Tako (${error instanceof Error ? error.message : String(error)}); removed it locally anyway`
      options.logger.warn('Tako console: %s', warning)
    }
    await credentials.unset(options.apiKeyEnv)
    options.onCredentialChange?.()
    return revoked
      ? json({ ok: true, action: 'revoked' })
      : json({ ok: true, action: 'removed', warning })
  }

  const handleCatalog = async (): Promise<Response> => {
    const state = options.catalog()
    return json({ consoleApiVersion: CONSOLE_API_VERSION, ...state, models: state.models.map(model => ({ ...model })) })
  }

  /**
   * Paste-a-key surface for hosts where the browser sign-in is inconvenient
   * (SSH, a remote dsh, a machine without a browser). The candidate key is
   * verified against Tako before it replaces the stored one, so a typo cannot
   * silently break the route; the value never comes back in the answer.
   */
  const handleKey = async (request: Request): Promise<Response> => {
    const credentials = options.credentials()
    if (credentials === undefined) return json({ ok: false, code: 'no-credentials', message: 'this dsh profile mounts no credential service' }, 503)
    if (!CREDENTIAL_REF.test(options.apiKeyEnv)) return json({ ok: false, code: 'bad-config', message: `invalid apiKeyEnv ${JSON.stringify(options.apiKeyEnv)}` }, 500)
    let body: { key?: unknown, action?: unknown } = {}
    try {
      const text = await request.text()
      if (text.trim() !== '') body = JSON.parse(text) as { key?: unknown, action?: unknown }
    } catch {
      return json({ ok: false, code: 'bad-request', message: 'invalid JSON body' }, 400)
    }

    if (body.action === 'clear') {
      let current: { value: string, source: string } | undefined
      try {
        current = await credentials.resolve(options.apiKeyEnv)
      } catch (error: unknown) {
        return json({ ok: false, code: 'read-failed', message: error instanceof Error ? error.message : String(error) }, 500)
      }
      if (current === undefined) return json({ ok: true, action: 'not-configured' })
      cache = undefined
      // An environment or .env key belongs to whoever set it there; the plugin does not delete it.
      if (current.source !== 'file') return json({ ok: true, action: 'external', source: current.source })
      await credentials.unset(options.apiKeyEnv)
      options.onCredentialChange?.()
      options.logger.info('Tako console removed key %s from %s', maskKey(current.value), options.apiKeyEnv)
      return json({ ok: true, action: 'removed' })
    }

    if (body.action !== undefined) return json({ ok: false, code: 'bad-request', message: 'unknown action' }, 400)
    const candidate = typeof body.key === 'string' ? body.key.trim() : ''
    if (candidate.length < 8 || candidate.length > 256 || !/^[\x21-\x7e]+$/u.test(candidate)) {
      return json({ ok: false, code: 'invalid-format', message: 'a Tako key is 8-256 printable ASCII characters' }, 400)
    }
    let me: ConsoleIdentity | null = null
    try {
      me = identityOf(await fetchMe(origin, candidate, options.fetch))
    } catch (error: unknown) {
      return json({ ok: false, code: 'invalid', message: error instanceof Error ? error.message : String(error) }, 401)
    }
    await credentials.set(options.apiKeyEnv as never, candidate)
    cache = undefined
    options.onCredentialChange?.()
    options.logger.info('Tako console stored key %s as %s', maskKey(candidate), options.apiKeyEnv)
    return json({ ok: true, maskedKey: maskKey(candidate), credential: options.apiKeyEnv, me })
  }

  /** The stored key's plaintext, or undefined when the console cannot answer authenticated routes. */
  const resolveKey = async (): Promise<{ value: string } | undefined> => {
    const credentials = options.credentials()
    if (credentials === undefined) return undefined
    try {
      return await credentials.resolve(options.apiKeyEnv)
    } catch (error: unknown) {
      options.logger.warn('resolving %s failed: %s', options.apiKeyEnv, error instanceof Error ? error.message : String(error))
      return undefined
    }
  }

  const fetchJson = async (url: string, init: RequestInit = {}): Promise<Record<string, unknown>> => {
    const response = await (options.fetch ?? fetch)(url, {
      ...init,
      headers: { accept: 'application/json', ...init.headers as Record<string, string> },
      signal: AbortSignal.timeout(20_000),
    })
    let body: Record<string, unknown> | undefined
    try {
      body = await response.json() as Record<string, unknown>
    } catch {
      body = undefined
    }
    if (!response.ok || body === undefined) throw new Error(`HTTP ${response.status}`)
    return body
  }

  const bearer = (key: string): RequestInit => ({ headers: { authorization: `Bearer ${key}` } })
  const post = (payload: unknown): RequestInit => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })

  /**
   * `GET /api/log/token` answers with this key's own recent requests; the
   * `other` blob and the user_* columns carry host internals and never reach
   * the page. The key itself stays on the host: it only rides the upstream
   * Authorization header.
   */
  const handleLogs = async (request: Request): Promise<Response> => {
    const current = await resolveKey()
    if (current === undefined) return json({ ok: false, code: 'not-configured' })
    const model = new URL(request.url).searchParams.get('model')
    try {
      const body = await fetchJson(`${origin}/api/log/token`, bearer(current.value))
      const rows = Array.isArray(body.data) ? body.data : []
      const logs = rows
        .filter((row): row is Record<string, unknown> => typeof row === 'object' && row !== null)
        .map(row => ({
          id: row.id,
          createdAt: row.created_at,
          type: row.type,
          modelName: row.model_name,
          promptTokens: row.prompt_tokens,
          completionTokens: row.completion_tokens,
          quota: row.quota,
          useTime: row.use_time,
          isStream: row.is_stream,
          requestId: row.request_id,
          channelName: row.channel_name,
          ip: row.ip,
          tokenName: row.token_name,
          group: row.group,
        }))
        .filter(row => model === null || model === '' || row.modelName === model)
      return json({ ok: true, logs })
    } catch (error: unknown) {
      return json({ ok: false, code: 'upstream', message: error instanceof Error ? error.message : String(error) }, 502)
    }
  }

  /**
   * Three independent views of the same key: `/api/usage/token` (quota,
   * model allowlist, expiry), and the apiStats `user-stats`/`user-model-stats`
   * aggregate (today's spend per model). Each leg degrades to its own error
   * field so one flaky endpoint does not blank the others.
   */
  const handleUsage = async (): Promise<Response> => {
    const current = await resolveKey()
    if (current === undefined) return json({ ok: false, code: 'not-configured' })
    const out: Record<string, unknown> = { ok: true }

    const usageToken = (async () => {
      const body = await fetchJson(`${origin}/api/usage/token`, bearer(current.value))
      const data = typeof body.data === 'object' && body.data !== null ? body.data as Record<string, unknown> : {}
      out.token = {
        name: data.name,
        granted: data.total_granted,
        used: data.total_used,
        available: data.total_available,
        grantedUsd: typeof data.total_granted === 'number' ? data.total_granted / QUOTA_PER_UNIT : undefined,
        usedUsd: typeof data.total_used === 'number' ? data.total_used / QUOTA_PER_UNIT : undefined,
        availableUsd: typeof data.total_available === 'number' ? data.total_available / QUOTA_PER_UNIT : undefined,
        unlimitedQuota: data.unlimited_quota,
        modelLimits: data.model_limits,
        modelLimitsEnabled: data.model_limits_enabled,
        expiresAt: data.expires_at,
      }
    })().catch((error: unknown) => { out.token = null; out.tokenError = error instanceof Error ? error.message : String(error) })

    const stats = (async () => {
      const idBody = await fetchJson(`${origin}/apiStats/api/get-key-id`, post({ apiKey: current.value }))
      const id = typeof idBody.data === 'object' && idBody.data !== null ? (idBody.data as Record<string, unknown>).id : undefined
      if (id === undefined) throw new Error('key-id returned no id')
      const daily = (async () => {
        const body = await fetchJson(`${origin}/apiStats/api/user-stats`, post({ apiId: String(id) }))
        const total = typeof body.data === 'object' && body.data !== null
          ? (body.data as Record<string, unknown>).usage : undefined
        const cost = typeof total === 'object' && total !== null
          ? (total as Record<string, unknown>).total : undefined
        const usd = typeof cost === 'object' && cost !== null ? (cost as Record<string, unknown>).cost : undefined
        if (typeof usd === 'number') out.dailyCostUsd = usd
      })().catch((error: unknown) => { out.statsError = error instanceof Error ? error.message : String(error) })
      const perModel = (async () => {
        const body = await fetchJson(`${origin}/apiStats/api/user-model-stats`, post({ apiId: String(id), period: 'daily' }))
        const rows = Array.isArray(body.data) ? body.data : []
        out.models = rows
          .filter((row): row is Record<string, unknown> => typeof row === 'object' && row !== null)
          .map(row => ({
            model: row.model,
            requests: row.requests,
            inputTokens: row.inputTokens,
            outputTokens: row.outputTokens,
            costUsd: typeof row.costs === 'object' && row.costs !== null ? (row.costs as Record<string, unknown>).total : undefined,
          }))
      })().catch((error: unknown) => { out.modelStatsError = error instanceof Error ? error.message : String(error) })
      await Promise.all([daily, perModel])
    })().catch((error: unknown) => {
      out.statsError = error instanceof Error ? error.message : String(error)
      out.modelStatsError = out.statsError
    })

    await Promise.all([usageToken, stats])
    return json(out)
  }

  /** Site announcements are public; cached briefly so opening the panel stays cheap. */
  let noticeCache: { at: number, announcements: { content: string, date?: string }[] } | undefined
  const handleNotice = async (): Promise<Response> => {
    if (noticeCache !== undefined && now() - noticeCache.at < NOTICE_CACHE_MS) {
      return json({ ok: true, announcements: noticeCache.announcements })
    }
    try {
      const body = await fetchJson(`${origin}/api/status`)
      const data = typeof body.data === 'object' && body.data !== null ? body.data as Record<string, unknown> : {}
      const rows = Array.isArray(data.announcements) ? data.announcements : []
      const announcements = rows
        .filter((row): row is Record<string, unknown> => typeof row === 'object' && row !== null)
        .map(row => {
          const item: { content: string, id?: number | string, type?: string, publishDate?: string, popup?: boolean, date?: string } = { content: typeof row.content === 'string' ? row.content : '' }
          if (typeof row.id === 'number' || typeof row.id === 'string') item.id = row.id
          if (typeof row.type === 'string' && row.type !== '') item.type = row.type
          if (typeof row.publishDate === 'string' && row.publishDate !== '') item.publishDate = row.publishDate
          if (row.popup === true) item.popup = true
          if (typeof row.date === 'string' && row.date !== '') item.date = row.date
          return item
        })
        .filter(row => row.content !== '')
      noticeCache = { at: now(), announcements }
      return json({ ok: true, announcements })
    } catch (error: unknown) {
      return json({ ok: false, code: 'upstream', message: error instanceof Error ? error.message : String(error) }, 502)
    }
  }

  /**
   * Read and patch this plugin's settings row (`ns: 'tako'`) plus the host's
   * `web.searchProvider` pin. Only the documented fields are writable; every
   * value is validated here before `mutate` sees it, and read-only profiles
   * refuse writes instead of throwing.
   */
  const handleConfig = async (request: Request): Promise<Response> => {
    const settings = options.settings
    if (settings === undefined) return json({ ok: false, code: 'unavailable', message: 'this dsh profile mounts no settings service' }, 503)

    const section = settings.describe().find(descriptor => descriptor.ns === 'tako')
    if (section === undefined) return json({ ok: false, code: 'no-entry' })
    const webSection = settings.describe().find(descriptor => descriptor.ns === 'web')
    const resolved = typeof section.value === 'object' && section.value !== null ? section.value as Record<string, unknown> : {}
    const webSearchProvider = typeof webSection?.value === 'object' && webSection.value !== null
      ? (webSection.value as Record<string, unknown>).searchProvider : undefined
    const config = {
      baseURL: resolved.baseURL,
      refreshIntervalMs: resolved.refreshIntervalMs,
      syncRetryDelaysMs: resolved.syncRetryDelaysMs,
      defaultContextWindow: resolved.defaultContextWindow,
      pinned: resolved.pinned,
      include: resolved.include,
      exclude: resolved.exclude,
      includeClaudeCodeOnly: resolved.includeClaudeCodeOnly,
      overrides: resolved.overrides,
    }

    if (request.method === 'GET') {
      return json({ ok: true, writable: settings.writable !== false, config, webSearchProvider })
    }

    if (settings.writable === false) return json({ ok: false, code: 'read-only' }, 403)
    let body: { set?: unknown }
    try {
      body = await request.json() as { set?: unknown }
    } catch {
      return json({ ok: false, code: 'bad-request', message: 'invalid JSON body' }, 400)
    }
    const set = typeof body.set === 'object' && body.set !== null ? body.set as Record<string, unknown> : undefined
    if (set === undefined) return json({ ok: false, code: 'bad-request', message: 'expected { set: { … } }' }, 400)

    const ops: { op: 'set', path: string[], value: unknown }[] = []
    const webOps: { op: 'set', path: string[], value: unknown }[] = []
    const bad = (field: string, why: string): Response => json({ ok: false, code: 'bad-request', message: `${field}: ${why}` }, 400)
    const stringArray = (value: unknown): string[] | undefined =>
      Array.isArray(value) && value.every(item => typeof item === 'string') ? value as string[] : undefined

    for (const [field, value] of Object.entries(set)) {
      switch (field) {
        case 'refreshIntervalMs': {
          if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return bad(field, 'a non-negative integer (ms)')
          ops.push({ op: 'set', path: [field], value })
          break
        }
        case 'syncRetryDelaysMs': {
          if (!Array.isArray(value) || !value.every(item => typeof item === 'number' && Number.isInteger(item) && item >= 1)) return bad(field, 'an array of positive integers (ms)')
          ops.push({ op: 'set', path: [field], value })
          break
        }
        case 'defaultContextWindow': {
          if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) return bad(field, 'a positive integer')
          ops.push({ op: 'set', path: [field], value })
          break
        }
        case 'includeClaudeCodeOnly': {
          if (typeof value !== 'boolean') return bad(field, 'a boolean')
          ops.push({ op: 'set', path: [field], value })
          break
        }
        case 'pinned': case 'include': case 'exclude': {
          const list = stringArray(value)
          if (list === undefined) return bad(field, 'an array of strings')
          ops.push({ op: 'set', path: [field], value: list })
          break
        }
        case 'baseURL': {
          if (typeof value !== 'string' || value.trim() === '') return bad(field, 'a non-empty URL')
          ops.push({ op: 'set', path: [field], value: value.trim() })
          break
        }
        case 'overrides': {
          const problem = overridesProblem(value)
          if (problem !== undefined) return bad(field, problem)
          ops.push({ op: 'set', path: [field], value })
          break
        }
        case 'webSearchProvider': {
          if (value !== 'tako' && value !== 'deepseek-official') return bad(field, `'tako' or 'deepseek-official'`)
          webOps.push({ op: 'set', path: ['searchProvider'], value })
          break
        }
        default:
          return bad(field, 'unknown field')
      }
    }

    if (ops.length > 0) await settings.mutate('tako', ops)
    if (webOps.length > 0) await settings.mutate('web', webOps)
    // Model-list related edits take effect on the next sync; kick one now.
    if (ops.length > 0) options.requestSync?.()
    return json({ ok: true })
  }

  /** Manual catalog refresh: the sync loop owns the work, this only pokes it. */
  const handleSync = async (): Promise<Response> => {
    if (options.requestSync === undefined) return json({ ok: false, code: 'unavailable' })
    options.requestSync()
    return json({ ok: true })
  }

  return { handleStatus, handleLogout, handleCatalog, handleKey, handleLogs, handleUsage, handleNotice, handleConfig, handleSync }
}

/** How long the announcements answer stays fresh. */
export const NOTICE_CACHE_MS = 10 * 60_000

const REASONING_LEVEL = /^(off|minimal|low|medium|high|xhigh|max)$/u

/**
 * Field-level validation for a per-model override object, mirroring the
 * runtime `Config` schema: partial objects are fine, unknown keys and bad
 * value shapes are not. Kept here so the web module does not import the
 * config schema from `index.ts` (a circular module edge).
 */
function overridesProblem(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return 'a model-id → override object map'
  for (const [id, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return `overrides.${id}: an object`
    for (const [key, field] of Object.entries(entry as Record<string, unknown>)) {
      switch (key) {
        case 'name':
          if (typeof field !== 'string') return `overrides.${id}.name: a string`
          break
        case 'contextWindow': case 'maxTokens':
          if (typeof field !== 'number' || !Number.isInteger(field) || field < 1) return `overrides.${id}.${key}: a positive integer`
          break
        case 'input':
          if (!Array.isArray(field) || !field.every(item => item === 'text' || item === 'image')) return `overrides.${id}.input: an array of 'text'|'image'`
          break
        case 'reasoningEfforts': {
          if (field === false) break
          if (typeof field !== 'object' || field === null || Array.isArray(field)) return `overrides.${id}.reasoningEfforts: false or a level map`
          for (const [level, wire] of Object.entries(field as Record<string, unknown>)) {
            if (!REASONING_LEVEL.test(level)) return `overrides.${id}.reasoningEfforts: unknown level ${JSON.stringify(level)}`
            if (wire !== null && typeof wire !== 'string') return `overrides.${id}.reasoningEfforts.${level}: a string or null`
          }
          break
        }
        default:
          return `overrides.${id}: unknown field ${JSON.stringify(key)}`
      }
    }
  }
  return undefined
}

/**
 * The `/api/desktop/me` fields the console shows, plus the USD conversion of
 * the quota points at the site's documented rate; nothing else is forwarded.
 */
function identityOf(identity: TakoIdentity): ConsoleIdentity {
  const picked: ConsoleIdentity = {}
  if (identity.userName !== undefined) picked.userName = identity.userName
  if (identity.planName !== undefined) picked.planName = identity.planName
  if (identity.quotaRemain !== undefined) {
    picked.quotaRemain = identity.quotaRemain
    picked.quotaRemainUsd = identity.quotaRemain / QUOTA_PER_UNIT
  }
  if (identity.quotaUsed !== undefined) {
    picked.quotaUsed = identity.quotaUsed
    picked.quotaUsedUsd = identity.quotaUsed / QUOTA_PER_UNIT
  }
  return picked
}
