import { createHash } from 'node:crypto'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BrowserLoginHandle, TakoGrant } from '../src/login.ts'
import {
  buildAuthorizeUrl, CALLBACK_PATH, CLIENT_ID, createPkce, createState, defaultDeviceName, exchangeCode, fetchMe,
  maskKey, parseCallback, renderCallbackPage, revokeKey, s256, sanitizeDeviceName, startBrowserLogin, TakoLoginError,
} from '../src/login.ts'

const ORIGIN = 'https://tako.test'
const KEY = 'cr_0123456789abcdefWXYZ'

const tokenOk = (key = KEY) => ({ success: true, data: { key, token_id: 9, name: 'tako-connect@dsh-tako@linux', user: { name: 'alice' }, plan: { name: 'Pro' } } })
const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** A fetch that answers the token endpoint and records requests; everything else goes to the real network (the loopback listener). */
function tokenFetch(answer: (body: Record<string, unknown>) => Response | Promise<Response>) {
  const calls: { url: string, body: Record<string, unknown> }[] = []
  const impl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
    calls.push({ url, body })
    return answer(body)
  }) as unknown as typeof fetch
  return { impl, calls }
}

const handles: BrowserLoginHandle[] = []
afterEach(() => { handles.splice(0).forEach(handle => handle.cancel()) })

async function begin(options: Parameters<typeof startBrowserLogin>[0]) {
  const handle = await startBrowserLogin(options)
  handles.push(handle)
  return handle
}

/** Simulate the browser landing on the loopback callback. */
const land = (handle: BrowserLoginHandle, query: Record<string, string>) => {
  const url = new URL(handle.redirectUri)
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value)
  return fetch(url)
}
const stateOf = (handle: BrowserLoginHandle) => new URL(handle.authorizeUrl).searchParams.get('state')!

describe('PKCE and state', () => {
  it('creates an RFC 7636 verifier with its S256 challenge', () => {
    const { verifier, challenge } = createPkce()
    expect(verifier).toMatch(/^[A-Za-z0-9\-._~]{43,128}$/)
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'))
    // RFC 7636 appendix B test vector.
    expect(s256('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
  })

  it('never repeats verifiers or states', () => {
    expect(createPkce().verifier).not.toBe(createPkce().verifier)
    const state = createState()
    expect(state).toMatch(/^[A-Za-z0-9_-]{32}$/)
    expect(state).not.toBe(createState())
  })

  it('builds the authorize URL with every contract parameter', () => {
    const url = new URL(buildAuthorizeUrl({ origin: ORIGIN, redirectUri: 'http://127.0.0.1:5000/tako/callback', state: 's1', challenge: 'c'.repeat(43), deviceName: 'dsh-tako@linux' }))
    expect(url.origin + url.pathname).toBe('https://tako.test/app/authorize')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'tako-connect',
      response_type: 'code',
      redirect_uri: 'http://127.0.0.1:5000/tako/callback',
      state: 's1',
      code_challenge: 'c'.repeat(43),
      code_challenge_method: 'S256',
      device_name: 'dsh-tako@linux',
    })
  })

  it('sanitizes device names the way the server does', () => {
    expect(sanitizeDeviceName('  my mac / 工作 ')).toBe('my-mac')
    expect(sanitizeDeviceName('@@a b@@')).toBe('a-b')
    expect(sanitizeDeviceName('x'.repeat(40))).toHaveLength(32)
  })

  it('defaults the device name to dsh-tako@<hostname>', () => {
    expect(defaultDeviceName('build-box', 'linux')).toBe('dsh-tako@build-box')
    // Domain suffixes go: .local (macOS Bonjour) and any FQDN.
    expect(defaultDeviceName('Hashiros-MacBook-Pro.local', 'darwin')).toBe('dsh-tako@Hashiros-MacBook-Pro')
    expect(defaultDeviceName('web01.corp.example.com', 'linux')).toBe('dsh-tako@web01')
    // Spaces and non-ASCII become `-`, collapsed and trimmed.
    expect(defaultDeviceName('my mac', 'darwin')).toBe('dsh-tako@my-mac')
    expect(defaultDeviceName('张三的 MacBook', 'darwin')).toBe('dsh-tako@MacBook')
    expect(defaultDeviceName('工作机', 'win32')).toBe('dsh-tako@win32')
    // Long names stop at the server's 32-character limit, never on a trailing `-`/`.`.
    const long = defaultDeviceName('a-very-long-hostname-for-the-ci-runner-0042', 'linux')
    expect(long).toBe('dsh-tako@a-very-long-hostname-fo')
    expect(long.length).toBeLessThanOrEqual(32)
    expect(defaultDeviceName('abcdefghijklmnopqrstuv-xyz', 'linux')).toBe('dsh-tako@abcdefghijklmnopqrstuv')
    expect(defaultDeviceName('abcdefghijklmnopqrstuv-.local', 'linux')).toBe('dsh-tako@abcdefghijklmnopqrstuv')
    expect(defaultDeviceName('abcdefghijklmnopqrstuv_.xyz', 'linux')).toBe('dsh-tako@abcdefghijklmnopqrstuv')
    // Empty or unusable host names fall back to the platform.
    expect(defaultDeviceName('', 'darwin')).toBe('dsh-tako@darwin')
    expect(defaultDeviceName('   ', 'linux')).toBe('dsh-tako@linux')
    expect(defaultDeviceName('.local', 'linux')).toBe('dsh-tako@linux')
    // What the server keeps is what we send.
    for (const name of [long, defaultDeviceName('张三的 MacBook', 'darwin'), defaultDeviceName()]) expect(sanitizeDeviceName(name)).toBe(name)
  })

  it('masks keys to the last four characters', () => {
    expect(maskKey(KEY)).toBe('cr_****WXYZ')
    expect(maskKey('cr_short')).toBe('cr_****')
    expect(maskKey('sk-0123456789abcdef')).toBe('****cdef')
  })
})

describe('callback parsing', () => {
  const at = (query: string) => new URL(`http://127.0.0.1:5000${CALLBACK_PATH}?${query}`)
  it('accepts a code with the right state', () => {
    expect(parseCallback(at('code=abc&state=s1'), 's1')).toEqual({ kind: 'code', code: 'abc' })
  })
  it('reports access_denied', () => {
    expect(parseCallback(at('error=access_denied&state=s1'), 's1')).toEqual({ kind: 'denied', error: 'access_denied' })
    expect(parseCallback(at('error=server_error&error_description=x&state=s1'), 's1')).toEqual({ kind: 'denied', error: 'server_error', description: 'x' })
  })
  it('rejects a wrong or missing state before reading anything else', () => {
    expect(parseCallback(at('code=abc&state=other'), 's1')).toEqual({ kind: 'state-mismatch' })
    expect(parseCallback(at('code=abc'), 's1')).toEqual({ kind: 'state-mismatch' })
    expect(parseCallback(at('error=access_denied&state=x'), 's1')).toEqual({ kind: 'state-mismatch' })
  })
  it('rejects a callback with neither code nor error', () => {
    expect(parseCallback(at('state=s1'), 's1')).toEqual({ kind: 'invalid', reason: 'missing code' })
  })
  it('renders bilingual, escaped pages', () => {
    const page = renderCallbackPage('error', '<script>x</script>')
    expect(page).toContain('登录失败')
    expect(page).toContain('Sign-in failed')
    expect(page).not.toContain('<script>x')
    expect(renderCallbackPage('success')).toContain('API key 已保存')
    expect(renderCallbackPage('denied')).toContain('declined')
  })
})

describe('token endpoint', () => {
  it('posts the contract body and reads the grant', async () => {
    const { impl, calls } = tokenFetch(() => jsonResponse(tokenOk()))
    const grant = await exchangeCode({ origin: ORIGIN, code: 'c1', verifier: 'v'.repeat(43), redirectUri: 'http://127.0.0.1:5000/tako/callback', fetch: impl })
    expect(grant).toEqual({ key: KEY, tokenId: 9, name: 'tako-connect@dsh-tako@linux', userName: 'alice', planName: 'Pro' } satisfies TakoGrant)
    expect(calls[0]).toEqual({
      url: 'https://tako.test/api/desktop/token',
      body: { grant_type: 'authorization_code', code: 'c1', code_verifier: 'v'.repeat(43), redirect_uri: 'http://127.0.0.1:5000/tako/callback', client_id: CLIENT_ID },
    })
  })

  it('fails on success:false (Tako answers protocol errors with HTTP 200)', async () => {
    const { impl } = tokenFetch(() => jsonResponse({ success: false, error: 'invalid_grant', message: 'invalid_grant' }))
    await expect(exchangeCode({ origin: ORIGIN, code: 'c', verifier: 'v'.repeat(43), redirectUri: 'r', fetch: impl }))
      .rejects.toMatchObject({ code: 'token-failed', message: 'token exchange failed: invalid_grant' })
  })

  it('fails on HTTP errors, bad JSON, missing keys and network errors', async () => {
    const run = (answer: () => Response | Promise<Response>) => exchangeCode({ origin: ORIGIN, code: 'c', verifier: 'v'.repeat(43), redirectUri: 'r', fetch: tokenFetch(answer).impl })
    await expect(run(() => new Response('bad gateway', { status: 502 }))).rejects.toThrow('HTTP 502')
    await expect(run(() => new Response('not json'))).rejects.toThrow('token exchange failed')
    await expect(run(() => jsonResponse({ success: true, data: { key: '' } }))).rejects.toThrow('no usable key')
    await expect(run(() => jsonResponse({ success: true, data: { key: 'has space' } }))).rejects.toThrow('no usable key')
    await expect(run(() => { throw new TypeError('fetch failed') })).rejects.toMatchObject({ code: 'token-failed', message: 'token request failed: fetch failed' })
  })

  it('whoami and revoke send the key as Bearer', async () => {
    const seen: { url: string, method: string, auth: string | null }[] = []
    const impl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      seen.push({ url: String(input), method: init?.method ?? 'GET', auth: new Headers(init?.headers).get('authorization') })
      if (String(input).endsWith('/me')) return jsonResponse({ success: true, data: { user: { id: '7', name: 'alice' }, plan: { name: 'Pro' }, token: { id: 9, name: 't' }, quota: { remain: 10, used: 2 } } })
      return jsonResponse({ success: true, data: { revoked: true } })
    }) as unknown as typeof fetch
    expect(await fetchMe(ORIGIN, KEY, impl)).toEqual({ userName: 'alice', userId: '7', planName: 'Pro', tokenName: 't', tokenId: 9, quotaRemain: 10, quotaUsed: 2 })
    await revokeKey(ORIGIN, KEY, impl)
    expect(seen).toEqual([
      { url: 'https://tako.test/api/desktop/me', method: 'GET', auth: `Bearer ${KEY}` },
      { url: 'https://tako.test/api/desktop/revoke', method: 'POST', auth: `Bearer ${KEY}` },
    ])
    const unauthorized = vi.fn(async () => jsonResponse({ success: false, error: 'invalid_token', message: 'invalid token' }, 401)) as unknown as typeof fetch
    await expect(fetchMe(ORIGIN, KEY, unauthorized)).rejects.toThrow('whoami failed: invalid_token (invalid token)')
  })
})

describe('loopback flow', () => {
  it('listens on 127.0.0.1 only and exchanges the code with the matching verifier', async () => {
    const { impl, calls } = tokenFetch(() => jsonResponse(tokenOk()))
    const stored: string[] = []
    const handle = await begin({ origin: ORIGIN, fetch: impl, deviceName: 'dsh-tako@test', onGrant: async grant => { stored.push(grant.key) } })
    expect(handle.redirectUri).toBe(`http://127.0.0.1:${handle.port}/tako/callback`)
    expect(handle.port).toBeGreaterThanOrEqual(1024)
    const authorize = new URL(handle.authorizeUrl)
    expect(authorize.searchParams.get('redirect_uri')).toBe(handle.redirectUri)
    expect(authorize.searchParams.get('device_name')).toBe('dsh-tako@test')

    const page = await land(handle, { code: 'the-code', state: stateOf(handle) })
    expect(page.status).toBe(200)
    expect(page.headers.get('content-type')).toContain('text/html')
    const html = await page.text()
    expect(html).toContain('登录成功')
    expect(html).not.toContain(KEY)
    await expect(handle.result).resolves.toMatchObject({ key: KEY, userName: 'alice' })
    expect(stored).toEqual([KEY])
    const verifier = String(calls[0]!.body.code_verifier)
    expect(s256(verifier)).toBe(authorize.searchParams.get('code_challenge'))
    expect(calls[0]!.body).toMatchObject({ code: 'the-code', redirect_uri: handle.redirectUri, client_id: 'tako-connect' })
    // The listener is gone once the flow settled.
    await expect(fetch(handle.redirectUri)).rejects.toThrow()
  })

  it('ignores a callback with the wrong state and still completes with the right one', async () => {
    const { impl, calls } = tokenFetch(() => jsonResponse(tokenOk()))
    const handle = await begin({ origin: ORIGIN, fetch: impl })
    const wrong = await land(handle, { code: 'x', state: 'forged' })
    expect(wrong.status).toBe(400)
    expect(await wrong.text()).toContain('state 不匹配')
    expect(calls).toHaveLength(0)
    const right = await land(handle, { code: 'y', state: stateOf(handle) })
    expect(right.status).toBe(200)
    await expect(handle.result).resolves.toMatchObject({ key: KEY })
    expect(calls).toHaveLength(1)
  })

  it('ends with "denied" on access_denied without calling the token endpoint', async () => {
    const { impl, calls } = tokenFetch(() => jsonResponse(tokenOk()))
    const onGrant = vi.fn(async () => {})
    const handle = await begin({ origin: ORIGIN, fetch: impl, onGrant })
    const page = await land(handle, { error: 'access_denied', state: stateOf(handle) })
    expect(await page.text()).toContain('拒绝')
    await expect(handle.result).rejects.toMatchObject({ code: 'denied', message: 'authorization was denied in the browser' })
    expect(calls).toHaveLength(0)
    expect(onGrant).not.toHaveBeenCalled()
  })

  it('times out', async () => {
    const handle = await begin({ origin: ORIGIN, timeoutMs: 30 })
    await expect(handle.result).rejects.toMatchObject({ code: 'timeout' })
  })

  it('reports a failing token endpoint to the browser and the caller, storing nothing', async () => {
    const { impl } = tokenFetch(() => jsonResponse({ success: false, error: 'invalid_grant', message: 'invalid_grant' }))
    const onGrant = vi.fn(async () => {})
    const handle = await begin({ origin: ORIGIN, fetch: impl, onGrant })
    const page = await land(handle, { code: 'expired', state: stateOf(handle) })
    expect(page.status).toBe(502)
    expect(await page.text()).toContain('invalid_grant')
    await expect(handle.result).rejects.toMatchObject({ code: 'token-failed' })
    expect(onGrant).not.toHaveBeenCalled()
  })

  it('shows an error page when the key cannot be stored', async () => {
    const { impl } = tokenFetch(() => jsonResponse(tokenOk()))
    const handle = await begin({ origin: ORIGIN, fetch: impl, onGrant: async () => { throw new Error('disk full') } })
    const page = await land(handle, { code: 'c', state: stateOf(handle) })
    expect(page.status).toBe(500)
    expect(await page.text()).toContain('disk full')
    await expect(handle.result).rejects.toThrow('the key was issued but could not be saved: disk full')
  })

  it('answers other paths with 404 and non-GET with 405', async () => {
    const { impl } = tokenFetch(() => jsonResponse(tokenOk()))
    const handle = await begin({ origin: ORIGIN, fetch: impl })
    expect((await fetch(`http://127.0.0.1:${handle.port}/other`)).status).toBe(404)
    expect((await fetch(handle.redirectUri, { method: 'POST' })).status).toBe(405)
    await land(handle, { code: 'c', state: stateOf(handle) })
    await handle.result
  })

  it('can be cancelled', async () => {
    const handle = await begin({ origin: ORIGIN })
    handle.cancel()
    await expect(handle.result).rejects.toBeInstanceOf(TakoLoginError)
    await expect(handle.result).rejects.toMatchObject({ code: 'cancelled' })
  })

  it('uses a fixed --port and validates its range', async () => {
    const free = await new Promise<number>(resolve => {
      const probe = createServer().listen(0, '127.0.0.1', () => {
        const { port } = probe.address() as { port: number }
        probe.close(() => resolve(port))
      })
    })
    const handle = await begin({ origin: ORIGIN, port: free })
    expect(handle.redirectUri).toBe(`http://127.0.0.1:${free}/tako/callback`)
    await expect(startBrowserLogin({ origin: ORIGIN, port: 80 })).rejects.toMatchObject({ code: 'listen-failed' })
    await expect(startBrowserLogin({ origin: ORIGIN, port: free })).rejects.toMatchObject({ code: 'listen-failed' })
  })
})
