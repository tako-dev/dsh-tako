/**
 * Tako-backed web search for the official DSH `ctx.web` seam.
 *
 * Registers a search provider with id `tako` that calls `POST /v1/search`,
 * and pins `web.searchProvider` to `tako` when a Tako key is configured and
 * the current selection is still the bundle default (`deepseek-official`).
 * Profiles without `web` never enter this path (`ctx.inject`).
 * @module dsh-tako/search
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import { normalizeOrigin } from './shared.ts'

/** Stable id this provider registers under. */
export const TAKO_SEARCH_PROVIDER_ID = 'tako'
/** Settings namespace of the web seam's provider selection. */
export const TAKO_SEARCH_NS = 'web'
/**
 * Bundle / empty selections this product is allowed to replace with `tako`.
 * User picks such as `deepseek-search-api` / `exa` / `perplexity` are left alone.
 */
export const FACTORY_SEARCH_PROVIDERS: ReadonlySet<string | undefined> = new Set(['deepseek-official', '', undefined])

/** Duck-typed `WebSearchRequest`; this package does not depend on `dsh-web`. */
export interface TakoSearchRequest {
  readonly query: string
  readonly maxResults?: number
}

/** Duck-typed `WebSearchSource`. */
export interface TakoSearchSource {
  readonly url: string
  readonly title?: string
  readonly snippet?: string
  readonly publishedAt?: string
}

/** Duck-typed `WebSearchResult`. `truncated` stays false: the seam caps `maxResults`. */
export interface TakoSearchResult {
  readonly content?: string
  readonly sources: readonly TakoSearchSource[]
  readonly truncated: boolean
}

export interface TakoSearchProviderOptions {
  origin: string
  resolveApiKey: () => Promise<string | undefined>
  fetch?: typeof fetch
  onKeyPresence?: (present: boolean) => void
}

/** The slice of `ctx.settings` pin/refresh uses. */
export interface SettingsLike {
  describe: () => readonly { ns: string, value?: unknown, user?: unknown }[]
  mutate: (ns: string, ops: readonly { op: 'set', path: readonly string[], value: unknown }[]) => Promise<void>
}

export interface SearchLogger {
  info: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
  debug?: (...args: unknown[]) => void
}

const providers = new WeakMap<object, TakoSearchProvider>()

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

function isFactorySearchProvider(id: unknown): boolean {
  return (id === undefined || typeof id === 'string') && FACTORY_SEARCH_PROVIDERS.has(id)
}

function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'name' in error && (error as { name: unknown }).name === 'AbortError'
}

function readSearchProvider(layer: unknown): unknown {
  return isRecord(layer) ? layer.searchProvider : undefined
}

/** Map Tako's `POST /v1/search` JSON to the DSH search-result shape. */
export function mapTakoSearchResponse(body: unknown): TakoSearchResult {
  const record = isRecord(body) ? body : {}
  const rows = Array.isArray(record.results) ? record.results : []
  const sources: TakoSearchSource[] = []
  for (const item of rows) {
    if (!isRecord(item)) continue
    const url = nonEmptyString(item.url)
    if (url === undefined) continue
    const title = nonEmptyString(item.title)
    const snippet = nonEmptyString(item.snippet)
    const publishedAt = nonEmptyString(item.published_at)
    sources.push({
      url,
      ...title !== undefined ? { title } : {},
      ...snippet !== undefined ? { snippet } : {},
      ...publishedAt !== undefined ? { publishedAt } : {},
    })
  }
  const content = nonEmptyString(record.answer)
  return {
    ...content !== undefined ? { content } : {},
    sources,
    truncated: false,
  }
}

/** Tako-backed search provider. `available()` is a cache; it must not await. */
export class TakoSearchProvider {
  readonly id = TAKO_SEARCH_PROVIDER_ID
  private keyPresent = false
  private readonly origin: string
  private readonly resolveApiKey: TakoSearchProviderOptions['resolveApiKey']
  private readonly fetchImpl: typeof fetch
  private readonly onKeyPresence: TakoSearchProviderOptions['onKeyPresence']

  constructor(options: TakoSearchProviderOptions) {
    this.origin = options.origin
    this.resolveApiKey = options.resolveApiKey
    this.fetchImpl = options.fetch ?? fetch
    this.onKeyPresence = options.onKeyPresence
  }

  setKeyPresence(present: boolean): void {
    this.keyPresent = present
    this.onKeyPresence?.(present)
  }

  available(): boolean {
    return URL.canParse(this.origin) && this.keyPresent
  }

  async search(request: TakoSearchRequest, signal?: AbortSignal): Promise<TakoSearchResult> {
    let key: string | undefined
    try {
      key = await this.resolveApiKey()
    } catch (error: unknown) {
      if (isAbortError(error)) throw new Error('Tako search aborted', { cause: error })
      throw error
    }
    if (key === undefined || key === '') {
      this.setKeyPresence(false)
      throw new Error('no Tako API key is configured')
    }
    this.setKeyPresence(true)

    const body: { query: string, count?: number } = { query: request.query }
    if (isPositiveInteger(request.maxResults)) body.count = request.maxResults

    const init: RequestInit = {
      method: 'POST',
      redirect: 'error',
      headers: {
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(body),
    }
    if (signal !== undefined) init.signal = signal

    let response: Response
    try {
      response = await this.fetchImpl(`${this.origin}/v1/search`, init)
    } catch (error: unknown) {
      if (isAbortError(error)) throw new Error('Tako search aborted', { cause: error })
      throw new Error(`Tako search request failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
    }

    if (!response.ok) {
      let message = `Tako search returned HTTP ${response.status}`
      try {
        const parsed: unknown = await response.json()
        const detail = isRecord(parsed) && isRecord(parsed.error) ? parsed.error.message : undefined
        if (typeof detail === 'string' && detail !== '') message = detail
      } catch (error: unknown) {
        if (isAbortError(error)) throw new Error('Tako search aborted', { cause: error })
      }
      throw new Error(message)
    }

    try {
      return mapTakoSearchResponse(await response.json())
    } catch (error: unknown) {
      if (isAbortError(error)) throw new Error('Tako search aborted', { cause: error })
      throw new Error(`Tako search returned an unprocessable response body: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
    }
  }
}

/**
 * Pin `web.searchProvider` to `tako` over the factory default when a key is
 * configured; restore `deepseek-official` when this plugin had written `tako`
 * and the key is gone. `value` is the resolved id; `user` is the override.
 */
export async function pinTakoSearchProvider(settings: SettingsLike, opts: { configured: boolean, logger: SearchLogger }): Promise<void> {
  const section = settings.describe().find(descriptor => descriptor.ns === TAKO_SEARCH_NS)
  if (section === undefined) return

  const resolved = readSearchProvider(section.value)
  const userId = readSearchProvider(section.user)

  if (opts.configured) {
    if (isFactorySearchProvider(resolved) && userId !== TAKO_SEARCH_PROVIDER_ID) {
      await settings.mutate(TAKO_SEARCH_NS, [{ op: 'set', path: ['searchProvider'], value: TAKO_SEARCH_PROVIDER_ID }])
      opts.logger.debug?.('pinned web.searchProvider to %s', TAKO_SEARCH_PROVIDER_ID)
    }
    return
  }

  if (userId === TAKO_SEARCH_PROVIDER_ID) {
    await settings.mutate(TAKO_SEARCH_NS, [{ op: 'set', path: ['searchProvider'], value: 'deepseek-official' }])
    opts.logger.debug?.('restored web.searchProvider to deepseek-official')
  }
}

interface CredentialDescriber {
  describe: (ref: string) => Promise<{ configured: boolean, source?: string }>
}

/** Describe the Tako key, update the live provider's presence cache, then pin. */
export async function refreshTakoSearchPin(ctx: Context, config: { apiKeyEnv: string }): Promise<void> {
  let configured = false
  try {
    const credentials = ctx.get('credentials') as CredentialDescriber | undefined
    if (credentials !== undefined) {
      const info = await credentials.describe(config.apiKeyEnv)
      configured = info.configured
    }
  } catch (error: unknown) {
    ctx.logger.debug?.('could not describe the Tako credential for search pin: %s', error instanceof Error ? error.message : String(error))
  }
  providers.get(ctx)?.setKeyPresence(configured)
  await pinTakoSearchProvider(ctx.settings, { configured, logger: ctx.logger })
}

/** Register the Tako search provider while `web` and `credentials` are both up. */
export function applySearch(ctx: Context, config: { baseURL: string, apiKeyEnv: string }): void {
  ctx.inject(['web', 'credentials'], inner => {
    const credentials = (inner as unknown as { credentials?: {
      resolve: (ref: string) => Promise<{ value: string, source: string } | undefined>
    } }).credentials
    const provider = new TakoSearchProvider({
      origin: normalizeOrigin(config.baseURL),
      resolveApiKey: async () => {
        if (credentials === undefined) return undefined
        const resolved = await credentials.resolve(config.apiKeyEnv)
        const value = resolved?.value
        return typeof value === 'string' && value !== '' ? value : undefined
      },
    })
    providers.set(ctx, provider)
    void refreshTakoSearchPin(ctx, config).catch((error: unknown) => {
      inner.logger.debug?.('could not pin Tako search provider: %s', error instanceof Error ? error.message : String(error))
    })

    inner.effect(() => {
      const web = (inner as unknown as { web?: { registerSearchProvider?: (next: TakoSearchProvider) => (() => void) | void } }).web
      if (typeof web?.registerSearchProvider !== 'function') {
        inner.logger.debug?.('web seam has no registerSearchProvider; Tako search not registered')
        return () => { providers.delete(ctx) }
      }
      const unregister = web.registerSearchProvider(provider)
      return () => {
        unregister?.()
        providers.delete(ctx)
      }
    })
  })
}
