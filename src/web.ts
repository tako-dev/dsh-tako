/**
 * Host half of the Models-page "Sign in to Tako" button.
 *
 * Registers one exact Fetch route on the Web connection (`/api/tako.login`,
 * behind the browser authentication fence; only the owner reaches it). A POST
 * starts the loopback sign-in on the dsh host and returns the authorization
 * URL; a GET reports its progress. The issued key is stored through the
 * installation's own `ctx.credentials.set`, which also tells the Models page
 * to refresh.
 * @module dsh-tako/web
 */

import type { Context } from '@deepseek-ai/cordis'
import type { BrowserLoginHandle, BrowserLoginOptions } from './login.ts'
import { defaultDeviceName, maskKey, startBrowserLogin, TakoLoginError } from './login.ts'
import { normalizeOrigin } from './shared.ts'

/** Route path below `/api`; the browser calls the relative `api/tako.login`. */
export const LOGIN_ROUTE = '/api/tako.login'

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
/** The slice of `ctx.credentials` this module uses. */
export interface CredentialSetter {
  set: (ref: never, value: string) => Promise<void>
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

/** Mount the route while the Web connection and the credential service are both up. */
export function applyWeb(ctx: Context, config: { baseURL: string, apiKeyEnv: string }): void {
  ctx.inject(['connection', 'credentials'], inner => {
    const connection = (inner as unknown as { connection: ConnectionLike }).connection
    const service = createLoginService({
      baseURL: config.baseURL,
      apiKeyEnv: config.apiKeyEnv,
      credentials: () => (inner as unknown as { credentials?: CredentialSetter }).credentials,
      logger: inner.logger,
    })
    inner.effect(() => {
      const unregister = connection.fetch.register({
        path: LOGIN_ROUTE,
        methods: ['GET', 'POST'],
        requestBody: 'buffered',
        fetch: request => service.handle(request),
      })
      return async () => {
        service.dispose()
        await unregister()
      }
    })
  })
}
