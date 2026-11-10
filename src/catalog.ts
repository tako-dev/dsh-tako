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
  /** Reasoning levels the model declares, in escalation order. */
  reasoning_levels?: string[]
  kind?: string
  client_restriction?: string | null
  /** Vendor mark; `vendor_icon` is the legacy name for the same slot. */
  icon?: string
  vendor_icon?: string
  vendor_id?: number
  /** List price multiplier; the site's standard price is `model_ratio × 2` USD per million tokens. */
  model_ratio?: number
  /** Output-side multiplier over the input price. */
  completion_ratio?: number
  cache_ratio?: number
  /** The site's own list price per million input tokens, when published. */
  standard_load_price_per_million?: number
  /** Per-channel pricing rows, when the directory publishes them. */
  channels?: TakoPricingChannel[]
}

/** One channel row inside a pricing card. */
export interface TakoPricingChannel {
  channel_name: string
  channel_tag?: string
  channel_ratio?: number
  /** What this channel actually charges per million input tokens. */
  realized_price_per_million?: number
  standard_load_price_per_million?: number
  cache_hit_rate?: number
}

/** `GET /api/pricing` response. */
export interface TakoPricingResponse {
  data?: TakoPricingModel[]
  usable_group?: Record<string, string>
}

/** Request modalities DSH's pi-ai routes accept. */
export type Modality = 'text' | 'image'

/** Reasoning levels the Models picker and composer may offer, in escalation order. */
export type TakoReasoningLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/**
 * Selectable reasoning efforts for one model. `off: null` means the level is
 * offered and dispatch omits the wire field — Tako rejects an explicit
 * `reasoning_effort=off` on some routes, including deepseek-v4.1-flash.
 */
export type TakoReasoningEfforts = Partial<Record<TakoReasoningLevel, string | null>>

/** Legacy configured defaults, not evidence of a model's supported reasoning capabilities. */
export const DEFAULT_REASONING_EFFORTS: TakoReasoningEfforts = {
  off: null,
  low: 'low',
  high: 'high',
  max: 'max',
}

/** Levels a directory entry may declare, in escalation order. */
const REASONING_LEVELS: readonly TakoReasoningLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

/**
 * Read the levels a card declares; unknown names are ignored and duplicates
 * collapse to the first. `undefined` means the directory declared nothing, so
 * the legacy defaults still apply.
 * @param levels - the card's `reasoning_levels`, as published.
 * @returns the declared efforts, or `undefined` when none survive.
 */
function declaredEfforts(levels: readonly string[] | undefined): TakoReasoningEfforts | undefined {
  if (levels === undefined) return undefined
  const efforts: TakoReasoningEfforts = {}
  for (const level of levels) {
    if (!(REASONING_LEVELS as readonly string[]).includes(level) || level in efforts) continue
    efforts[level as TakoReasoningLevel] = level === 'off' ? null : level
  }
  return Object.keys(efforts).length > 0 ? efforts : undefined
}

/** A DSH pi-ai model profile, the shape stored under `providers.<route>.models`. */
export interface TakoModel {
  id: string
  name?: string
  contextWindow?: number
  maxTokens?: number
  input?: Modality[]
  reasoningEfforts?: false | TakoReasoningEfforts
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

/**
 * Summarize known manual capability overrides without mistaking legacy defaults for support.
 * @param data - Current pricing records.
 * @param options - The same filtering and override choices used for the model catalog.
 * @returns Per-model evidence status and explicitly configured choices.
 */
export function reasoningCapabilityReport(data: readonly TakoPricingModel[], options: CatalogOptions = {}): {
  model: string
  source: 'override' | 'unknown'
  reasoningEfforts?: false | TakoReasoningEfforts
}[] {
  return buildCatalog(data, options).map(model => {
    const override = options.overrides?.[model.id]
    if (override?.reasoningEfforts === undefined) return { model: model.id, source: 'unknown' }
    return { model: model.id, source: 'override', reasoningEfforts: override.reasoningEfforts }
  })
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

/**
 * Drop an override's absent `input`, which the config schema materializes as
 * `[]`: pi-ai reads `[]` as "no answer here", so the catalog's own modalities
 * must survive an override that only names other fields.
 * @param override - the per-model override as the config schema resolved it.
 * @returns the override without a blank `input`.
 */
function withoutBlankInput(override: TakoModelOverride): TakoModelOverride {
  const { input, ...rest } = override
  return input !== undefined && input.length > 0 ? { ...rest, input } : rest
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
    reasoningEfforts: declaredEfforts(model.reasoning_levels) ?? { ...DEFAULT_REASONING_EFFORTS },
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
    models.push(override === undefined ? model : { ...model, ...withoutBlankInput(override), id: model.id })
  }
  const pinned = options.pinned ?? []
  const rank = (id: string): number => {
    const index = pinned.indexOf(id)
    return index === -1 ? pinned.length : index
  }
  return models.sort((a, b) => rank(a.id) - rank(b.id) || a.id.localeCompare(b.id))
}

// ---------------------------------------------------------------- model cards

/**
 * The display-only card the console renders next to each route model. These
 * carry the fields the Tako plaza shows (description, tags, channel pricing)
 * that never enter `providers.tako`.
 */
export interface TakoModelCard {
  id: string
  description?: string
  /** Vendor identifier for the monogram chip: the icon string, else the numeric vendor id. */
  vendor?: string
  icon?: string
  tags: string[]
  endpoints: string[]
  groups: string[]
  contextWindow?: number
  vision: boolean
  reasoning: boolean
  claudeCodeOnly: boolean
  /** Site list price per million input tokens; `model_ratio × 2` when unpublished. */
  standardPriceUsdPerMillion?: number
  /** Cheapest channel's realized price per million input tokens. */
  realizedPriceUsdPerMillion?: number
  /** Best channel cache-hit rate, between 0 and 1. */
  cacheHitRate?: number
  channelCount: number
  /** First channel's tag (e.g. a stability or vendor label), when published. */
  channelTag?: string
  /** Output-side multiplier over the input price; omitted when 1. */
  outputRatio?: number
}

/**
 * Project one directory card onto a filtered route model for the console.
 * @param card - the pricing row the model came from.
 * @param model - the resulting route model (override-applied), for display flags.
 */
export function toModelCard(card: TakoPricingModel, model: TakoModel): TakoModelCard {
  const tags = parseTags(card.tags)
  const channels = Array.isArray(card.channels) ? card.channels : []
  const realized = channels
    .map(channel => typeof channel.realized_price_per_million === 'number' && Number.isFinite(channel.realized_price_per_million)
      ? channel.realized_price_per_million : undefined)
    .filter((value): value is number => value !== undefined)
  const cacheHits = channels
    .map(channel => typeof channel.cache_hit_rate === 'number' && Number.isFinite(channel.cache_hit_rate) ? channel.cache_hit_rate : undefined)
    .filter((value): value is number => value !== undefined)
  const vendor = typeof card.icon === 'string' && card.icon !== '' ? card.icon
    : typeof card.vendor_icon === 'string' && card.vendor_icon !== '' ? card.vendor_icon
    : typeof card.vendor_id === 'number' ? String(card.vendor_id) : undefined
  const standard = typeof card.standard_load_price_per_million === 'number' && Number.isFinite(card.standard_load_price_per_million)
    ? card.standard_load_price_per_million
    : typeof card.model_ratio === 'number' && Number.isFinite(card.model_ratio) ? card.model_ratio * 2 : undefined
  const restricted = card.client_restriction !== undefined
    ? card.client_restriction !== null
    : tags.includes(CLAUDE_CODE_ONLY_TAG)
  return {
    id: model.id,
    ...typeof card.description === 'string' && card.description !== '' ? { description: card.description } : {},
    ...vendor === undefined ? {} : { vendor },
    ...vendor === undefined || typeof card.icon !== 'string' || card.icon === '' ? {} : { icon: card.icon },
    tags,
    endpoints: Array.isArray(card.supported_endpoint_types) ? card.supported_endpoint_types.filter(type => typeof type === 'string') : [],
    groups: Array.isArray(card.enable_groups) ? card.enable_groups.filter(group => typeof group === 'string') : [],
    ...model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow },
    vision: (model.input ?? []).includes('image'),
    reasoning: model.reasoningEfforts !== false,
    claudeCodeOnly: restricted,
    ...standard === undefined ? {} : { standardPriceUsdPerMillion: standard },
    ...realized.length === 0 ? {} : { realizedPriceUsdPerMillion: Math.min(...realized) },
    ...cacheHits.length === 0 ? {} : { cacheHitRate: Math.max(...cacheHits) },
    channelCount: channels.length,
    ...typeof channels[0]?.channel_tag === 'string' && channels[0].channel_tag !== '' ? { channelTag: channels[0].channel_tag } : {},
    ...typeof card.completion_ratio === 'number' && Number.isFinite(card.completion_ratio) && card.completion_ratio !== 1 ? { outputRatio: card.completion_ratio } : {},
  }
}

/**
 * Build the console's card list in route order. Cards are skipped when their
 * pricing row cannot be matched back, so the client can fall back to the plain
 * model rows for those ids.
 */
export function buildCards(data: readonly TakoPricingModel[], models: readonly TakoModel[]): TakoModelCard[] {
  const cardsById = new Map<string, TakoModelCard>()
  for (const card of data) {
    const id = card.model_name.trim()
    if (id === '' || cardsById.has(id)) continue
    cardsById.set(id, toModelCard(card, { ...toModel(card), id }))
  }
  return models.map(model => {
    const card = cardsById.get(model.id)
    return card === undefined ? toModelCard({ model_name: model.id }, model) : { ...card, vision: model.input?.includes('image') === true, reasoning: model.reasoningEfforts !== false, ...model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow } }
  })
}
