/**
 * Host half of the Web UI: the Models-page "Sign in to Tako" button and the
 * Tako console panel's four routes.
 *
 * All routes are exact Fetch routes on the Web connection, behind the browser
 * authentication fence; only the owner reaches them. `/api/tako.login` runs
 * the loopback sign-in on the dsh host; the console routes report the stored
 * key (masked), revoke it on logout, expose the synced model catalog, and
 * compare the installed version with npm's `dist-tags.latest`. Issued and
 * stored keys go through the installation's own `ctx.credentials`, which also
 * tells the Models page to refresh. A resolved key value never leaves the
 * host: status answers carry `maskKey()` output only.
 * @module dsh-tako/web
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type { TakoModel } from './catalog.ts'
import type { BrowserLoginHandle, BrowserLoginOptions, TakoIdentity } from './login.ts'
import { defaultDeviceName, fetchMe, maskKey, revokeKey, startBrowserLogin, TakoLoginError } from './login.ts'
import { normalizeOrigin } from './shared.ts'

/** Route path below `/api`; the browser calls the relative `api/tako.login`. */
export const LOGIN_ROUTE = '/api/tako.login'
/** Console route: whether a key is stored (masked) plus the account behind it. */
export const STATUS_ROUTE = '/api/tako.status'
/** Console route: revoke the stored key on Tako and remove it from dsh credentials. */
export const LOGOUT_ROUTE = '/api/tako.logout'
/** Console route: the model catalog the plugin last synced, and when it refreshes. */
export const CATALOG_ROUTE = '/api/tako.catalog'
/** Console route: how the installed version compares with npm's `dist-tags.latest`. */
export const UPDATE_ROUTE = '/api/tako.update'

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

/** Mount the routes while the Web connection and the credential service are both up. */
export function applyWeb(ctx: Context, config: { baseURL: string, apiKeyEnv: string }, web: { catalog: () => CatalogState } = { catalog: () => emptyCatalogState() }): void {
  ctx.inject(['connection', 'credentials'], inner => {
    const connection = (inner as unknown as { connection: ConnectionLike }).connection
    const service = createLoginService({
      baseURL: config.baseURL,
      apiKeyEnv: config.apiKeyEnv,
      credentials: () => (inner as unknown as { credentials?: CredentialSetter }).credentials,
      logger: inner.logger,
    })
    const consoleService = createConsoleService({
      baseURL: config.baseURL,
      apiKeyEnv: config.apiKeyEnv,
      credentials: () => (inner as unknown as { credentials?: CredentialSetter & CredentialStore }).credentials,
      catalog: web.catalog,
      logger: inner.logger,
    })
    const updateService = createUpdateService({ logger: inner.logger })
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
          path: UPDATE_ROUTE,
          methods: ['GET'],
          requestBody: 'buffered',
          fetch: () => updateService.handleUpdate(),
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
 * What the sync loop (`start()` in `index.ts`) keeps in memory after each
 * successful sync, including the fallback seed. Read by {@link CATALOG_ROUTE}.
 */
export interface CatalogState {
  /** The filtered catalog of the last successful sync; empty before the first. */
  models: readonly TakoModel[]
  /** When that sync finished, in epoch ms; `null` before the first. */
  lastSyncAt: number | null
  /** `lastSyncAt + refreshIntervalMs`; `null` when refreshing only at startup. */
  nextSyncAt: number | null
}

/** A catalog state that has never seen a sync. */
export function emptyCatalogState(): CatalogState {
  return { models: [], lastSyncAt: null, nextSyncAt: null }
}

/** The account fields the console page shows (`/api/desktop/me` view). */
export type ConsoleIdentity = Pick<TakoIdentity, 'userName' | 'planName' | 'quotaRemain' | 'quotaUsed'>

/** How long a `whoami` answer stays fresh, so opening the panel does not hit Tako each time. */
export const STATUS_CACHE_MS = 45_000

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
}

interface StatusCache {
  maskedKey: string
  at: number
  me: ConsoleIdentity | null
  meError: string | undefined
}

/**
 * The console panel's three route handlers. One service instance per Web
 * connection; the resolved key only travels as `maskKey()` output.
 */
export function createConsoleService(options: ConsoleServiceOptions): { handleStatus: () => Promise<Response>, handleLogout: () => Promise<Response>, handleCatalog: () => Promise<Response> } {
  const origin = normalizeOrigin(options.baseURL)
  const cacheMs = options.statusCacheMs ?? STATUS_CACHE_MS
  const now = options.now ?? Date.now
  let cache: StatusCache | undefined

  const handleStatus = async (): Promise<Response> => {
    const credentials = options.credentials()
    if (credentials === undefined) return json({ configured: false })
    let current: { value: string, source: string } | undefined
    try {
      current = await credentials.resolve(options.apiKeyEnv)
    } catch (error: unknown) {
      options.logger.warn('resolving %s failed: %s', options.apiKeyEnv, error instanceof Error ? error.message : String(error))
      return json({ configured: false })
    }
    if (current === undefined) return json({ configured: false })
    const maskedKey = maskKey(current.value)
    // The key value itself is deliberately dropped here; only the mask leaves.
    if (cache !== undefined && cache.maskedKey === maskedKey && now() - cache.at < cacheMs) {
      return json({ configured: true, maskedKey, credential: options.apiKeyEnv, me: cache.me, ...(cache.meError === undefined ? {} : { meError: cache.meError }) })
    }
    let me: ConsoleIdentity | null = null
    let meError: string | undefined
    try {
      me = identityOf(await fetchMe(origin, current.value, options.fetch))
    } catch (error: unknown) {
      meError = error instanceof Error ? error.message : String(error)
    }
    cache = { maskedKey, at: now(), me, meError }
    return json({ configured: true, maskedKey, credential: options.apiKeyEnv, me, ...(meError === undefined ? {} : { meError }) })
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
    return revoked
      ? json({ ok: true, action: 'revoked' })
      : json({ ok: true, action: 'removed', warning })
  }

  const handleCatalog = async (): Promise<Response> => {
    const state = options.catalog()
    return json({ models: state.models.map(model => ({ ...model })), lastSyncAt: state.lastSyncAt, nextSyncAt: state.nextSyncAt })
  }

  return { handleStatus, handleLogout, handleCatalog }
}

/** The `/api/desktop/me` fields the console shows; nothing else is forwarded. */
function identityOf(identity: TakoIdentity): ConsoleIdentity {
  const picked: ConsoleIdentity = {}
  if (identity.userName !== undefined) picked.userName = identity.userName
  if (identity.planName !== undefined) picked.planName = identity.planName
  if (identity.quotaRemain !== undefined) picked.quotaRemain = identity.quotaRemain
  if (identity.quotaUsed !== undefined) picked.quotaUsed = identity.quotaUsed
  return picked
}

// ---------------------------------------------------------------- update route

let cachedVersion: string | undefined

/**
 * This package's own version, read from the `package.json` shipped beside
 * `lib/` (`import.meta.url` keeps working inside the npm package, where the
 * file sits next to the build output). Falls back to `unknown` if it cannot
 * be read.
 */
export function pluginVersion(): string {
  if (cachedVersion === undefined) {
    try {
      cachedVersion = (JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')) as { version?: string }).version ?? 'unknown'
    } catch {
      cachedVersion = 'unknown'
    }
  }
  return cachedVersion
}

/**
 * The plugin is published from the official npm registry, so the check reads
 * that registry directly — never a configured mirror that could sit in front
 * of it on the host. Only the dist-tags document is fetched, not the packument.
 */
const NPM_DIST_TAGS_URL = 'https://registry.npmjs.org/-/package/dsh-tako/dist-tags'

/** How long a fresh registry answer stays cached, so opening the panel does not hit npm every time. */
export const UPDATE_CACHE_MS = 60 * 60_000
/** How long a failed check stays cached: short, so a blip does not pin the error for an hour. */
export const UPDATE_ERROR_CACHE_MS = 5 * 60_000
const UPDATE_TIMEOUT_MS = 10_000

/** What `GET /api/tako.update` answers: the verdict, or why there is none. */
export type UpdateAnswer =
  | { current: string, latest: string, upToDate: boolean }
  | { current: string, checkError: string }

export interface UpdateServiceOptions {
  logger: { info: (...args: unknown[]) => void, warn: (...args: unknown[]) => void }
  /** Seams for tests. */
  fetch?: typeof fetch
  now?: () => number
  /** Overrides the installed version read from `package.json`. */
  currentVersion?: string
  cacheMs?: number
  errorCacheMs?: number
  timeoutMs?: number
}

/** `x.y.z` as comparable numbers; `undefined` when the value is not a plain release. */
function versionTuple(version: string): [number, number, number] | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version)
  return match === null ? undefined : [Number(match[1]), Number(match[2]), Number(match[3])]
}

/**
 * Whether `current` sorts before `latest`. Plain `x.y.z` triples compare
 * numerically (`0.10.0` is newer than `0.9.0`); anything else falls back to
 * string order, which keeps a local prerelease from reading as behind.
 */
function isOlder(current: string, latest: string): boolean {
  const a = versionTuple(current)
  const b = versionTuple(latest)
  if (a === undefined || b === undefined) return current < latest
  return a[0] < b[0] || (a[0] === b[0] && (a[1] < b[1] || (a[1] === b[1] && a[2] < b[2])))
}

/**
 * The update-route handler. One instance per Web connection; the answer is
 * cached in memory, so the registry is asked at most once per cache TTL per
 * connection. A failed check answers `{current, checkError}` with HTTP 200.
 */
export function createUpdateService(options: UpdateServiceOptions): { handleUpdate: () => Promise<Response> } {
  const fetchImpl = options.fetch ?? fetch
  const now = options.now ?? Date.now
  const current = options.currentVersion ?? pluginVersion()
  let cache: { answer: UpdateAnswer, at: number, ttl: number } | undefined

  const check = async (): Promise<UpdateAnswer> => {
    try {
      const response = await fetchImpl(NPM_DIST_TAGS_URL, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(options.timeoutMs ?? UPDATE_TIMEOUT_MS),
      })
      if (!response.ok) throw new Error(`npm dist-tags answered HTTP ${response.status}`)
      const tags = await response.json() as { latest?: unknown }
      if (typeof tags.latest !== 'string' || tags.latest === '') throw new Error('npm dist-tags carry no latest tag')
      options.logger.info('dsh-tako update check: installed %s, npm latest %s', current, tags.latest)
      return { current, latest: tags.latest, upToDate: !isOlder(current, tags.latest) }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      options.logger.warn('dsh-tako update check failed: %s', message)
      return { current, checkError: message }
    }
  }

  const handleUpdate = async (): Promise<Response> => {
    if (cache !== undefined && now() - cache.at < cache.ttl) return json(cache.answer)
    const answer = await check()
    cache = { answer, at: now(), ttl: 'checkError' in answer ? (options.errorCacheMs ?? UPDATE_ERROR_CACHE_MS) : (options.cacheMs ?? UPDATE_CACHE_MS) }
    return json(answer)
  }

  return { handleUpdate }
}
