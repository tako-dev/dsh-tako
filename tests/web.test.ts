import { describe, expect, it, vi } from 'vitest'
import type { BrowserLoginHandle, BrowserLoginOptions, TakoGrant } from '../src/login.ts'
import { TakoLoginError } from '../src/login.ts'
import { createLoginService, LOGIN_ROUTE } from '../src/web.ts'

const KEY = 'cr_0123456789abcdefWXYZ'

function controllableLogin() {
  const pending: { options: BrowserLoginOptions, resolve: (grant: TakoGrant) => Promise<void>, reject: (error: Error) => void, cancel: ReturnType<typeof vi.fn> }[] = []
  const startLogin = vi.fn(async (options: BrowserLoginOptions): Promise<BrowserLoginHandle> => {
    let resolveResult!: (grant: TakoGrant) => void
    let rejectResult!: (error: Error) => void
    const result = new Promise<TakoGrant>((resolve, reject) => { resolveResult = resolve; rejectResult = reject })
    result.catch(() => {})
    const cancel = vi.fn(() => rejectResult(new TakoLoginError('cancelled', 'sign-in cancelled')))
    pending.push({
      options,
      resolve: async grant => { await options.onGrant?.(grant); resolveResult(grant) },
      reject: error => rejectResult(error),
      cancel,
    })
    return { authorizeUrl: `${options.origin}/app/authorize?x=${pending.length}`, redirectUri: 'http://127.0.0.1:50001/tako/callback', port: 50001, result, cancel }
  })
  return { startLogin, pending }
}

const request = (method: 'GET' | 'POST', body?: unknown, query = '') => new Request(`http://127.0.0.1:3000${LOGIN_ROUTE}${query}`, {
  method,
  ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
})
const tick = () => new Promise(resolve => setTimeout(resolve, 0))

function service(overrides: Partial<Parameters<typeof createLoginService>[0]> = {}) {
  const set = vi.fn(async (_ref: never, _value: string) => {})
  const logger = { info: vi.fn(), warn: vi.fn() }
  const login = controllableLogin()
  const svc = createLoginService({ baseURL: 'https://tako.test/v1', apiKeyEnv: 'TAKO_API_KEY', credentials: () => ({ set }), logger, startLogin: login.startLogin, ...overrides })
  return { svc, set, logger, login }
}

describe('Models-page sign-in route', () => {
  it('POST starts a sign-in and returns the authorize URL; success stores the key via ctx.credentials.set', async () => {
    const { svc, set, login, logger } = service()
    expect(await (await svc.handle(request('GET'))).json()).toEqual({ status: 'idle' })
    const started = await (await svc.handle(request('POST', { action: 'start' }))).json() as { status: string, id: string, url: string }
    expect(started).toMatchObject({ status: 'pending', url: 'https://tako.test/app/authorize?x=1', redirectUri: 'http://127.0.0.1:50001/tako/callback' })
    expect(login.pending[0]!.options).toMatchObject({ origin: 'https://tako.test', deviceName: `dsh-tako@${process.platform}` })
    await login.pending[0]!.resolve({ key: KEY, userName: 'alice', planName: 'Pro' })
    await tick()
    expect(set).toHaveBeenCalledExactlyOnceWith('TAKO_API_KEY', KEY)
    const done = await (await svc.handle(request('GET', undefined, `?id=${started.id}`))).json()
    expect(done).toEqual({ status: 'success', id: started.id, user: 'alice', plan: 'Pro', key: 'cr_****WXYZ', credential: 'TAKO_API_KEY' })
    expect(JSON.stringify(done)).not.toContain(KEY)
    expect(logger.info).toHaveBeenCalled()
  })

  it('reports errors with their code', async () => {
    const { svc, login, set } = service()
    const started = await (await svc.handle(request('POST', {}))).json() as { id: string }
    login.pending[0]!.reject(new TakoLoginError('denied', 'authorization was denied in the browser'))
    await tick()
    expect(await (await svc.handle(request('GET', undefined, `?id=${started.id}`))).json()).toMatchObject({ status: 'error', code: 'denied' })
    expect(set).not.toHaveBeenCalled()
  })

  it('a second start cancels the first; cancel ends the pending one; stale ids read idle', async () => {
    const { svc, login } = service()
    const first = await (await svc.handle(request('POST'))).json() as { id: string }
    const second = await (await svc.handle(request('POST'))).json() as { id: string }
    expect(login.pending[0]!.cancel).toHaveBeenCalled()
    expect(await (await svc.handle(request('GET', undefined, `?id=${first.id}`))).json()).toEqual({ status: 'idle' })
    await svc.handle(request('POST', { action: 'cancel' }))
    await tick()
    expect(login.pending[1]!.cancel).toHaveBeenCalled()
    expect(await (await svc.handle(request('GET', undefined, `?id=${second.id}`))).json()).toMatchObject({ status: 'error', code: 'cancelled' })
  })

  it('refuses without a credential service, with a bad apiKeyEnv, or a bad body', async () => {
    expect((await service({ credentials: () => undefined }).svc.handle(request('POST'))).status).toBe(503)
    expect((await service({ apiKeyEnv: 'bad-name' }).svc.handle(request('POST'))).status).toBe(500)
    const { svc } = service()
    expect((await svc.handle(new Request(`http://x${LOGIN_ROUTE}`, { method: 'POST', body: '{' }))).status).toBe(400)
    expect((await svc.handle(request('POST', { action: 'nope' }))).status).toBe(400)
  })

  it('surfaces a listener failure', async () => {
    const { svc } = service({ startLogin: async () => { throw new TakoLoginError('listen-failed', 'EADDRINUSE') } })
    const response = await svc.handle(request('POST'))
    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({ status: 'error', code: 'listen-failed', message: 'EADDRINUSE' })
  })
})
