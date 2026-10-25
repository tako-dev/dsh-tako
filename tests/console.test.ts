import { describe, expect, it, vi } from 'vitest'
import { createConsoleService, emptyCatalogState, type CatalogState, type ConsoleServiceOptions } from '../src/web.ts'

const KEY = 'cr_0123456789abcdefWXYZ'

const ME_DATA = {
  user: { id: '7', name: 'e2e-user' },
  plan: { name: 'E2E Plan' },
  token: { id: 3, name: 'tako-connect@dsh-tako@mac' },
  quota: { remain: 1000, used: 5 },
}

/** A fake Tako answering `/api/desktop/me` and `/api/desktop/revoke`. */
function takoFetch(options: { meFails?: boolean, meStatus?: number, revokeFails?: boolean } = {}) {
  const revokedWith: string[] = []
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input)
    if (url.endsWith('/api/desktop/me')) {
      if (options.meFails === true) return Response.json({ success: false, error: 'invalid_token', message: 'invalid token' }, { status: 401 })
      return Response.json({ success: true, data: ME_DATA })
    }
    if (url.endsWith('/api/desktop/revoke')) {
      if (options.revokeFails === true) return Response.json({ success: false, error: 'boom', message: 'revoke refused' }, { status: 200 })
      revokedWith.push(String((init?.headers as Record<string, string>).authorization))
      return Response.json({ success: true, data: { revoked: true } })
    }
    throw new Error(`unexpected fetch ${url}`)
  }) as unknown as typeof fetch
  return { fetchImpl, revokedWith }
}

function service(overrides: Partial<ConsoleServiceOptions> & { resolved?: { value: string, source: string } | undefined, catalogState?: CatalogState } = {}) {
  const { resolved, catalogState, ...rest } = overrides
  const resolve = vi.fn(async () => resolved)
  const unset = vi.fn(async () => {})
  const set = vi.fn(async () => {})
  const logger = { info: vi.fn(), warn: vi.fn() }
  const catalog = catalogState ?? emptyCatalogState()
  const tako = takoFetch()
  let clock = 1_000
  const svc = createConsoleService({
    baseURL: 'https://tako.test/v1',
    apiKeyEnv: 'TAKO_API_KEY',
    credentials: () => ({ resolve, unset, set }),
    catalog: () => catalog,
    logger,
    fetch: tako.fetchImpl,
    statusCacheMs: 45_000,
    now: () => clock,
    ...rest,
  })
  return { svc, resolve, unset, set, logger, catalog, tako, advance: (ms: number) => { clock += ms } }
}

describe('console route /api/tako.status', () => {
  it('answers {configured:false} without a stored key and never calls Tako', async () => {
    const { svc, tako } = service()
    const response = await svc.handleStatus()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ configured: false })
    expect(tako.fetchImpl).not.toHaveBeenCalled()
  })

  it('reports the masked key and the account behind it; the plaintext never leaves', async () => {
    const { svc } = service({ resolved: { value: KEY, source: 'file' } })
    const body = await (await svc.handleStatus()).json()
    expect(body).toEqual({
      configured: true,
      maskedKey: 'cr_****WXYZ',
      credential: 'TAKO_API_KEY',
      me: { userName: 'e2e-user', planName: 'E2E Plan', quotaRemain: 1000, quotaUsed: 5 },
    })
    expect(JSON.stringify(body)).not.toContain(KEY)
  })

  it('caches the whoami answer per key: one fetch within the TTL, refetch after it or on a new key', async () => {
    const { svc, tako, resolve, advance } = service({ resolved: { value: KEY, source: 'file' } })
    await svc.handleStatus()
    await svc.handleStatus()
    expect(tako.fetchImpl).toHaveBeenCalledTimes(1)
    advance(44_000)
    await svc.handleStatus()
    expect(tako.fetchImpl).toHaveBeenCalledTimes(1) // still fresh
    advance(2_000)
    await svc.handleStatus()
    expect(tako.fetchImpl).toHaveBeenCalledTimes(2) // TTL over
    resolve.mockResolvedValue({ value: 'cr_0099887766554433210z', source: 'file' })
    advance(1_000)
    const body = await (await svc.handleStatus()).json()
    expect(tako.fetchImpl).toHaveBeenCalledTimes(3) // a different key bypasses the cache
    expect(body.maskedKey).toBe('cr_****210z')
  })

  it('keeps the page usable when whoami fails: configured with me:null and meError, HTTP 200', async () => {
    const tako = takoFetch({ meFails: true })
    const { svc } = service({ resolved: { value: KEY, source: 'file' }, fetch: tako.fetchImpl })
    const response = await svc.handleStatus()
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body).toMatchObject({ configured: true, maskedKey: 'cr_****WXYZ', me: null })
    expect(body.meError).toContain('whoami failed')
  })
})

describe('console route /api/tako.logout', () => {
  it('revokes the stored key on Tako and unsets the credential', async () => {
    const { svc, unset, tako } = service({ resolved: { value: KEY, source: 'file' } })
    const body = await (await svc.handleLogout()).json()
    expect(body).toEqual({ ok: true, action: 'revoked' })
    expect(tako.revokedWith).toEqual([`Bearer ${KEY}`])
    expect(unset).toHaveBeenCalledExactlyOnceWith('TAKO_API_KEY')
  })

  it('still removes the credential when the revoke call fails, and says so', async () => {
    const tako = takoFetch({ revokeFails: true })
    const { svc, unset, logger } = service({ resolved: { value: KEY, source: 'file' }, fetch: tako.fetchImpl })
    const body = await (await svc.handleLogout()).json()
    expect(body.ok).toBe(true)
    expect(body.action).toBe('removed')
    expect(body.warning).toContain('cr_****WXYZ')
    expect(JSON.stringify(body)).not.toContain(KEY)
    expect(unset).toHaveBeenCalledExactlyOnceWith('TAKO_API_KEY')
    expect(logger.warn).toHaveBeenCalled()
  })

  it('is a no-op without a stored key', async () => {
    const { svc, unset, tako } = service()
    expect(await (await svc.handleLogout()).json()).toEqual({ ok: true, action: 'not-configured' })
    expect(unset).not.toHaveBeenCalled()
    expect(tako.fetchImpl).not.toHaveBeenCalled()
  })

  it('does not touch a key that comes from the environment, like the logout CLI', async () => {
    const { svc, unset, tako } = service({ resolved: { value: KEY, source: 'env' } })
    expect(await (await svc.handleLogout()).json()).toEqual({ ok: true, action: 'external', source: 'env' })
    expect(unset).not.toHaveBeenCalled()
    expect(tako.fetchImpl).not.toHaveBeenCalled()
  })
})

describe('console route /api/tako.catalog', () => {
  it('answers empty before the first sync instead of failing', async () => {
    const { svc } = service()
    expect(await (await svc.handleCatalog()).json()).toEqual({ models: [], lastSyncAt: null, nextSyncAt: null })
  })

  it('returns the synced models with their timestamps, as a copy', async () => {
    const catalog: CatalogState = {
      models: [
        { id: 'deepseek-v4.1-flash', name: 'deepseek-v4.1-flash', contextWindow: 1_000_000, input: ['text', 'image'] },
        { id: 'tako-auto' },
      ],
      lastSyncAt: 123,
      nextSyncAt: 456,
    }
    const { svc } = service({ catalogState: catalog })
    const body = await (await svc.handleCatalog()).json()
    expect(body).toEqual({
      models: [
        { id: 'deepseek-v4.1-flash', name: 'deepseek-v4.1-flash', contextWindow: 1_000_000, input: ['text', 'image'] },
        { id: 'tako-auto' },
      ],
      lastSyncAt: 123,
      nextSyncAt: 456,
    })
    // The response is a copy: mutating it does not reach the sync state.
    const first = await (await svc.handleCatalog()).json()
    first.models[0].id = 'mutated'
    expect((await (await svc.handleCatalog()).json()).models[0].id).toBe('deepseek-v4.1-flash')
  })
})
