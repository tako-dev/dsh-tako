/**
 * Tako model route for the official DeepSeek Harness.
 *
 * The plugin owns no adapter: it keeps one OpenAI-compatible route,
 * `providers.tako`, in the settings section of the installation's own
 * `llm-pi-ai` plugin — the same place the Models page writes a custom
 * provider — and refreshes that route's model list from Tako's public pricing
 * directory. Requests, streaming, retries and credentials all stay on the
 * official code path.
 * @module dsh-tako
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import type { CatalogOptions, TakoModel, TakoModelOverride, TakoPricingResponse } from './catalog.ts'
import { buildCatalog } from './catalog.ts'
import { DEFAULT_API_KEY_ENV, DEFAULT_BASE_URL, normalizeOrigin } from './shared.ts'
import { applyWeb } from './web.ts'

export * from './catalog.ts'
export { DEFAULT_API_KEY_ENV, DEFAULT_BASE_URL, normalizeOrigin } from './shared.ts'
export { LOGIN_ROUTE } from './web.ts'

/** Cordis plugin name. */
export const name = 'dsh-tako'

/** The installation's settings service is the only dependency. */
export const inject = ['settings']

/** Settings namespace of the official pi-ai plugin row in `dsh-base`. */
export const PI_AI_NS = 'llm-pi-ai'
/** Route key, and therefore the provider id shown in model selectors. */
export const PROVIDER = 'tako'

/** Used only when the directory has never been reachable, so the route still appears. */
export const FALLBACK_MODELS: TakoModel[] = [
  { id: 'deepseek-v4.1-flash', name: 'deepseek-v4.1-flash', contextWindow: 1_000_000, input: ['text', 'image'] },
  { id: 'deepseek-v4-pro', name: 'deepseek-v4-pro', contextWindow: 1_000_000, input: ['text'] },
]

/** Plugin configuration. */
export interface Config {
  /** Tako origin; `/v1` is appended for chat requests. */
  baseURL: string
  /** DSH credential reference holding the Tako API key. */
  apiKeyEnv: string
  /** Capacity for a model the directory does not size. */
  defaultContextWindow: number
  /** Directory refresh interval; `0` refreshes only at startup. */
  refreshIntervalMs: number
  /** Ids listed first in selectors. */
  pinned: string[]
  /** Keep only ids matching these globs (`*` wildcard). */
  include: string[]
  /** Remove ids matching these globs. */
  exclude: string[]
  /** Keep models Tako restricts to the Claude Code client. */
  includeClaudeCodeOnly: boolean
  /** Per-model capacity or modality fixes. */
  overrides: Record<string, TakoModelOverride>
}

const ModelOverride: z<TakoModelOverride> = z.object({
  name: z.string(),
  contextWindow: z.natural().min(1),
  maxTokens: z.natural().min(1),
  input: z.array(z.union(['text', 'image'])),
})

/** Runtime config schema. */
export const Config: z<Config> = z.object({
  baseURL: z.string().default(DEFAULT_BASE_URL).description('Tako 地址，聊天请求走 `<baseURL>/v1`'),
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV).description('存放 Tako API key 的凭据名'),
  defaultContextWindow: z.natural().min(1).default(128_000).description('目录未标注上下文时的兜底值'),
  refreshIntervalMs: z.natural().default(30 * 60_000).description('模型目录刷新间隔（毫秒），0 表示只在启动时刷新'),
  pinned: z.array(z.string()).default(['deepseek-v4.1-flash', 'deepseek-v4-pro', 'tako-auto']).description('置顶的模型'),
  include: z.array(z.string()).default([]).description('只保留匹配的模型，支持 * 通配'),
  exclude: z.array(z.string()).default([]).description('排除匹配的模型，支持 * 通配'),
  includeClaudeCodeOnly: z.boolean().default(false).description('保留仅限 Claude Code 客户端的模型（DSH 中调用会被拒绝）'),
  overrides: z.dict(ModelOverride).default({}).description('按模型 id 修正上下文、输出上限或输入模态'),
})

/** The `providers.tako` value written into the pi-ai settings section. */
export function routeProfile(config: Config, models: readonly TakoModel[]): Record<string, unknown> {
  return {
    displayName: 'Tako',
    api: 'openai-completions',
    baseURL: `${normalizeOrigin(config.baseURL)}/v1`,
    apiKeyEnv: config.apiKeyEnv,
    defaultContextWindow: config.defaultContextWindow,
    models: models.map(model => ({ ...model })),
  }
}

/** JSON with sorted object keys, so a YAML round trip does not read as a change. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) => {
    if (inner === null || typeof inner !== 'object' || Array.isArray(inner)) return inner
    return Object.fromEntries(Object.entries(inner as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
  })
}

/** Fetch the public pricing directory; no API key is involved. */
export async function fetchDirectory(baseURL: string, signal: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<TakoPricingResponse> {
  const response = await fetchImpl(`${normalizeOrigin(baseURL)}/api/pricing`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
  })
  if (!response.ok) throw new Error(`Tako pricing directory returned HTTP ${response.status}`)
  return await response.json() as TakoPricingResponse
}

interface PiAiSection {
  /** Resolved value: schema defaults, then bundle layers, then the profile patch. */
  value?: { providers?: Record<string, unknown> }
  /** The profile patch's own layer — what `mutate` writes. */
  user?: { providers?: Record<string, unknown> }
}

function piAiSection(ctx: Context): PiAiSection | undefined {
  return ctx.settings.describe().find(descriptor => descriptor.ns === PI_AI_NS) as PiAiSection | undefined
}

/** The slice of the official `ctx.credentials` service the startup hint reads. */
interface CredentialDescriber {
  describe: (ref: string) => Promise<{ configured: boolean, source?: string }>
}

/** Shown once per start when the route's key reference resolves to nothing. */
export const MISSING_KEY_HINT = 'no Tako API key is configured as %s: run "npx dsh-tako login" to sign in with the browser, or paste a key in Settings -> Models -> Tako'

/**
 * Log {@link MISSING_KEY_HINT} when the installation's credential service
 * reports the key reference unconfigured. Never reads the value.
 * @returns whether a key is configured, or `undefined` when no credential service is mounted.
 */
export async function checkCredential(ctx: Context, config: Config): Promise<boolean | undefined> {
  try {
    const credentials = ctx.get('credentials') as CredentialDescriber | undefined
    if (credentials === undefined) return undefined
    const info = await credentials.describe(config.apiKeyEnv)
    if (!info.configured) ctx.logger.warn(MISSING_KEY_HINT, config.apiKeyEnv)
    return info.configured
  } catch (error: unknown) {
    ctx.logger.debug?.('could not check the Tako credential: %s', error instanceof Error ? error.message : String(error))
    return undefined
  }
}

/** Optional seams for tests; production uses the global `fetch` and timers. */
export interface SyncDeps {
  fetch?: typeof fetch
  /** Delay before re-checking for the `llm-pi-ai` section when it is not active yet. */
  sectionRetryMs?: number
  /** How many times to re-check for the section before giving up until the next refresh. */
  sectionRetries?: number
}

/**
 * Start keeping `providers.tako` in sync with the Tako directory.
 * @returns A disposer that stops refreshing.
 */
export function start(ctx: Context, config: Config, deps: SyncDeps = {}): () => void {
  const logger = ctx.logger
  const fetchImpl = deps.fetch ?? fetch
  const sectionRetryMs = deps.sectionRetryMs ?? 1_000
  const sectionRetries = deps.sectionRetries ?? 60
  const catalogOptions: CatalogOptions = {
    include: config.include,
    exclude: config.exclude,
    pinned: config.pinned,
    includeClaudeCodeOnly: config.includeClaudeCodeOnly,
    overrides: config.overrides,
  }
  const controller = new AbortController()
  let credentialChecked = false
  const timers = new Set<ReturnType<typeof setTimeout>>()
  const later = (fn: () => void, ms: number): void => {
    const timer = setTimeout(() => { timers.delete(timer); fn() }, ms)
    timer.unref?.()
    timers.add(timer)
  }

  /** Write the route unless the profile layer already holds exactly this value. */
  const write = async (section: PiAiSection, models: readonly TakoModel[]): Promise<void> => {
    const next = routeProfile(config, models)
    // Compare with the profile layer, not the resolved value: the resolved
    // value carries pi-ai's schema defaults and would never match.
    if (canonicalJson(section.user?.providers?.[PROVIDER]) === canonicalJson(next)) return
    if (!ctx.settings.writable) {
      logger.warn('active profile is read-only; Tako route not updated')
      return
    }
    await ctx.settings.mutate(PI_AI_NS, [{ op: 'set', path: ['providers', PROVIDER], value: next }])
    logger.info('Tako route updated with %d models', models.length)
  }

  const sync = async (attempt = 0): Promise<void> => {
    const signal = controller.signal
    let models: TakoModel[] | undefined
    let fetchError: unknown
    try {
      const directory = await fetchDirectory(config.baseURL, signal, fetchImpl)
      models = buildCatalog(directory.data ?? [], catalogOptions)
    } catch (error: unknown) {
      fetchError = error
    }
    if (signal.aborted) return
    const section = piAiSection(ctx)
    if (section === undefined) {
      // pi-ai may still be starting; its settings section appears once it runs.
      if (attempt < sectionRetries) later(() => { void sync(attempt + 1) }, sectionRetryMs)
      else logger.warn('settings section "%s" is not active; Tako route not written', PI_AI_NS)
      return
    }
    // pi-ai is up, and the credential provider mounts before it in dsh-base.
    if (!credentialChecked) {
      credentialChecked = true
      void checkCredential(ctx, config)
    }
    try {
      if (models !== undefined) {
        if (models.length === 0) {
          logger.warn('no Tako chat models left after filtering; route not updated')
          return
        }
        await write(section, models)
        return
      }
      logger.warn('Tako model directory refresh failed: %s', fetchError instanceof Error ? fetchError.message : String(fetchError))
      // Keep the last stored list; only seed a route that does not exist yet.
      if (section.value?.providers?.[PROVIDER] === undefined) await write(section, FALLBACK_MODELS)
    } catch (error: unknown) {
      if (signal.aborted) return
      logger.warn('writing the Tako route failed: %s', error instanceof Error ? error.message : String(error))
    }
  }

  void sync()
  const interval = config.refreshIntervalMs > 0
    ? setInterval(() => { void sync() }, config.refreshIntervalMs)
    : undefined
  interval?.unref?.()
  return () => {
    controller.abort()
    if (interval !== undefined) clearInterval(interval)
    for (const timer of timers) clearTimeout(timer)
    timers.clear()
  }
}

/**
 * Cordis entry: keep `providers.tako` in sync for the plugin's lifetime, and,
 * in a profile with the Web connection, serve the Models-page sign-in route.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.effect(() => start(ctx, config))
  applyWeb(ctx, config)
}
