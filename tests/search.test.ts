import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import {
  applySearch,
  mapTakoSearchResponse,
  pinTakoSearchProvider,
  refreshTakoSearchPin,
  TAKO_SEARCH_PROVIDER_ID,
  TakoSearchProvider,
  type SearchLogger,
  type SettingsLike,
  type TakoSearchProviderOptions,
} from '../src/search.ts'

const ORIGIN = 'https://tako.test'
const KEY = 'cr_0123456789abcdefWXYZ'

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

function searchFetch(body: unknown = { query: 'q', provider: 'kab', results: [] }, status = 200) {
  const fetchImpl = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => jsonResponse(body, status))
  return fetchImpl
}

function provider(overrides: Partial<TakoSearchProviderOptions> & { fetchImpl?: ReturnType<typeof searchFetch>, key?: string | undefined } = {}) {
  const fetchImpl = overrides.fetchImpl ?? searchFetch()
  const { fetchImpl: _ignored, key, resolveApiKey, ...rest } = overrides
  const instance = new TakoSearchProvider({
    origin: ORIGIN,
    resolveApiKey: resolveApiKey ?? (async () => ('key' in overrides ? key : KEY)),
    fetch: fetchImpl as unknown as typeof fetch,
    ...rest,
  })
  return { instance, fetchImpl }
}

const logger = (): SearchLogger => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn() })

function fakeSettings(section: { value?: unknown, user?: unknown } | undefined) {
  const mutate = vi.fn(async () => {})
  const describe = vi.fn((): { ns: string, value?: unknown, user?: unknown }[] => {
    if (section === undefined) return [{ ns: 'other', value: {}, user: {} }]
    return [{ ns: 'web', value: section.value, user: section.user }]
  })
  const settings: SettingsLike = { describe, mutate }
  return { settings, describe, mutate }
}

describe('mapTakoSearchResponse', () => {
  it('maps a full hit, including answer → content and published_at → publishedAt', () => {
    expect(mapTakoSearchResponse({
      query: 'q',
      provider: 'kab',
      answer: 'summary',
      results: [{ title: 'T', url: 'https://a.test', snippet: 'S', published_at: '2024-01-01' }],
    })).toEqual({
      content: 'summary',
      sources: [{ title: 'T', url: 'https://a.test', snippet: 'S', publishedAt: '2024-01-01' }],
      truncated: false,
    })
  })

  it('drops results with an empty or missing url', () => {
    expect(mapTakoSearchResponse({
      results: [
        { title: 'keep', url: 'https://a.test', snippet: 'S' },
        { title: 'blank', url: '', snippet: 'nope' },
        { title: 'missing', snippet: 'nope' },
      ],
    })).toEqual({
      sources: [{ title: 'keep', url: 'https://a.test', snippet: 'S' }],
      truncated: false,
    })
  })

  it('omits blank title, snippet, publishedAt, and answer', () => {
    expect(mapTakoSearchResponse({
      answer: '',
      results: [{ title: '', url: 'https://a.test', snippet: '', published_at: '' }],
    })).toEqual({
      sources: [{ url: 'https://a.test' }],
      truncated: false,
    })
  })

  it('returns empty sources for empty or missing results', () => {
    expect(mapTakoSearchResponse({ query: 'q', provider: 'kab', results: [] })).toEqual({ sources: [], truncated: false })
    expect(mapTakoSearchResponse({})).toEqual({ sources: [], truncated: false })
    expect(mapTakoSearchResponse(null)).toEqual({ sources: [], truncated: false })
  })
})

describe('TakoSearchProvider.search', () => {
  it('POSTs to /v1/search with Bearer, json headers, redirect error, and count from maxResults', async () => {
    const { instance, fetchImpl } = provider()
    const controller = new AbortController()
    await instance.search({ query: 'hello', maxResults: 8 }, controller.signal)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(url).toBe('https://tako.test/v1/search')
    expect(init).toMatchObject({ method: 'POST', redirect: 'error', signal: controller.signal })
    expect(init?.headers).toEqual({
      authorization: `Bearer ${KEY}`,
      'content-type': 'application/json',
      accept: 'application/json',
    })
    expect(JSON.parse(String(init?.body))).toEqual({ query: 'hello', count: 8 })
  })

  it('omits count when maxResults is absent or not a positive integer', async () => {
    const { instance, fetchImpl } = provider()
    await instance.search({ query: 'q' })
    expect(JSON.parse(String(fetchImpl.mock.calls[0]![1]?.body))).toEqual({ query: 'q' })
    await instance.search({ query: 'q', maxResults: 0 })
    expect(JSON.parse(String(fetchImpl.mock.calls[1]![1]?.body))).toEqual({ query: 'q' })
    await instance.search({ query: 'q', maxResults: 1.5 })
    expect(JSON.parse(String(fetchImpl.mock.calls[2]![1]?.body))).toEqual({ query: 'q' })
  })

  it('throws when no key is configured', async () => {
    const { instance, fetchImpl } = provider({ key: undefined })
    await expect(instance.search({ query: 'q' })).rejects.toThrow('no Tako API key is configured')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('uses error.message from HTTP 402 and 400 bodies', async () => {
    const payment = provider({ fetchImpl: searchFetch({ error: { message: 'insufficient quota' } }, 402) })
    await expect(payment.instance.search({ query: 'q' })).rejects.toThrow('insufficient quota')
    const bad = provider({ fetchImpl: searchFetch({ error: { message: 'query is required' } }, 400) })
    await expect(bad.instance.search({ query: 'q' })).rejects.toThrow('query is required')
  })

  it('throws an error whose message includes aborted', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new DOMException('This operation was aborted', 'AbortError')
    })
    const { instance } = provider({ fetchImpl })
    await expect(instance.search({ query: 'q' }, AbortSignal.abort())).rejects.toThrow(/aborted/)
  })

  it('maps a successful JSON body', async () => {
    const { instance } = provider({
      fetchImpl: searchFetch({
        query: 'q',
        provider: 'kab',
        answer: 'summary',
        results: [{ title: 'T', url: 'https://a.test', snippet: 'S' }],
      }),
    })
    await expect(instance.search({ query: 'q' })).resolves.toEqual({
      content: 'summary',
      sources: [{ title: 'T', url: 'https://a.test', snippet: 'S' }],
      truncated: false,
    })
  })
})

describe('TakoSearchProvider.available', () => {
  it('is false until a key is known, and stays false with an unparseable origin', () => {
    const fresh = new TakoSearchProvider({ origin: ORIGIN, resolveApiKey: async () => KEY })
    expect(fresh.available()).toBe(false)
    fresh.setKeyPresence(true)
    expect(fresh.available()).toBe(true)
    const bad = new TakoSearchProvider({ origin: 'not a url', resolveApiKey: async () => KEY })
    bad.setKeyPresence(true)
    expect(bad.available()).toBe(false)
  })

  it('caches true after a successful key resolve', async () => {
    const { instance } = provider()
    expect(instance.available()).toBe(false)
    await instance.search({ query: 'q' })
    expect(instance.available()).toBe(true)
  })
})

describe('pinTakoSearchProvider', () => {
  it('pins factory deepseek-official to tako when configured', async () => {
    const { settings, mutate } = fakeSettings({ value: { searchProvider: 'deepseek-official' } })
    await pinTakoSearchProvider(settings, { configured: true, logger: logger() })
    expect(mutate).toHaveBeenCalledExactlyOnceWith('web', [{ op: 'set', path: ['searchProvider'], value: TAKO_SEARCH_PROVIDER_ID }])
  })

  it('does not extra-mutate when the user layer is already tako', async () => {
    const { settings, mutate } = fakeSettings({
      value: { searchProvider: 'tako' },
      user: { searchProvider: 'tako' },
    })
    await pinTakoSearchProvider(settings, { configured: true, logger: logger() })
    expect(mutate).not.toHaveBeenCalled()
  })

  it('leaves a non-factory user pick such as deepseek-search-api', async () => {
    const { settings, mutate } = fakeSettings({
      value: { searchProvider: 'deepseek-search-api' },
      user: { searchProvider: 'deepseek-search-api' },
    })
    await pinTakoSearchProvider(settings, { configured: true, logger: logger() })
    expect(mutate).not.toHaveBeenCalled()
  })

  it('restores deepseek-official when not configured and the user layer is tako', async () => {
    const { settings, mutate } = fakeSettings({
      value: { searchProvider: 'tako' },
      user: { searchProvider: 'tako' },
    })
    await pinTakoSearchProvider(settings, { configured: false, logger: logger() })
    expect(mutate).toHaveBeenCalledExactlyOnceWith('web', [{ op: 'set', path: ['searchProvider'], value: 'deepseek-official' }])
  })

  it('is a no-op without a web section', async () => {
    const { settings, mutate } = fakeSettings(undefined)
    await pinTakoSearchProvider(settings, { configured: true, logger: logger() })
    expect(mutate).not.toHaveBeenCalled()
  })
})

function searchCtx(options: {
  configured?: boolean
  web?: { registerSearchProvider?: (provider: TakoSearchProvider) => () => void }
  settingsSections?: { ns: string, value?: unknown, user?: unknown }[]
} = {}) {
  const mutate = vi.fn(async () => {})
  const describeSettings = vi.fn(() => options.settingsSections ?? [
    { ns: 'web', value: { searchProvider: 'deepseek-official' }, user: {} },
  ])
  const describeCredential = vi.fn(async () => ({ configured: options.configured ?? true }))
  const resolve = vi.fn(async () => options.configured === false ? undefined : { value: KEY, source: 'file' as const })
  const registerSearchProvider = vi.fn((_provider: TakoSearchProvider) => () => {})
  const disposers: (() => void)[] = []
  const log = { info: vi.fn(), warn: vi.fn(), debug: vi.fn() }
  const credentials = { describe: describeCredential, resolve }
  const web = options.web !== undefined ? options.web : { registerSearchProvider }
  const inner = {
    web,
    credentials,
    logger: log,
    effect: (fn: () => (() => void) | void) => {
      const dispose = fn()
      if (dispose !== undefined) disposers.push(dispose)
    },
  }
  const inject = vi.fn((_deps: string[], fn: (next: typeof inner) => void) => { fn(inner) })
  const ctx = {
    logger: log,
    settings: { describe: describeSettings, mutate },
    get: (name: string) => name === 'credentials' ? credentials : name === 'web' ? web : undefined,
    inject,
    effect: inner.effect,
  }
  return {
    ctx: ctx as unknown as Context,
    inject,
    mutate,
    describeSettings,
    registerSearchProvider,
    describeCredential,
    logger: log,
    dispose: () => { disposers.forEach(dispose => dispose()) },
  }
}

const settle = () => new Promise(resolve => setTimeout(resolve, 20))

describe('applySearch', () => {
  it('injects web + credentials, registers the tako provider, and pins the factory default', async () => {
    const fake = searchCtx({ configured: true })
    applySearch(fake.ctx, { baseURL: 'https://tako.test/v1', apiKeyEnv: 'TAKO_API_KEY' })
    expect(fake.inject).toHaveBeenCalledWith(['web', 'credentials'], expect.any(Function))
    expect(fake.registerSearchProvider).toHaveBeenCalledTimes(1)
    const registered = fake.registerSearchProvider.mock.calls[0]![0]
    expect(registered.id).toBe('tako')
    await settle()
    expect(fake.describeCredential).toHaveBeenCalledWith('TAKO_API_KEY')
    expect(fake.mutate).toHaveBeenCalledWith('web', [{ op: 'set', path: ['searchProvider'], value: 'tako' }])
  })

  it('skips registration when registerSearchProvider is missing', async () => {
    const fake = searchCtx({ web: {} })
    applySearch(fake.ctx, { baseURL: ORIGIN, apiKeyEnv: 'TAKO_API_KEY' })
    expect(fake.logger.debug).toHaveBeenCalled()
    expect(fake.logger.debug.mock.calls.some(call => String(call[0]).includes('registerSearchProvider'))).toBe(true)
  })

  it('unregisters the provider when the effect disposes', () => {
    const unregister = vi.fn()
    const registerSearchProvider = vi.fn(() => unregister)
    const fake = searchCtx({ web: { registerSearchProvider } })
    applySearch(fake.ctx, { baseURL: ORIGIN, apiKeyEnv: 'TAKO_API_KEY' })
    fake.dispose()
    expect(unregister).toHaveBeenCalledTimes(1)
  })
})

describe('refreshTakoSearchPin', () => {
  it('describes the key then pins, and updates the live provider cache', async () => {
    const fake = searchCtx({ configured: true })
    applySearch(fake.ctx, { baseURL: ORIGIN, apiKeyEnv: 'TAKO_API_KEY' })
    const registered = fake.registerSearchProvider.mock.calls[0]![0]
    await settle()
    expect(registered.available()).toBe(true)

    fake.describeCredential.mockResolvedValueOnce({ configured: false })
    fake.mutate.mockClear()
    // Pretend login had already pinned tako into the user layer.
    fake.describeSettings.mockReturnValue([
      { ns: 'web', value: { searchProvider: 'tako' }, user: { searchProvider: 'tako' } },
    ])
    await refreshTakoSearchPin(fake.ctx, { apiKeyEnv: 'TAKO_API_KEY' })
    expect(registered.available()).toBe(false)
    expect(fake.mutate).toHaveBeenCalledWith('web', [{ op: 'set', path: ['searchProvider'], value: 'deepseek-official' }])
  })
})
