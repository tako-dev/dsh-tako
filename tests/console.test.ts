import { describe, expect, it, vi } from 'vitest'
import { createConsoleService, emptyCatalogState, QUOTA_PER_UNIT, type CatalogState, type ConsoleServiceOptions } from '../src/web.ts'

const KEY = 'cr_0123456789abcdefWXYZ'

// The quota numbers of the Tako docs page's worked example
// (https://tako.shiroha.tech/docs/account/balance): 1,000,000 available +
// 250,000 used = 1,250,000 granted, i.e. $2.00 remaining, $0.50 used.
const ME_DATA = {
  user: { id: '7', name: 'e2e-user' },
  plan: { name: 'E2E Plan' },
  token: { id: 3, name: 'tako-connect@dsh-tako@mac' },
  quota: { remain: 1_000_000, used: 250_000 },
}

/** A fake Tako answering `/api/desktop/me` and `/api/desktop/revoke`. */
function takoFetch(options: { meFails?: boolean, meStatus?: number, revokeFails?: boolean, meData?: Record<string, unknown>, logsFails?: boolean, usageFails?: boolean, statsFails?: boolean, modelStatsFails?: boolean, statusFails?: boolean } = {}) {
  const revokedWith: string[] = []
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input)
    if (url.endsWith('/api/desktop/me')) {
      if (options.meFails === true) return Response.json({ success: false, error: 'invalid_token', message: 'invalid token' }, { status: 401 })
      return Response.json({ success: true, data: options.meData ?? ME_DATA })
    }
    if (url.endsWith('/apiStats/api/get-key-id')) {
      return Response.json({ success: true, data: { id: '7' } })
    }
    if (url.endsWith('/apiStats/api/user-quota')) {
      return Response.json({
        plan: { window_cost_limit: 200, window_minutes: 300, weekly_cost_limit: 930 },
        usage: { windowCost: 12, weeklyCost: 80 },
      })
    }
    if (url.endsWith('/api/desktop/revoke')) {
      if (options.revokeFails === true) return Response.json({ success: false, error: 'boom', message: 'revoke refused' }, { status: 200 })
      revokedWith.push(String((init?.headers as Record<string, string>).authorization))
      return Response.json({ success: true, data: { revoked: true } })
    }
    if (url.endsWith('/api/log/token')) {
      if (options.logsFails === true) return Response.json({ success: false, error: 'nope' }, { status: 500 })
      return Response.json({
        success: true,
        data: [
          {
            id: 9, created_at: 1_700_000_100, type: 2, model_name: 'deepseek-v4.1-flash',
            prompt_tokens: 120, completion_tokens: 30, quota: 1_500, use_time: 2,
            is_stream: true, request_id: 'req-9', channel_name: 'ch-a', ip: '1.2.3.4',
            token_name: 'dsh-tako@mac', group: 'default',
            other: '{"internal":true}', username: 'e2e-user', user_id: 7,
          },
          {
            id: 8, created_at: 1_700_000_000, type: 2, model_name: 'deepseek-v4-pro',
            prompt_tokens: 10, completion_tokens: 5, quota: 300, use_time: 1,
            is_stream: false, request_id: 'req-8', channel_name: 'ch-b', ip: '1.2.3.4',
            token_name: 'dsh-tako@mac', group: 'default', other: '{}', user_email: 'x@y.z',
          },
        ],
      })
    }
    if (url.endsWith('/api/usage/token')) {
      if (options.usageFails === true) return Response.json({ success: false, message: 'down' }, { status: 500 })
      return Response.json({
        code: true, message: 'ok',
        data: {
          object: 'token_usage', name: 'dsh-tako@mac',
          total_granted: 5_000_000, total_used: 2_500_000, total_available: 2_500_000,
          unlimited_quota: true, model_limits: { 'deepseek-v4-pro': true }, model_limits_enabled: true,
          expires_at: 0,
        },
      })
    }
    if (url.endsWith('/apiStats/api/user-stats')) {
      if (options.statsFails === true) return Response.json({ success: false, error: 'down' }, { status: 500 })
      return Response.json({ success: true, data: { id: '7', usage: { total: { cost: 3.25 } } } })
    }
    if (url.endsWith('/apiStats/api/user-model-stats')) {
      if (options.modelStatsFails === true) return Response.json({ success: false, error: 'down' }, { status: 500 })
      return Response.json({
        success: true, period: 'daily',
        data: [
          { model: 'deepseek-v4.1-flash', requests: 4, inputTokens: 400, outputTokens: 120, costs: { total: 1.2 }, formatted: { total: '$1.20' } },
          { model: 'deepseek-v4-pro', requests: 2, inputTokens: 800, outputTokens: 60, costs: { total: 2.05 } },
        ],
      })
    }
    if (url.endsWith('/api/status')) {
      if (options.statusFails === true) return Response.json({ success: false }, { status: 500 })
      return Response.json({
        success: true,
        data: { announcements: [
          { id: 11, type: 'warning', publishDate: '2026-11-10T02:00:00Z', popup: true, content: '# first notice' },
          { content: 'second', date: '2026-11-10' },
          { date: 'no content' },
        ] },
      })
    }
    throw new Error(`unexpected fetch ${url}`)
  }) as unknown as typeof fetch
  return { fetchImpl, revokedWith }
}

/** A settings double that mirrors the describe/mutate surface the config route uses. */
function fakeSettings(options: { writable?: boolean, tako?: Record<string, unknown>, web?: Record<string, unknown> } = {}) {
  const takoValue = options.tako ?? {
    baseURL: 'https://tako.test', refreshIntervalMs: 1_800_000, defaultContextWindow: 128_000,
    pinned: ['deepseek-v4.1-flash'], include: [], exclude: [], includeClaudeCodeOnly: false, overrides: {},
  }
  const webValue = options.web ?? { searchProvider: 'tako' }
  const mutate = vi.fn(async (_ns: string, _ops: readonly { op: string, path: readonly string[], value?: unknown }[]) => {})
  const settings = {
    writable: options.writable ?? true,
    describe: vi.fn(() => [
      { ns: 'tako', value: takoValue, user: {} },
      { ns: 'web', value: webValue, user: {} },
    ]),
    mutate,
  }
  return { settings, mutate }
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

  it('reports the masked key and the account behind it, quota both raw and in USD; the plaintext never leaves', async () => {
    const { svc } = service({ resolved: { value: KEY, source: 'file' } })
    const body = await (await svc.handleStatus()).json()
    expect(body).toEqual({
      configured: true,
      origin: 'https://tako.test',
      maskedKey: 'cr_****WXYZ',
      credential: 'TAKO_API_KEY',
      baseURL: 'https://tako.test',
      me: {
        userName: 'e2e-user',
        planName: 'E2E Plan',
        quotaRemain: 1_000_000,
        quotaUsed: 250_000,
        quotaRemainUsd: 2,
        quotaUsedUsd: 0.5,
      },
      plan: {
        windowMinutes: 300, windowCostLimit: 200, weeklyCostLimit: 930,
        windowCost: 12, weeklyCost: 80,
      },
    })
    expect(JSON.stringify(body)).not.toContain(KEY)
  })

  it('converts quota at the rate the site documents: 500,000 points = $1, exact for small answers too', async () => {
    expect(QUOTA_PER_UNIT).toBe(500_000)
    const tako = takoFetch({ meData: { user: { id: '7', name: 'e2e-user' }, quota: { remain: 125_000, used: 25_000 } } })
    const { svc } = service({ resolved: { value: KEY, source: 'file' }, fetch: tako.fetchImpl })
    const body = await (await svc.handleStatus()).json()
    expect(body.me).toEqual({ userName: 'e2e-user', quotaRemain: 125_000, quotaUsed: 25_000, quotaRemainUsd: 0.25, quotaUsedUsd: 0.05 })
    expect(body.plan).toEqual({
      windowMinutes: 300, windowCostLimit: 200, weeklyCostLimit: 930,
      windowCost: 12, weeklyCost: 80,
    })
    const tiny = takoFetch({ meData: { quota: { remain: 1, used: 0 } } })
    const { svc: tinySvc } = service({ resolved: { value: KEY, source: 'file' }, fetch: tiny.fetchImpl })
    expect((await (await tinySvc.handleStatus()).json()).me).toEqual({ quotaRemain: 1, quotaUsed: 0, quotaRemainUsd: 0.000_002, quotaUsedUsd: 0 })
  })

  it('adds no USD fields when /api/desktop/me answers without quota numbers', async () => {
    const tako = takoFetch({ meData: { user: { id: '7', name: 'e2e-user' }, plan: { name: 'E2E Plan' } } })
    const { svc } = service({ resolved: { value: KEY, source: 'file' }, fetch: tako.fetchImpl })
    const body = await (await svc.handleStatus()).json()
    expect(body.me).toEqual({ userName: 'e2e-user', planName: 'E2E Plan' })
    expect(body.plan.windowCostLimit).toBe(200)
  })

  it('caches the whoami answer per key: one fetch within the TTL, refetch after it or on a new key', async () => {
    const { svc, tako, resolve, advance } = service({ resolved: { value: KEY, source: 'file' } })
    await svc.handleStatus()
    await svc.handleStatus()
    expect(tako.fetchImpl).toHaveBeenCalledTimes(3) // me + get-key-id + user-quota
    advance(44_000)
    await svc.handleStatus()
    expect(tako.fetchImpl).toHaveBeenCalledTimes(3) // still fresh
    advance(2_000)
    await svc.handleStatus()
    expect(tako.fetchImpl).toHaveBeenCalledTimes(6) // TTL over
    resolve.mockResolvedValue({ value: 'cr_0099887766554433210z', source: 'file' })
    advance(1_000)
    const body = await (await svc.handleStatus()).json()
    expect(tako.fetchImpl).toHaveBeenCalledTimes(9) // a different key bypasses the cache
    expect(body.maskedKey).toBe('cr_****210z')
  })

  it('refetches when different credentials share the same visible mask', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      const auth = new Headers(init?.headers).get('authorization')
      if (url.endsWith('/api/desktop/me')) return Response.json({ success: true,
        data: { user: { name: auth?.includes('account-a') ? 'account-a' : 'account-b' } } })
      if (url.endsWith('/apiStats/api/get-key-id')) return Response.json({ success: true, data: { id: 'fixture-user' } })
      return Response.json({})
    }) as unknown as typeof fetch
    const { svc, resolve } = service({ resolved: { value: 'cr_fixture-account-a-SAME', source: 'file' }, fetch: fetchImpl })
    expect((await (await svc.handleStatus()).json()).me.userName).toBe('account-a')
    resolve.mockResolvedValue({ value: 'cr_fixture-account-b-SAME', source: 'file' })
    const body = await (await svc.handleStatus()).json()
    expect(body.me.userName).toBe('account-b')
    expect(body.maskedKey).toBe('cr_****SAME')
    expect(fetchImpl).toHaveBeenCalledTimes(6)
    expect(Object.keys(body).sort()).toEqual(['baseURL', 'configured', 'credential', 'maskedKey', 'me', 'origin', 'plan'])
    expect(JSON.stringify(body)).not.toContain('fixture-account')
    await svc.handleStatus()
    expect(fetchImpl).toHaveBeenCalledTimes(6)
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

  it('notifies onCredentialChange after unsetting a file-source key', async () => {
    const onCredentialChange = vi.fn()
    const { svc, unset } = service({ resolved: { value: KEY, source: 'file' }, onCredentialChange })
    await svc.handleLogout()
    expect(unset).toHaveBeenCalledExactlyOnceWith('TAKO_API_KEY')
    expect(onCredentialChange).toHaveBeenCalledTimes(1)
    expect(unset.mock.invocationCallOrder[0]!).toBeLessThan(onCredentialChange.mock.invocationCallOrder[0]!)
  })

  it('does not notify onCredentialChange for an env-sourced key', async () => {
    const onCredentialChange = vi.fn()
    const { svc, unset } = service({ resolved: { value: KEY, source: 'env' }, onCredentialChange })
    await svc.handleLogout()
    expect(unset).not.toHaveBeenCalled()
    expect(onCredentialChange).not.toHaveBeenCalled()
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
  it('returns recovery phase, attempts, configured interval and safe stage error', async () => {
    const catalog: CatalogState = { models: [], lastSyncAt: null, nextSyncAt: 1234, refreshIntervalMs: 1800000,
      status: 'retrying', attempts: 2, lastError: { code: 'write-failed', message: 'The model settings update did not complete.', at: 1200 } }
    const { svc } = service({ catalogState: catalog })
    expect(await (await svc.handleCatalog()).json()).toEqual(catalog)
  })

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

describe('console route /api/tako.key', () => {
  const post = (body: unknown): Request => new Request('http://localhost/api/tako.key', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

  it('verifies the pasted key against Tako before storing it, and answers with the mask only', async () => {
    const onCredentialChange = vi.fn()
    const { svc, set, tako } = service({ onCredentialChange })
    const response = await svc.handleKey(post({ key: `  ${KEY}  ` }))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.maskedKey).toBe('cr_****WXYZ')
    expect(body.credential).toBe('TAKO_API_KEY')
    expect(body.me).toEqual({
      userName: 'e2e-user',
      planName: 'E2E Plan',
      quotaRemain: 1_000_000,
      quotaUsed: 250_000,
      quotaRemainUsd: 2,
      quotaUsedUsd: 0.5,
    })
    expect(JSON.stringify(body)).not.toContain(KEY)
    expect(set).toHaveBeenCalledWith('TAKO_API_KEY', KEY)
    expect(onCredentialChange).toHaveBeenCalledTimes(1)
    expect(tako.fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('refuses a key Tako rejects, and stores nothing', async () => {
    const onCredentialChange = vi.fn()
    const tako = takoFetch({ meFails: true })
    const { svc, set } = service({ fetch: tako.fetchImpl, onCredentialChange })
    const response = await svc.handleKey(post({ key: 'cr_wrongwrongwrong' }))
    expect(response.status).toBe(401)
    const body = await response.json()
    expect(body.ok).toBe(false)
    expect(body.code).toBe('invalid')
    expect(set).not.toHaveBeenCalled()
    expect(onCredentialChange).not.toHaveBeenCalled()
  })

  it('rejects values that cannot be a key without touching Tako', async () => {
    const { svc, set, tako } = service()
    for (const body of [{ key: 'short' }, { key: 'has space in it' }, { key: 42 }, {}]) {
      const response = await svc.handleKey(post(body))
      expect(response.status).toBe(400)
      expect((await response.json()).ok).toBe(false)
    }
    expect(set).not.toHaveBeenCalled()
    expect(tako.fetchImpl).not.toHaveBeenCalled()
  })

  it('clears a file-sourced key locally without revoking it on Tako', async () => {
    const onCredentialChange = vi.fn()
    const { svc, unset } = service({ resolved: { value: KEY, source: 'file' }, onCredentialChange })
    const response = await svc.handleKey(post({ action: 'clear' }))
    const body = await response.json()
    expect(body).toEqual({ ok: true, action: 'removed' })
    expect(unset).toHaveBeenCalledWith('TAKO_API_KEY')
    expect(onCredentialChange).toHaveBeenCalledTimes(1)
  })

  it('leaves an environment-sourced key alone', async () => {
    const { svc, unset } = service({ resolved: { value: KEY, source: 'env' } })
    const body = await (await svc.handleKey(post({ action: 'clear' }))).json()
    expect(body).toEqual({ ok: true, action: 'external', source: 'env' })
    expect(unset).not.toHaveBeenCalled()
  })
})

describe('console route /api/tako.logs', () => {
  const get = (query = ''): Request => new Request(`http://localhost/api/tako.logs${query}`)

  it('answers not-configured without a stored key and never calls Tako', async () => {
    const { svc, tako } = service()
    expect(await (await svc.handleLogs(get())).json()).toEqual({ ok: false, code: 'not-configured' })
    expect(tako.fetchImpl).not.toHaveBeenCalled()
  })

  it('forwards the key’s own log rows in camelCase and drops the internals', async () => {
    const { svc } = service({ resolved: { value: KEY, source: 'file' } })
    const body = await (await svc.handleLogs(get())).json()
    expect(body.ok).toBe(true)
    expect(body.logs).toHaveLength(2)
    expect(body.logs[0]).toEqual({
      id: 9, createdAt: 1_700_000_100, type: 2, modelName: 'deepseek-v4.1-flash',
      promptTokens: 120, completionTokens: 30, quota: 1_500, useTime: 2,
      isStream: true, requestId: 'req-9', channelName: 'ch-a', ip: '1.2.3.4',
      tokenName: 'dsh-tako@mac', group: 'default',
    })
    // `other`, username, user_id and user_email never leave the host.
    const raw = JSON.stringify(body)
    expect(raw).not.toContain('internal')
    expect(raw).not.toContain('username')
    expect(raw).not.toContain('user_id')
    expect(raw).not.toContain('user_email')
    expect(raw).not.toContain(KEY)
  })

  it('filters by ?model=', async () => {
    const { svc } = service({ resolved: { value: KEY, source: 'file' } })
    const body = await (await svc.handleLogs(get('?model=deepseek-v4-pro'))).json()
    expect(body.logs).toHaveLength(1)
    expect(body.logs[0].modelName).toBe('deepseek-v4-pro')
  })

  it('maps an upstream failure to 502 with a safe message', async () => {
    const tako = takoFetch({ logsFails: true })
    const { svc } = service({ resolved: { value: KEY, source: 'file' }, fetch: tako.fetchImpl })
    const response = await svc.handleLogs(get())
    expect(response.status).toBe(502)
    expect(await response.json()).toMatchObject({ ok: false, code: 'upstream' })
  })
})

describe('console route /api/tako.usage', () => {
  it('answers not-configured without a stored key', async () => {
    const { svc, tako } = service()
    expect(await (await svc.handleUsage()).json()).toEqual({ ok: false, code: 'not-configured' })
    expect(tako.fetchImpl).not.toHaveBeenCalled()
  })

  it('aggregates token detail, daily cost and per-model usage', async () => {
    const { svc } = service({ resolved: { value: KEY, source: 'file' } })
    const body = await (await svc.handleUsage()).json()
    expect(body).toEqual({
      ok: true,
      token: {
        name: 'dsh-tako@mac',
        granted: 5_000_000, used: 2_500_000, available: 2_500_000,
        grantedUsd: 10, usedUsd: 5, availableUsd: 5,
        unlimitedQuota: true,
        modelLimits: { 'deepseek-v4-pro': true }, modelLimitsEnabled: true,
        expiresAt: 0,
      },
      dailyCostUsd: 3.25,
      models: [
        { model: 'deepseek-v4.1-flash', requests: 4, inputTokens: 400, outputTokens: 120, costUsd: 1.2 },
        { model: 'deepseek-v4-pro', requests: 2, inputTokens: 800, outputTokens: 60, costUsd: 2.05 },
      ],
    })
    expect(JSON.stringify(body)).not.toContain(KEY)
  })

  it('degrades each leg independently instead of failing the whole answer', async () => {
    const tako = takoFetch({ usageFails: true })
    const { svc } = service({ resolved: { value: KEY, source: 'file' }, fetch: tako.fetchImpl })
    const body = await (await svc.handleUsage()).json()
    expect(body.ok).toBe(true)
    expect(body.token).toBeNull()
    expect(body.tokenError).toBeTruthy()
    expect(body.dailyCostUsd).toBe(3.25)
    expect(body.models).toHaveLength(2)

    const stats = takoFetch({ modelStatsFails: true })
    const { svc: svc2 } = service({ resolved: { value: KEY, source: 'file' }, fetch: stats.fetchImpl })
    const body2 = await (await svc2.handleUsage()).json()
    expect(body2.token.name).toBe('dsh-tako@mac')
    expect(body2.dailyCostUsd).toBe(3.25)
    expect(body2.models).toBeUndefined()
    expect(body2.modelStatsError).toBeTruthy()
  })
})

describe('console route /api/tako.notice', () => {
  it('passes the site announcements through without needing a key', async () => {
    const { svc } = service()
    const body = await (await svc.handleNotice()).json()
    expect(body).toEqual({
      ok: true,
      announcements: [
        { content: '# first notice', id: 11, type: 'warning', publishDate: '2026-11-10T02:00:00Z', popup: true },
        { content: 'second', date: '2026-11-10' },
      ],
    })
  })

  it('serves the cache inside ten minutes and refetches after it', async () => {
    const { svc, tako, advance } = service()
    await svc.handleNotice()
    await svc.handleNotice()
    expect(tako.fetchImpl).toHaveBeenCalledTimes(1)
    advance(10 * 60_000 + 1)
    await svc.handleNotice()
    expect(tako.fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('fails closed on an upstream error', async () => {
    const tako = takoFetch({ statusFails: true })
    const { svc } = service({ fetch: tako.fetchImpl })
    const response = await svc.handleNotice()
    expect(response.status).toBe(502)
    expect((await response.json()).ok).toBe(false)
  })
})

describe('console route /api/tako.config', () => {
  const post = (body: unknown): Request => new Request('http://localhost/api/tako.config', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

  it('reads the resolved plugin row and the search provider', async () => {
    const { settings } = fakeSettings()
    const { svc } = service({ settings })
    const body = await (await svc.handleConfig(new Request('http://localhost/api/tako.config'))).json()
    expect(body.ok).toBe(true)
    expect(body.writable).toBe(true)
    expect(body.config.baseURL).toBe('https://tako.test')
    expect(body.config.refreshIntervalMs).toBe(1_800_000)
    expect(body.config.apiKeyEnv).toBeUndefined()
    expect(body.webSearchProvider).toBe('tako')
  })

  it('mutates the plugin row for documented fields and pokes a resync', async () => {
    const { settings, mutate } = fakeSettings()
    const requestSync = vi.fn()
    const { svc } = service({ settings, requestSync })
    const response = await svc.handleConfig(post({ set: { refreshIntervalMs: 60_000, pinned: ['a', 'b'], includeClaudeCodeOnly: true } }))
    expect(response.status).toBe(200)
    expect(mutate).toHaveBeenCalledWith('tako', [
      { op: 'set', path: ['refreshIntervalMs'], value: 60_000 },
      { op: 'set', path: ['pinned'], value: ['a', 'b'] },
      { op: 'set', path: ['includeClaudeCodeOnly'], value: true },
    ])
    expect(requestSync).toHaveBeenCalledTimes(1)
  })

  it('routes webSearchProvider to the web section', async () => {
    const { settings, mutate } = fakeSettings()
    const { svc } = service({ settings })
    await svc.handleConfig(post({ set: { webSearchProvider: 'deepseek-official' } }))
    expect(mutate).toHaveBeenCalledWith('web', [{ op: 'set', path: ['searchProvider'], value: 'deepseek-official' }])
    expect(mutate).not.toHaveBeenCalledWith('tako', expect.anything())
  })

  it('rejects unknown fields and invalid values without mutating', async () => {
    const { settings, mutate } = fakeSettings()
    const { svc } = service({ settings })
    for (const set of [
      { refreshIntervalMs: -5 }, { defaultContextWindow: 0 }, { pinned: 'x' },
      { includeClaudeCodeOnly: 'yes' }, { webSearchProvider: 'exa' }, { bogus: 1 },
      { overrides: { m: { reasoningEfforts: { nonsense: 'x' } } } },
      { overrides: { m: { unknownField: 1 } } },
    ]) {
      const response = await svc.handleConfig(post({ set }))
      expect(response.status).toBe(400)
      expect((await response.json()).ok).toBe(false)
    }
    expect(mutate).not.toHaveBeenCalled()
  })

  it('accepts a valid overrides map', async () => {
    const { settings, mutate } = fakeSettings()
    const { svc } = service({ settings })
    const overrides = { 'swe-2': { reasoningEfforts: { low: 'low', off: null }, contextWindow: 256_000 } }
    const response = await svc.handleConfig(post({ set: { overrides } }))
    expect(response.status).toBe(200)
    expect(mutate).toHaveBeenCalledWith('tako', [{ op: 'set', path: ['overrides'], value: overrides }])
  })

  it('refuses writes on a read-only profile', async () => {
    const { settings, mutate } = fakeSettings({ writable: false })
    const { svc } = service({ settings })
    const response = await svc.handleConfig(post({ set: { refreshIntervalMs: 1 } }))
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ ok: false, code: 'read-only' })
    expect(mutate).not.toHaveBeenCalled()
    const get = await svc.handleConfig(new Request('http://localhost/api/tako.config'))
    expect((await get.json()).writable).toBe(false)
  })

  it('answers no-entry when the plugin row is not described', async () => {
    const settings = {
      writable: true,
      describe: vi.fn(() => [{ ns: 'other', value: {}, user: {} }]),
      mutate: vi.fn(async () => {}),
    }
    const { svc } = service({ settings })
    expect(await (await svc.handleConfig(new Request('http://localhost/api/tako.config'))).json()).toEqual({ ok: false, code: 'no-entry' })
  })
})

describe('console route /api/tako.sync', () => {
  it('triggers the exposed sync and answers ok', async () => {
    const requestSync = vi.fn()
    const { svc } = service({ requestSync })
    expect(await (await svc.handleSync()).json()).toEqual({ ok: true })
    expect(requestSync).toHaveBeenCalledTimes(1)
  })

  it('reports unavailable when no sync loop exposed a trigger', async () => {
    const { svc } = service()
    expect(await (await svc.handleSync()).json()).toEqual({ ok: false, code: 'unavailable' })
  })
})
