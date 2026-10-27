/**
 * Tako browser sign-in: PKCE authorization-code flow over a one-shot loopback
 * listener, plus the `/api/desktop/*` calls that use the issued key.
 *
 * Kept free of DSH services so every branch is testable with a fake fetch;
 * storing the key is the caller's job (see `store.ts`).
 * @module dsh-tako/login
 */

import { createHash, randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { hostname as osHostname } from 'node:os'

/** OAuth client id the Tako server accepts for third-party DSH integrations. */
export const CLIENT_ID = 'tako-connect'
/** The only callback path the server's redirect_uri allowlist accepts. */
export const CALLBACK_PATH = '/tako/callback'
/** Authorization codes expire after five minutes server-side; wait no longer. */
export const DEFAULT_LOGIN_TIMEOUT_MS = 5 * 60_000
/** Server-side `device_name` limit after sanitizing. */
export const MAX_DEVICE_NAME_LENGTH = 32

const API_KEY_PATTERN = /^[\x21-\x7e]{1,512}$/u

/** A PKCE verifier and its S256 challenge. */
export interface Pkce {
  verifier: string
  challenge: string
}

/** 32 random bytes as base64url: a 43-character verifier (RFC 7636 §4.1). */
export function createPkce(): Pkce {
  const verifier = randomBytes(32).toString('base64url')
  return { verifier, challenge: s256(verifier) }
}

/** The S256 code challenge of a verifier. */
export function s256(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}

/** An unguessable `state` value. */
export function createState(): string {
  return randomBytes(24).toString('base64url')
}

/**
 * Apply the server's own `device_name` rule (whitespace to `-`, keep
 * `[A-Za-z0-9._@+-]`, trim those punctuation marks, cap at 32), so what the
 * terminal shows is what the authorization page and token list show.
 */
export function sanitizeDeviceName(raw: string): string {
  return raw.trim()
    .replace(/\s+/gu, '-')
    .replace(/[^A-Za-z0-9._@+-]+/gu, '')
    .replace(/^[-._@+]+|[-._@+]+$/gu, '')
    .slice(0, MAX_DEVICE_NAME_LENGTH)
}

const DEVICE_PREFIX = 'dsh-tako@'

/**
 * The short host name as a device-name fragment: the first DNS label (so
 * `mac.local` and `box.corp.example.com` lose their domain), characters
 * outside `[A-Za-z0-9._+-]` replaced by `-`, runs of `-` collapsed, and
 * leading/trailing punctuation trimmed. Empty when nothing usable remains.
 */
export function hostLabel(hostname: string): string {
  const first = hostname.trim().split('.')[0] ?? ''
  return first
    .replace(/[^A-Za-z0-9._+-]/gu, '-')
    .replace(/-{2,}/gu, '-')
    .replace(/^[-._+]+|[-._+]+$/gu, '')
}

/**
 * Default device label: `dsh-tako@<hostname>`, capped at the server's
 * 32-character limit without a trailing `.`/`-`; `dsh-tako@<platform>` when
 * the host name yields nothing. Tako replaces an older token with the same
 * name, so the host name keeps machines on one platform from revoking each
 * other's key.
 */
export function defaultDeviceName(hostname: string = osHostname(), platform: string = process.platform): string {
  const host = hostLabel(hostname)
  if (host === '') return sanitizeDeviceName(`${DEVICE_PREFIX}${platform}`)
  return `${DEVICE_PREFIX}${host}`.slice(0, MAX_DEVICE_NAME_LENGTH).replace(/[-._+]+$/u, '')
}

/** Mask a key for display: `cr_****abcd`. */
export function maskKey(key: string): string {
  const prefix = key.startsWith('cr_') ? 'cr_' : ''
  return `${prefix}****${key.length > prefix.length + 8 ? key.slice(-4) : ''}`
}

export interface AuthorizeUrlInput {
  origin: string
  redirectUri: string
  state: string
  challenge: string
  deviceName: string
}

/** `<origin>/app/authorize?...` exactly as the server contract lists the parameters. */
export function buildAuthorizeUrl(input: AuthorizeUrlInput): string {
  const url = new URL('/app/authorize', `${input.origin}/`)
  url.searchParams.set('client_id', CLIENT_ID)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('redirect_uri', input.redirectUri)
  url.searchParams.set('state', input.state)
  url.searchParams.set('code_challenge', input.challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  if (input.deviceName !== '') url.searchParams.set('device_name', input.deviceName)
  return url.href
}

/** What one request to the callback path carries. */
export type CallbackOutcome =
  | { kind: 'code', code: string }
  | { kind: 'denied', error: string, description?: string }
  | { kind: 'state-mismatch' }
  | { kind: 'invalid', reason: string }

/** Classify a callback URL against the expected state. */
export function parseCallback(url: URL, expectedState: string): CallbackOutcome {
  const state = url.searchParams.get('state')
  if (state === null || state !== expectedState) return { kind: 'state-mismatch' }
  const error = url.searchParams.get('error')
  if (error !== null) {
    const description = url.searchParams.get('error_description') ?? undefined
    return description === undefined ? { kind: 'denied', error } : { kind: 'denied', error, description }
  }
  const code = url.searchParams.get('code')
  if (code === null || code === '') return { kind: 'invalid', reason: 'missing code' }
  return { kind: 'code', code }
}

/** Token endpoint success payload. */
export interface TakoGrant {
  key: string
  tokenId?: number | string
  name?: string
  userName?: string
  planName?: string
}

/** A failure the CLI reports with a stable code. */
export class TakoLoginError extends Error {
  constructor(
    readonly code: 'denied' | 'timeout' | 'token-failed' | 'cancelled' | 'listen-failed' | 'request-failed',
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'TakoLoginError'
  }
}

interface Envelope {
  success?: boolean
  message?: string
  error?: string
  data?: Record<string, unknown>
}

async function readEnvelope(response: Response, what: string): Promise<Record<string, unknown>> {
  let body: Envelope | undefined
  try {
    body = await response.json() as Envelope
  } catch {
    body = undefined
  }
  // Tako reports protocol errors as HTTP 200 with `success: false`.
  if (!response.ok || body === undefined || body.success !== true || typeof body.data !== 'object' || body.data === null) {
    const reason = body?.error ?? body?.message ?? `HTTP ${response.status}`
    const detail = body?.message !== undefined && body.message !== reason ? ` (${body.message})` : ''
    throw new TakoLoginError('request-failed', `${what} failed: ${reason}${detail}`)
  }
  return body.data
}

const str = (value: unknown): string | undefined => typeof value === 'string' && value !== '' ? value : undefined
const nested = (value: unknown, key: string): unknown => typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[key] : undefined

export interface ExchangeInput {
  origin: string
  code: string
  verifier: string
  redirectUri: string
  fetch?: typeof fetch
  signal?: AbortSignal
}

/** `POST /api/desktop/token`: trade the one-time code for a `cr_` key. */
export async function exchangeCode(input: ExchangeInput): Promise<TakoGrant> {
  const fetchImpl = input.fetch ?? fetch
  let response: Response
  try {
    response = await fetchImpl(`${input.origin}/api/desktop/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code: input.code,
        code_verifier: input.verifier,
        redirect_uri: input.redirectUri,
        client_id: CLIENT_ID,
      }),
      signal: input.signal ?? AbortSignal.timeout(30_000),
    })
  } catch (error: unknown) {
    throw new TakoLoginError('token-failed', `token request failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
  }
  let data: Record<string, unknown>
  try {
    data = await readEnvelope(response, 'token exchange')
  } catch (error: unknown) {
    throw new TakoLoginError('token-failed', (error as Error).message, { cause: error })
  }
  const key = str(data.key)
  if (key === undefined || !API_KEY_PATTERN.test(key)) throw new TakoLoginError('token-failed', 'token exchange returned no usable key')
  const grant: TakoGrant = { key }
  const tokenId = data.token_id
  if (typeof tokenId === 'number' || typeof tokenId === 'string') grant.tokenId = tokenId
  const name = str(data.name)
  if (name !== undefined) grant.name = name
  const userName = str(nested(data.user, 'name'))
  if (userName !== undefined) grant.userName = userName
  const planName = str(nested(data.plan, 'name'))
  if (planName !== undefined) grant.planName = planName
  return grant
}

/** `GET /api/desktop/me` view. */
export interface TakoIdentity {
  userName?: string
  userId?: string
  planName?: string
  tokenName?: string
  tokenId?: number | string
  quotaRemain?: number
  quotaUsed?: number
}

/** `GET /api/desktop/me` with the key as Bearer. */
export async function fetchMe(origin: string, key: string, fetchImpl: typeof fetch = fetch): Promise<TakoIdentity> {
  const response = await fetchImpl(`${origin}/api/desktop/me`, {
    headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  })
  const data = await readEnvelope(response, 'whoami')
  const identity: TakoIdentity = {}
  const set = <K extends keyof TakoIdentity>(field: K, value: TakoIdentity[K] | undefined): void => { if (value !== undefined) identity[field] = value }
  set('userName', str(nested(data.user, 'name')))
  set('userId', str(nested(data.user, 'id')))
  set('planName', str(nested(data.plan, 'name')))
  set('tokenName', str(nested(data.token, 'name')))
  const tokenId = nested(data.token, 'id')
  if (typeof tokenId === 'number' || typeof tokenId === 'string') identity.tokenId = tokenId
  const remain = nested(data.quota, 'remain')
  if (typeof remain === 'number') identity.quotaRemain = remain
  const used = nested(data.quota, 'used')
  if (typeof used === 'number') identity.quotaUsed = used
  return identity
}

/** Subscription windows from `POST /apiStats/api/user-quota`. Amounts are USD. */
export interface TakoPlanQuota {
  windowMinutes?: number
  windowCost?: number
  windowCostLimit?: number
  weeklyCost?: number
  weeklyCostLimit?: number
  dailyCost?: number
  dailyCostLimit?: number
}

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function pickNum(record: Record<string, unknown> | undefined, ...keys: string[]): number | undefined {
  if (record === undefined) return undefined
  for (const key of keys) {
    const value = finite(record[key])
    if (value !== undefined) return value
  }
  return undefined
}

/**
 * Plan 5h/weekly windows. Wallet remain on `/api/desktop/me` is a different
 * number; this is the subscription quota the site itself shows.
 */
export async function fetchUserQuota(origin: string, key: string, fetchImpl: typeof fetch = fetch): Promise<TakoPlanQuota | null> {
  const idResponse = await fetchImpl(`${origin}/apiStats/api/get-key-id`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ apiKey: key }),
    signal: AbortSignal.timeout(20_000),
  })
  let idBody: Envelope | undefined
  try { idBody = await idResponse.json() as Envelope }
  catch { idBody = undefined }
  const id = nested(idBody?.data, 'id')
  if (idBody?.success !== true || (typeof id !== 'string' && typeof id !== 'number')) {
    const reason = typeof idBody?.error === 'string' ? idBody.error
      : typeof idBody?.message === 'string' ? idBody.message
      : `HTTP ${idResponse.status}`
    throw new TakoLoginError('request-failed', `key-id failed: ${reason}`)
  }
  const quotaResponse = await fetchImpl(`${origin}/apiStats/api/user-quota`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ apiId: String(id) }),
    signal: AbortSignal.timeout(20_000),
  })
  let raw: Record<string, unknown>
  try { raw = await quotaResponse.json() as Record<string, unknown> }
  catch { throw new TakoLoginError('request-failed', `user-quota failed: HTTP ${quotaResponse.status}`) }
  if (!quotaResponse.ok) throw new TakoLoginError('request-failed', `user-quota failed: HTTP ${quotaResponse.status}`)
  const plan = isRecord(raw.plan) ? raw.plan : undefined
  const usage = isRecord(raw.usage) ? raw.usage : undefined
  const out: TakoPlanQuota = {}
  const set = (field: keyof TakoPlanQuota, value: number | undefined): void => { if (value !== undefined) out[field] = value }
  set('windowMinutes', pickNum(plan, 'window_minutes', 'windowMinutes'))
  set('windowCostLimit', pickNum(plan, 'window_cost_limit', 'windowCostLimit'))
  set('weeklyCostLimit', pickNum(plan, 'weekly_cost_limit', 'weeklyCostLimit'))
  set('dailyCostLimit', pickNum(plan, 'daily_cost_limit', 'dailyCostLimit'))
  set('windowCost', pickNum(usage, 'windowCost', 'window_cost'))
  set('weeklyCost', pickNum(usage, 'weeklyCost', 'weekly_cost'))
  set('dailyCost', pickNum(usage, 'dailyCost', 'daily_cost'))
  return Object.keys(out).length === 0 ? null : out
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** True when the subscription actually has a 5h or weekly window. */
export function hasPlanQuota(plan: TakoPlanQuota | null | undefined): boolean {
  if (plan === null || plan === undefined) return false
  return (plan.windowCostLimit ?? 0) > 0 || (plan.weeklyCostLimit ?? 0) > 0
}

/** `POST /api/desktop/revoke` with the key as Bearer: deletes that key server-side. */
export async function revokeKey(origin: string, key: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  const response = await fetchImpl(`${origin}/api/desktop/revoke`, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  })
  await readEnvelope(response, 'revoke')
}

// ---------------------------------------------------------------- callback pages

/** Which page the browser lands on. */
export type CallbackPage = 'success' | 'denied' | 'state-mismatch' | 'error'

const PAGES: Record<CallbackPage, { title: string, zh: string, en: string, ok: boolean }> = {
  success: {
    ok: true,
    title: 'Tako 登录成功 / Signed in',
    zh: '登录成功，API key 已保存到 DSH。可以关闭这个页面，回到终端。',
    en: 'You are signed in and the API key is saved to DSH. You can close this tab and return to the terminal.',
  },
  denied: {
    ok: false,
    title: 'Tako 授权已取消 / Authorization denied',
    zh: '你拒绝了这次授权，没有保存任何 key。需要时在终端重新运行 dsh-tako login。',
    en: 'You declined the request; no key was saved. Run dsh-tako login again when you are ready.',
  },
  'state-mismatch': {
    ok: false,
    title: 'Tako 登录校验失败 / Verification failed',
    zh: '这个回调不属于当前的登录请求（state 不匹配），已忽略。请使用终端里最新打印的链接。',
    en: 'This callback does not belong to the pending sign-in (state mismatch) and was ignored. Use the latest link printed in the terminal.',
  },
  error: {
    ok: false,
    title: 'Tako 登录失败 / Sign-in failed',
    zh: '登录没有完成，没有保存任何 key。请回到终端查看原因并重试。',
    en: 'Sign-in did not complete and no key was saved. Check the terminal for details and try again.',
  },
}

const escapeHtml = (text: string): string => text.replace(/[&<>"']/gu, ch => `&#${ch.charCodeAt(0)};`)

/** A small self-contained bilingual page; `detail` is shown escaped. */
export function renderCallbackPage(page: CallbackPage, detail?: string): string {
  const copy = PAGES[page]
  const color = copy.ok ? '#16a34a' : '#dc2626'
  const extra = detail === undefined ? '' : `<p class="detail">${escapeHtml(detail)}</p>`
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(copy.title)}</title>
<style>
:root{color-scheme:light dark}
body{margin:0;min-height:100vh;display:grid;place-items:center;font:16px/1.6 system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;background:Canvas;color:CanvasText}
main{max-width:34rem;padding:2rem 1.5rem}
h1{font-size:1.35rem;margin:0 0 1rem;color:${color}}
p{margin:.5rem 0}.en{opacity:.75}.detail{font-family:ui-monospace,monospace;font-size:.85rem;opacity:.7;word-break:break-all}
</style></head>
<body><main><h1>${escapeHtml(copy.title)}</h1><p>${escapeHtml(copy.zh)}</p><p class="en">${escapeHtml(copy.en)}</p>${extra}</main></body></html>
`
}

// ---------------------------------------------------------------- loopback flow

export interface BrowserLoginOptions {
  /** Tako origin without `/v1`. */
  origin: string
  deviceName?: string
  /** Fixed loopback port (1024-65535), e.g. to match an SSH `-L` forward; `0` or absent picks a free one. */
  port?: number
  timeoutMs?: number
  fetch?: typeof fetch
  /**
   * Runs after the key arrives and before the browser gets its answer, so the
   * success page is only shown once the key is actually stored.
   */
  onGrant?: (grant: TakoGrant) => Promise<void>
}

export interface BrowserLoginHandle {
  authorizeUrl: string
  redirectUri: string
  port: number
  /** Resolves with the grant (after `onGrant` succeeded) or rejects with a {@link TakoLoginError}. */
  result: Promise<TakoGrant>
  cancel: () => void
}

function send(response: ServerResponse, status: number, page: CallbackPage, detail?: string): void {
  const body = renderCallbackPage(page, detail)
  response.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
  })
  response.end(body)
}

/**
 * Open a loopback listener on 127.0.0.1 and build the authorization URL.
 * Exactly one callback with the right `state` settles the flow; a callback
 * with a wrong or missing state is answered and ignored, so a stray request
 * cannot end a pending sign-in.
 */
export async function startBrowserLogin(options: BrowserLoginOptions): Promise<BrowserLoginHandle> {
  const origin = options.origin.replace(/\/+$/u, '')
  const parsed = new URL(origin)
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new TakoLoginError('listen-failed', `unsupported Tako origin ${origin}`)
  const port = options.port ?? 0
  if (!Number.isInteger(port) || (port !== 0 && (port < 1024 || port > 65535))) {
    throw new TakoLoginError('listen-failed', `--port must be between 1024 and 65535, got ${String(options.port)}`)
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_LOGIN_TIMEOUT_MS
  const fetchImpl = options.fetch ?? fetch
  const pkce = createPkce()
  const state = createState()
  const deviceName = sanitizeDeviceName(options.deviceName ?? defaultDeviceName())
  const controller = new AbortController()

  let settled = false
  let busy = false
  let resolveResult!: (grant: TakoGrant) => void
  let rejectResult!: (error: TakoLoginError) => void
  const result = new Promise<TakoGrant>((resolve, reject) => { resolveResult = resolve; rejectResult = reject })
  // The caller may attach handlers late; never surface an unhandled rejection meanwhile.
  result.catch(() => {})

  let server: Server | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const close = (): void => {
    if (timer !== undefined) clearTimeout(timer)
    controller.abort()
    if (server?.listening === true) {
      server.close()
      server.closeAllConnections?.()
    }
  }
  const succeed = (grant: TakoGrant): void => {
    if (settled) return
    settled = true
    close()
    resolveResult(grant)
  }
  const fail = (error: TakoLoginError): void => {
    if (settled) return
    settled = true
    close()
    rejectResult(error)
  }

  let redirectUri = ''
  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (url.pathname !== CALLBACK_PATH) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found')
      return
    }
    if (request.method !== 'GET') {
      response.writeHead(405, { 'content-type': 'text/plain; charset=utf-8', allow: 'GET' }).end('Method not allowed')
      return
    }
    if (settled || busy) {
      send(response, 409, 'error', settled ? 'This sign-in has already finished.' : 'A callback for this sign-in is already being processed.')
      return
    }
    const outcome = parseCallback(url, state)
    switch (outcome.kind) {
      case 'state-mismatch':
        send(response, 400, 'state-mismatch')
        return
      case 'invalid':
        send(response, 400, 'error', outcome.reason)
        return
      case 'denied':
        send(response, 200, 'denied', outcome.description ?? outcome.error)
        fail(new TakoLoginError('denied', outcome.error === 'access_denied'
          ? 'authorization was denied in the browser'
          : `authorization failed: ${outcome.error}${outcome.description !== undefined ? ` (${outcome.description})` : ''}`))
        return
      case 'code':
        break
    }
    busy = true
    let grant: TakoGrant
    try {
      grant = await exchangeCode({ origin, code: outcome.code, verifier: pkce.verifier, redirectUri, fetch: fetchImpl, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]) })
    } catch (error: unknown) {
      const loginError = error instanceof TakoLoginError ? error : new TakoLoginError('token-failed', String(error))
      send(response, 502, 'error', loginError.message)
      fail(loginError)
      return
    }
    try {
      await options.onGrant?.(grant)
    } catch (error: unknown) {
      const message = `the key was issued but could not be saved: ${error instanceof Error ? error.message : String(error)}`
      send(response, 500, 'error', message)
      fail(new TakoLoginError('token-failed', message, { cause: error }))
      return
    }
    send(response, 200, 'success', grant.userName !== undefined ? `${grant.userName}${grant.planName !== undefined ? ` · ${grant.planName}` : ''}` : undefined)
    succeed(grant)
  }

  server = createServer((request, response) => {
    handle(request, response).catch((error: unknown) => {
      if (!response.headersSent) send(response, 500, 'error', error instanceof Error ? error.message : String(error))
    })
  })
  await new Promise<void>((resolve, reject) => {
    server!.once('error', reject)
    // Loopback only: the callback must never be reachable from the network.
    server!.listen(port, '127.0.0.1', () => { server!.off('error', reject); resolve() })
  }).catch((error: unknown) => {
    throw new TakoLoginError('listen-failed', `could not listen on 127.0.0.1:${port}: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
  })
  const address = server.address()
  if (address === null || typeof address === 'string') {
    close()
    throw new TakoLoginError('listen-failed', 'loopback listener has no port')
  }
  if (address.port < 1024) {
    close()
    throw new TakoLoginError('listen-failed', `the system assigned port ${address.port}, outside Tako's 1024-65535 allowlist; pass --port`)
  }
  redirectUri = `http://127.0.0.1:${address.port}${CALLBACK_PATH}`
  timer = setTimeout(() => fail(new TakoLoginError('timeout', `no authorization arrived within ${Math.round(timeoutMs / 1000)}s`)), timeoutMs)
  timer.unref?.()
  return {
    authorizeUrl: buildAuthorizeUrl({ origin, redirectUri, state, challenge: pkce.challenge, deviceName }),
    redirectUri,
    port: address.port,
    result,
    cancel: () => fail(new TakoLoginError('cancelled', 'sign-in cancelled')),
  }
}
