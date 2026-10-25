/**
 * Pure mapping from Tako's public pricing directory to DSH model profiles.
 * Kept free of DSH services so the filtering and capacity rules are testable
 * against a recorded directory response.
 * @module dsh-tako/catalog
 */

/** One model card of `GET /api/pricing`. Unknown fields are ignored. */
export interface TakoPricingModel {
  model_name: string
  description?: string
  /** Comma-separated labels such as `Vision,1M` or `反代,Vision,1M,仅Claude Code`. */
  tags?: string
  enable_groups?: string[]
  supported_endpoint_types?: string[]
  /** Structured fields Tako may publish; preferred over tag parsing when present. */
  context_length?: number
  max_output_tokens?: number
  input_modalities?: string[]
  kind?: string
  client_restriction?: string | null
}

/** `GET /api/pricing` response. */
export interface TakoPricingResponse {
  data?: TakoPricingModel[]
  usable_group?: Record<string, string>
}

/** Request modalities DSH's pi-ai routes accept. */
export type Modality = 'text' | 'image'

/** A DSH pi-ai model profile, the shape stored under `providers.<route>.models`. */
export interface TakoModel {
  id: string
  name?: string
  contextWindow?: number
  maxTokens?: number
  input?: Modality[]
}

/** Per-model fields a user may pin over the directory. */
export type TakoModelOverride = Omit<TakoModel, 'id'>

/** Catalog shaping options. */
export interface CatalogOptions {
  /** Glob patterns (`*` wildcard); when non-empty only matching ids are kept. */
  include?: readonly string[]
  /** Glob patterns removed after `include`. */
  exclude?: readonly string[]
  /** Ids listed first, in this order; the rest follow alphabetically. */
  pinned?: readonly string[]
  /** Keep models Tako restricts to the Claude Code client. */
  includeClaudeCodeOnly?: boolean
  /** Per-model overrides applied last. */
  overrides?: Readonly<Record<string, TakoModelOverride>>
}

/** Endpoint types that mark a model as something other than a chat model. */
const NON_CHAT_ENDPOINTS = new Set(['image-generation', 'search', 'speech-tts', 'speech-asr', 'systemone'])
/** Tags that mark a model as something other than a chat model. */
const NON_CHAT_TAGS = new Set(['生图', 'Image generation', 'TTS', 'ASR', '工具'])
const CLAUDE_CODE_ONLY_TAG = '仅Claude Code'
const CHAT_PROTOCOL = 'openai'

/** Split a pricing card's tag string into trimmed labels. */
export function parseTags(tags: string | undefined): string[] {
  return (tags ?? '').split(',').map(tag => tag.trim()).filter(tag => tag.length > 0)
}

/**
 * Read a context capacity from labels such as `272K`, `1M` or `1.05M`. Only a
 * label that is exactly a size counts, so `31B` (parameter count) is ignored.
 */
export function contextFromTags(tags: readonly string[]): number | undefined {
  for (const tag of tags) {
    const match = /^(\d+(?:\.\d+)?)([KM])$/i.exec(tag)
    if (match === null) continue
    const value = Math.round(Number(match[1]) * (match[2]!.toUpperCase() === 'M' ? 1_000_000 : 1_000))
    if (Number.isSafeInteger(value) && value > 0) return value
  }
  return undefined
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined
}

/** Whether a card describes a chat model DSH can call through the OpenAI-compatible route. */
export function isChatModel(model: TakoPricingModel, options: Pick<CatalogOptions, 'includeClaudeCodeOnly'> = {}): boolean {
  const id = model.model_name.trim()
  if (id.length === 0 || id.startsWith('jev-')) return false
  if (model.kind !== undefined) {
    if (model.kind !== 'chat') return false
  } else {
    const endpoints = model.supported_endpoint_types ?? []
    if (!endpoints.includes(CHAT_PROTOCOL)) return false
    if (endpoints.some(type => NON_CHAT_ENDPOINTS.has(type))) return false
    if (parseTags(model.tags).some(tag => NON_CHAT_TAGS.has(tag))) return false
  }
  if (!options.includeClaudeCodeOnly) {
    const restricted = model.client_restriction !== undefined
      ? model.client_restriction !== null
      : parseTags(model.tags).includes(CLAUDE_CODE_ONLY_TAG)
    if (restricted) return false
  }
  return true
}

/** Map one chat card to a model profile; structured fields win over tags. */
export function toModel(model: TakoPricingModel): TakoModel {
  const tags = parseTags(model.tags)
  const id = model.model_name.trim()
  const contextWindow = positiveInteger(model.context_length) ?? contextFromTags(tags)
  const maxTokens = positiveInteger(model.max_output_tokens)
  const vision = model.input_modalities !== undefined
    ? model.input_modalities.includes('image')
    : tags.includes('Vision')
  return {
    id,
    name: id,
    ...contextWindow === undefined ? {} : { contextWindow },
    ...maxTokens === undefined ? {} : { maxTokens },
    input: vision ? ['text', 'image'] : ['text'],
  }
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
  return new RegExp(`^${escaped}$`)
}

function matchesAny(id: string, patterns: readonly string[]): boolean {
  return patterns.some(pattern => globToRegExp(pattern).test(id))
}

/**
 * Build the route's model list from a pricing directory.
 * @param data - `data` of `GET /api/pricing`.
 * @param options - filtering, ordering and overrides.
 * @returns Deduplicated model profiles, pinned ids first.
 */
export function buildCatalog(data: readonly TakoPricingModel[], options: CatalogOptions = {}): TakoModel[] {
  const include = options.include ?? []
  const exclude = options.exclude ?? []
  const seen = new Set<string>()
  const models: TakoModel[] = []
  for (const card of data) {
    if (!isChatModel(card, options)) continue
    const model = toModel(card)
    if (seen.has(model.id)) continue
    if (include.length > 0 && !matchesAny(model.id, include)) continue
    if (matchesAny(model.id, exclude)) continue
    seen.add(model.id)
    const override = options.overrides?.[model.id]
    models.push(override === undefined ? model : { ...model, ...override, id: model.id })
  }
  const pinned = options.pinned ?? []
  const rank = (id: string): number => {
    const index = pinned.indexOf(id)
    return index === -1 ? pinned.length : index
  }
  return models.sort((a, b) => rank(a.id) - rank(b.id) || a.id.localeCompare(b.id))
}
