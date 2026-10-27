import { existsSync, readFileSync, statSync } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Config as PluginConfig } from '../src/index.ts'
import { apply, canonicalJson, checkCredential, Config, FALLBACK_MODELS, MISSING_KEY_HINT, normalizeOrigin, PI_AI_NS, routeProfile, start } from '../src/index.ts'
import type { CatalogState } from '../src/web.ts'

const fixtureText = readFileSync(new URL('./fixtures/pricing-2026-10-25.json', import.meta.url), 'utf8')

/** pi-ai schema defaults the resolved value carries but the profile layer does not. */
const PI_AI_DEFAULTS = { defaultMaxTokens: 32768, defaultInput: ['text'], streamIdleTimeoutMs: 120000 }

interface FakeOptions {
  user?: Record<string, unknown>
  base?: Record<string, unknown>
  writable?: boolean
  sectionMissingFor?: number
  keyConfigured?: boolean
  noCredentials?: boolean
}

function fakeCtx(options: FakeOptions = {}) {
  let user: Record<string, unknown> = structuredClone(options.user ?? {})
  const base: Record<string, unknown> = options.base ?? {}
  let missing = options.sectionMissingFor ?? 0
  const withDefaults = (providers: Record<string, unknown>) => Object.fromEntries(
    Object.entries(providers).map(([key, value]) => [key, { ...PI_AI_DEFAULTS, ...value as object }]),
  )
  const mutate = vi.fn(async (ns: string, ops: { op: string, path: readonly string[], value?: unknown }[]) => {
    expect(ns).toBe(PI_AI_NS)
    for (const op of ops) {
      expect(op.op).toBe('set')
      expect(op.path).toEqual(['providers', 'tako'])
      user = { ...user, tako: structuredClone(op.value) }
    }
  })
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
  const disposers: (() => void)[] = []
  const settings = {
    writable: options.writable ?? true,
    describe: vi.fn(() => {
      if (missing > 0) { missing--; return [] }
      return [
        { ns: 'other', value: {}, user: {} },
        { ns: PI_AI_NS, value: { providers: withDefaults({ ...base, ...user }) }, user: { providers: structuredClone(user) }, base: { providers: base } },
      ]
    }),
    mutate,
  }
  const describeCredential = vi.fn(async (_ref: string) => ({ configured: options.keyConfigured ?? true }))
  const credentials = options.noCredentials === true ? undefined : { describe: describeCredential }
  const inject = vi.fn()
  const ctx = {
    settings,
    logger,
    get: (name: string) => name === 'credentials' ? credentials : undefined,
    inject,
    effect: (fn: () => () => void) => { disposers.push(fn()) },
  } as unknown as Context
  return { ctx, mutate, logger, settings, inject, describeCredential, user: () => user, dispose: () => disposers.forEach(fn => fn()) }
}

const okFetch = (body: string = fixtureText) => vi.fn(async () => new Response(body, { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch
const failFetch = () => vi.fn(async () => { throw new TypeError('fetch failed') }) as unknown as typeof fetch

const config = (patch: Partial<PluginConfig> = {}): PluginConfig => ({ ...Config({} as PluginConfig), refreshIntervalMs: 0, ...patch })

async function until(predicate: () => boolean, ms = 2000): Promise<void> {
  const deadline = Date.now() + ms
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('condition not met')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}
const settle = () => new Promise(resolve => setTimeout(resolve, 50))

const stops: (() => void)[] = []
afterEach(() => { stops.splice(0).forEach(stop => stop()) })

describe('config', () => {
  it('has the documented defaults', () => {
    const value = Config({} as PluginConfig)
    expect(value).toMatchObject({
      baseURL: 'https://tako.shiroha.tech',
      apiKeyEnv: 'TAKO_API_KEY',
      defaultContextWindow: 128000,
      refreshIntervalMs: 1_800_000,
      pinned: ['deepseek-v4.1-flash', 'deepseek-v4-pro', 'tako-auto'],
      include: [],
      exclude: [],
      includeClaudeCodeOnly: false,
      overrides: {},
    })
  })

  it('normalizes the origin', () => {
    expect(normalizeOrigin('https://tako.shiroha.tech/v1/')).toBe('https://tako.shiroha.tech')
    expect(normalizeOrigin(' https://tako.shiroha.tech// ')).toBe('https://tako.shiroha.tech')
    expect(routeProfile(config({ baseURL: 'https://x.test/v1' }), []).baseURL).toBe('https://x.test/v1')
  })

  it('canonical JSON ignores key order', () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { y: 1, x: 2 }], c: 2 } })).toBe(canonicalJson({ a: { c: 2, d: [1, { x: 2, y: 1 }] }, b: 1 }))
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]))
  })
})

describe('sync', () => {
  it('writes the route once from the directory', async () => {
    const fake = fakeCtx()
    const fetchImpl = okFetch()
    stops.push(start(fake.ctx, config(), { fetch: fetchImpl }))
    await until(() => fake.mutate.mock.calls.length === 1)
    expect(fetchImpl).toHaveBeenCalledWith('https://tako.shiroha.tech/api/pricing', expect.anything())
    const route = fake.user().tako as ReturnType<typeof routeProfile> & {
      models: { id: string, contextWindow?: number, reasoningEfforts?: unknown }[]
    }
    expect(route).toMatchObject({
      displayName: 'Tako', api: 'openai-completions', baseURL: 'https://tako.shiroha.tech/v1',
      apiKeyEnv: 'TAKO_API_KEY', defaultContextWindow: 128000,
      compat: { thinkingFormat: 'openai', supportsReasoningEffort: true },
    })
    expect(route.models.every(model => model.reasoningEfforts !== undefined)).toBe(true)
    expect(route.models).toHaveLength(35)
    expect(route.models.slice(0, 3).map(model => model.id)).toEqual(['deepseek-v4.1-flash', 'deepseek-v4-pro', 'tako-auto'])
    expect(route.models.find(model => model.id === 'gpt-6-sol')?.contextWindow).toBe(1_050_000)
    expect(fake.logger.info).toHaveBeenCalledWith('Tako route updated with %d models', 35)
  })

  it('does not write when the stored route is unchanged, even reordered', async () => {
    const first = fakeCtx()
    stops.push(start(first.ctx, config(), { fetch: okFetch() }))
    await until(() => first.mutate.mock.calls.length === 1)
    // Same value as a YAML round trip may hand it back: keys in another order.
    const reorder = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(reorder)
      if (value === null || typeof value !== 'object') return value
      return Object.fromEntries(Object.entries(value).reverse().map(([key, inner]) => [key, reorder(inner)]))
    }
    const stored = reorder(first.user().tako) as Record<string, unknown>
    expect(Object.keys(stored)[0]).toBe('models')
    const second = fakeCtx({ user: { tako: stored } })
    stops.push(start(second.ctx, config(), { fetch: okFetch() }))
    await settle()
    expect(second.settings.describe).toHaveBeenCalled()
    expect(second.mutate).not.toHaveBeenCalled()
  })

  it('rewrites when the directory changes', async () => {
    const fake = fakeCtx()
    stops.push(start(fake.ctx, config(), { fetch: okFetch() }))
    await until(() => fake.mutate.mock.calls.length === 1)
    const fixture = JSON.parse(fixtureText) as { data: { model_name: string }[] }
    fixture.data = fixture.data.filter(card => card.model_name !== 'hy3')
    const again = fakeCtx({ user: { tako: fake.user().tako as Record<string, unknown> } })
    stops.push(start(again.ctx, config(), { fetch: okFetch(JSON.stringify(fixture)) }))
    await until(() => again.mutate.mock.calls.length === 1)
    expect((again.user().tako as { models: unknown[] }).models).toHaveLength(34)
  })

  it('leaves other providers alone', async () => {
    const fake = fakeCtx({ user: { mine: { displayName: 'Mine' } } })
    stops.push(start(fake.ctx, config(), { fetch: okFetch() }))
    await until(() => fake.mutate.mock.calls.length === 1)
    expect(fake.user().mine).toEqual({ displayName: 'Mine' })
  })

  it('seeds the fallback only when the route is absent and the directory is down', async () => {
    const fake = fakeCtx()
    stops.push(start(fake.ctx, config(), { fetch: failFetch() }))
    await until(() => fake.mutate.mock.calls.length === 1)
    expect((fake.user().tako as { models: unknown }).models).toEqual(FALLBACK_MODELS)
    expect(fake.logger.warn).toHaveBeenCalledWith('Tako model directory refresh failed: %s', 'fetch failed')
  })

  it('records the synced catalog (and the fallback seed) for the console route', async () => {
    const catalog: CatalogState = { models: [], lastSyncAt: null, nextSyncAt: null }
    const fake = fakeCtx()
    stops.push(start(fake.ctx, config({ refreshIntervalMs: 30 * 60_000 }), { catalog, fetch: okFetch() }))
    await until(() => fake.mutate.mock.calls.length === 1)
    expect(catalog.models.length).toBe(35)
    expect(catalog.lastSyncAt).toBeLessThanOrEqual(Date.now())
    expect(catalog.nextSyncAt).toBeGreaterThan(catalog.lastSyncAt!)
    expect(catalog.nextSyncAt! - catalog.lastSyncAt!).toBe(30 * 60_000)
    // A failing directory with no stored route seeds the fallback and records it.
    const seeded: CatalogState = { models: [], lastSyncAt: null, nextSyncAt: null }
    const down = fakeCtx()
    stops.push(start(down.ctx, config(), { catalog: seeded, fetch: failFetch() }))
    await until(() => down.mutate.mock.calls.length === 1)
    expect(seeded.models).toEqual(FALLBACK_MODELS)
    expect(seeded.nextSyncAt).toBeNull() // refreshIntervalMs 0 -> startup-only
  })

  it('keeps an existing route when the directory is down', async () => {
    const existing = routeProfile(config(), [{ id: 'kept', name: 'kept', input: ['text'] }])
    const fake = fakeCtx({ user: { tako: existing } })
    stops.push(start(fake.ctx, config(), { fetch: failFetch() }))
    await settle()
    expect(fake.mutate).not.toHaveBeenCalled()
    expect(fake.logger.warn).toHaveBeenCalled()
  })

  it('does not seed when another layer already declares the route', async () => {
    const fake = fakeCtx({ base: { tako: { displayName: 'Tako from bundle' } } })
    stops.push(start(fake.ctx, config(), { fetch: failFetch() }))
    await settle()
    expect(fake.mutate).not.toHaveBeenCalled()
  })

  it('treats an HTTP error as unreachable', async () => {
    const fake = fakeCtx()
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 502 })) as unknown as typeof fetch
    stops.push(start(fake.ctx, config(), { fetch: fetchImpl }))
    await until(() => fake.mutate.mock.calls.length === 1)
    expect(fake.logger.warn).toHaveBeenCalledWith('Tako model directory refresh failed: %s', 'Tako pricing directory returned HTTP 502')
  })

  it('warns and does not write on a read-only profile', async () => {
    const fake = fakeCtx({ writable: false })
    stops.push(start(fake.ctx, config(), { fetch: okFetch() }))
    await until(() => fake.logger.warn.mock.calls.length > 0)
    expect(fake.mutate).not.toHaveBeenCalled()
    expect(fake.logger.warn).toHaveBeenCalledWith('active profile is read-only; Tako route not updated')
  })

  it('does not write when filters leave no models', async () => {
    const fake = fakeCtx()
    stops.push(start(fake.ctx, config({ include: ['nothing-*'] }), { fetch: okFetch() }))
    await until(() => fake.logger.warn.mock.calls.length > 0)
    expect(fake.mutate).not.toHaveBeenCalled()
  })

  it('logs a failed write instead of seeding over it', async () => {
    const fake = fakeCtx()
    fake.mutate.mockRejectedValueOnce(new Error('validation failed'))
    stops.push(start(fake.ctx, config(), { fetch: okFetch() }))
    await until(() => fake.logger.warn.mock.calls.length > 0)
    expect(fake.mutate).toHaveBeenCalledTimes(1)
    expect(fake.logger.warn).toHaveBeenCalledWith('writing the Tako route failed: %s', 'validation failed')
  })

  it('waits for the pi-ai section to become active', async () => {
    const fake = fakeCtx({ sectionMissingFor: 2 })
    stops.push(start(fake.ctx, config(), { fetch: okFetch(), sectionRetryMs: 5 }))
    await until(() => fake.mutate.mock.calls.length === 1)
  })

  it('gives up waiting for the section with a warning', async () => {
    const fake = fakeCtx({ sectionMissingFor: 100 })
    stops.push(start(fake.ctx, config(), { fetch: okFetch(), sectionRetryMs: 1, sectionRetries: 3 }))
    await until(() => fake.logger.warn.mock.calls.length > 0)
    expect(fake.mutate).not.toHaveBeenCalled()
  })

  it('refreshes on the interval and stops when disposed', async () => {
    const fake = fakeCtx()
    const fetchImpl = okFetch()
    const stop = start(fake.ctx, config({ refreshIntervalMs: 20 }), { fetch: fetchImpl })
    await until(() => (fetchImpl as unknown as { mock: { calls: unknown[] } }).mock.calls.length >= 3)
    stop()
    const calls = (fetchImpl as unknown as { mock: { calls: unknown[] } }).mock.calls.length
    await settle()
    expect((fetchImpl as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(calls)
    expect(fake.mutate).toHaveBeenCalledTimes(1)
  })

  it('apply registers the sync as an effect and the Web route behind connection + credentials', async () => {
    const fake = fakeCtx()
    const original = globalThis.fetch
    globalThis.fetch = okFetch()
    try {
      apply(fake.ctx, config())
      await until(() => fake.mutate.mock.calls.length === 1)
      expect(fake.inject).toHaveBeenCalledWith(['connection', 'credentials'], expect.any(Function))
    } finally {
      globalThis.fetch = original
      fake.dispose()
    }
  })
})

describe('missing-key hint', () => {
  it('logs the login hint once when the key reference is unconfigured', async () => {
    const fake = fakeCtx({ keyConfigured: false })
    stops.push(start(fake.ctx, config({ refreshIntervalMs: 20 }), { fetch: okFetch() }))
    await until(() => fake.logger.warn.mock.calls.some(call => call[0] === MISSING_KEY_HINT))
    await settle()
    expect(fake.describeCredential).toHaveBeenCalledTimes(1)
    expect(fake.describeCredential).toHaveBeenCalledWith('TAKO_API_KEY')
    expect(fake.logger.warn.mock.calls.filter(call => call[0] === MISSING_KEY_HINT)).toEqual([[MISSING_KEY_HINT, 'TAKO_API_KEY']])
    expect(MISSING_KEY_HINT).toContain('dsh-tako login')
  })

  it('stays quiet when the key is configured', async () => {
    const fake = fakeCtx({ keyConfigured: true })
    stops.push(start(fake.ctx, config({ apiKeyEnv: 'MY_TAKO' }), { fetch: okFetch() }))
    await until(() => fake.describeCredential.mock.calls.length === 1)
    await settle()
    expect(fake.describeCredential).toHaveBeenCalledWith('MY_TAKO')
    expect(fake.logger.warn).not.toHaveBeenCalled()
  })

  it('reports undefined without a credential service and survives a failing one', async () => {
    expect(await checkCredential(fakeCtx({ noCredentials: true }).ctx, config())).toBeUndefined()
    const broken = fakeCtx()
    broken.describeCredential.mockRejectedValueOnce(new Error('boom'))
    expect(await checkCredential(broken.ctx, config())).toBeUndefined()
    expect(broken.logger.warn).not.toHaveBeenCalled()
  })
})

describe('package icon', () => {
  it('points icon and exports["./icon"] at a small PNG on disk', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      icon?: string
      exports?: Record<string, unknown>
    }
    expect(pkg.icon).toBe('./client/icon.png')
    expect(pkg.exports?.['./icon']).toBe('./client/icon.png')
    const icon = new URL('../client/icon.png', import.meta.url)
    expect(existsSync(icon)).toBe(true)
    const size = statSync(icon).size
    expect(size).toBeGreaterThan(0)
    expect(size, 'market index').toBeLessThan(32 * 1024)
    expect(size, 'readPluginMeta').toBeLessThan(256 * 1024)
  })
})
