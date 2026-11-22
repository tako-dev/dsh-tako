/**
 * Pure mapping from Tako's public pricing directory to DSH model profiles.
 * Kept free of DSH services so the filtering and capacity rules are testable
 * against a recorded directory response.
 * @module dsh-tako/catalog
 */

/** One vendor row in `GET /api/pricing`. */
export interface TakoPricingVendor {
  id: number
  name: string
  icon?: string
  description?: string
}

/** Optional promotion metadata published on a pricing card. */
export interface TakoPricingPromo {
  label?: string
  tag?: string
  original_input_price_per_million?: number
  ends_at?: string
  end?: string
}

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
  vendor_name?: string
  /** Billing quota type: `0` = token-based, `1` = fixed per-request. */
  quota_type?: number
  /** List price multiplier; the site's standard input price is `model_ratio × 2` USD per million tokens. */
  model_ratio?: number
  /** Fixed per-request price in internal USD when `quota_type === 1`. */
  model_price?: number
  /** Output-side multiplier over the input price. */
  completion_ratio?: number
  cache_ratio?: number | null
  /** Dynamic/tiered billing mode (e.g. `tiered_expr`) and expression. */
  billing_mode?: string
  billing_expr?: string
  /** Per-group multipliers and minimum channel multipliers. */
  group_ratio?: Record<string, number>
  group_channel_ratio_min?: Record<string, number>
  /** Top-level realized and standard load averages per million tokens (internal USD). */
  realized_price_per_million?: number
  standard_load_price_per_million?: number
  cache_hit_rate?: number
  /** Optional official reference prices (internal USD / 1M tokens) when published directly. */
  official_input_price_per_million?: number
  official_output_price_per_million?: number
  official_cache_price_per_million?: number
  /** Optional time-limited promotion metadata. */
  promo?: TakoPricingPromo
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
  billing_mode?: string
  billing_expr?: string
}

/** `GET /api/pricing` response. */
export interface TakoPricingResponse {
  data?: TakoPricingModel[]
  usable_group?: Record<string, string>
  group_ratio?: Record<string, number>
  vendors?: TakoPricingVendor[]
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

/**
 * The gpt-6 / gpt-6.1 family actually serves 272k; the directory still labels
 * the cards `1.05M`, so the family gets a corrective default instead of the
 * tag. An explicit `context_length` still wins over this default.
 */
const FAMILY_DEFAULT_CONTEXT: ReadonlyArray<{ pattern: RegExp, contextWindow: number }> = [
  { pattern: /^gpt-6(?:[.-]|$)/, contextWindow: 272_000 },
]

function familyDefaultContext(id: string): number | undefined {
  return FAMILY_DEFAULT_CONTEXT.find(entry => entry.pattern.test(id))?.contextWindow
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
  const contextWindow = positiveInteger(model.context_length) ?? familyDefaultContext(id) ?? contextFromTags(tags)
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

/** Internal credit USD per 1 CNY actual spend (`¥1 = $3` internal credit). */
export const INTERNAL_USD_PER_CNY = 3
/** Reference official exchange rate: 1 official USD ≈ ¥7.3 CNY. */
export const OFFICIAL_CNY_PER_USD = 7.3
/** 1 official USD expressed in Tako internal credit USD (`7.3 × 3 = 21.9`). */
export const OFFICIAL_QUOTA_PER_USD = OFFICIAL_CNY_PER_USD * INTERNAL_USD_PER_CNY

/** Normalized billing mode rendered by the model directory and pricing panel. */
export type TakoModelBillingType = 'token' | 'call' | 'free' | 'dynamic'

/** Structured capability tags displayed and filtered in the model directory. */
export type TakoModelCapability = 'reasoning' | 'vision' | 'code' | 'tools' | 'longContext'

/** Compact channel metadata surfaced in the model details drawer. */
export interface TakoModelCardChannel {
  name: string
  tag?: string
  ratio?: number
}

/** Promotion banner metadata surfaced on cards and in the details drawer. */
export interface TakoModelCardPromo {
  label: string
  /** Original pre-promo input price in internal USD per 1M tokens, when known. */
  originalInputPriceUsdPerMillion?: number
  endsAt?: string
}

/** Optional top-level directory context passed into {@link buildCards} / {@link toModelCard}. */
export interface BuildCardsOptions {
  vendors?: readonly TakoPricingVendor[]
  groupRatio?: Readonly<Record<string, number>>
}

/**
 * The display-only card the console renders next to each route model. These
 * carry the fields the Tako plaza shows (description, tags, channel pricing,
 * per-leg token prices, official comparison and promotions) that never enter
 * `providers.tako`.
 */
export interface TakoModelCard {
  id: string
  description?: string
  /** Vendor identifier for the monogram chip: the icon string, else the numeric vendor id. */
  vendor?: string
  /** Human-readable vendor display name (e.g. `DeepSeek`, `Anthropic`, `OpenAI`). */
  vendorName?: string
  icon?: string
  tags: string[]
  endpoints: string[]
  groups: string[]
  contextWindow?: number
  vision: boolean
  reasoning: boolean
  claudeCodeOnly: boolean
  /** Normalized billing category used to gate pricing panels and discount badges. */
  billingType: TakoModelBillingType
  /** Structured capability set aligned with the plaza filter bar. */
  capabilities: TakoModelCapability[]
  /** Detailed per-leg prices in internal USD per 1M tokens (for token / dynamic / free models). */
  inputPriceUsdPerMillion?: number
  cachePriceUsdPerMillion?: number
  outputPriceUsdPerMillion?: number
  /** Fixed per-call price in internal USD (only for `billingType === 'call'`). */
  callPriceUsd?: number
  /** Official reference prices in internal USD per 1M tokens (for discount comparison; omitted for free/call). */
  officialInputPriceUsdPerMillion?: number
  officialOutputPriceUsdPerMillion?: number
  /** Ratio of Tako price to official reference price (`< 0.99`, token/dynamic only; never set on free/call). */
  officialRatio?: number
  /** Active time-limited promotion, when published. */
  promo?: TakoModelCardPromo
  /** Site standard-load price per million tokens (internal USD); falls back to input list price when unpublished. */
  standardPriceUsdPerMillion?: number
  /** Cheapest channel's 7-day realized price per million tokens (internal USD). */
  realizedPriceUsdPerMillion?: number
  /** Best channel cache-hit rate, between 0 and 1. */
  cacheHitRate?: number
  channelCount: number
  /** First channel's tag (e.g. a stability or vendor label), when published. */
  channelTag?: string
  /** Summary channel entries for the details drawer. */
  channels?: TakoModelCardChannel[]
  /** Output-side multiplier over the input price; omitted when 1. */
  outputRatio?: number
}

const finiteNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

const positiveNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined

/** Extract base tier USD/1M coefficients (`p`, `cr`, `c`) from a `tiered_expr` string. */
function parseTieredPrices(expr: string | undefined): { input?: number, cache?: number, output?: number } {
  if (typeof expr !== 'string' || expr.trim() === '') return {}
  // Prefer the first tier(...) body (standard context tier) when present.
  const tierMatch = /tier\s*\(\s*["'][^"']*["']\s*,\s*([^)]+)\)/.exec(expr)
  const scope = tierMatch?.[1] ?? expr
  const pick = (name: string): number | undefined => {
    const m = new RegExp(`\\b${name}\\s*\\*\\s*(\\d+(?:\\.\\d+)?)`).exec(scope)
    if (m === null) return undefined
    const v = Number(m[1])
    return Number.isFinite(v) ? v : undefined
  }
  const input = pick('p')
  const cache = pick('cr')
  const output = pick('c')
  return {
    ...input === undefined ? {} : { input },
    ...cache === undefined ? {} : { cache },
    ...output === undefined ? {} : { output },
  }
}

/**
 * Resolve the cheapest effective billing multiplier (`group_ratio × channel_ratio`)
 * the viewer can get, mirroring the Tako model plaza's `getDisplayGroupRatio`.
 */
function resolveEffectiveRatio(
  card: TakoPricingModel,
  topGroupRatio?: Readonly<Record<string, number>>,
): { ratio: number, hasChannelPricing: boolean } {
  const groupRatio: Record<string, number> = { ...topGroupRatio, ...card.group_ratio }
  const chMinMap = card.group_channel_ratio_min
  const groups = Array.isArray(card.enable_groups) && card.enable_groups.length > 0
    ? card.enable_groups
    : chMinMap !== undefined ? Object.keys(chMinMap) : []

  if (chMinMap !== undefined && Object.keys(chMinMap).length > 0) {
    let best = Number.POSITIVE_INFINITY
    for (const group of groups) {
      const chMin = positiveNumber(chMinMap[group])
      if (chMin === undefined) continue
      const gRaw = finiteNumber(groupRatio[group])
      const g = gRaw !== undefined && gRaw >= 0 ? gRaw : 1
      const combined = g * chMin
      if (combined > 0 && combined < best) best = combined
    }
    if (Number.isFinite(best) && best > 0) return { ratio: best, hasChannelPricing: true }
  }

  const channels = Array.isArray(card.channels) ? card.channels : []
  const channelRatios = channels
    .map(channel => positiveNumber(channel.channel_ratio))
    .filter((value): value is number => value !== undefined)
  if (channelRatios.length > 0) {
    return { ratio: Math.min(...channelRatios), hasChannelPricing: true }
  }

  return { ratio: 1, hasChannelPricing: false }
}

const VENDOR_ICON_NAMES: Readonly<Record<string, string>> = {
  deepseek: 'DeepSeek',
  claude: 'Anthropic',
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
  gemini: 'Google',
  moonshot: 'Moonshot',
  kimi: 'Moonshot',
  zhipu: '智谱',
  glm: '智谱',
  xai: 'xAI',
  grok: 'xAI',
  qwen: 'Alibaba',
  alibaba: 'Alibaba',
  doubao: '字节跳动',
  tencent: '腾讯混元',
  hunyuan: '腾讯混元',
  xiaomi: 'Xiaomi',
  minimax: 'MiniMax',
  mistral: 'Mistral',
  meta: 'Meta',
  tako: 'Tako',
  cognition: 'Cognition',
  cursor: 'Cursor',
  ollama: 'Ollama',
}

function normalizeVendorToken(raw: string): string {
  const base = raw.trim().replace(/\.color$/i, '').toLowerCase()
  return VENDOR_ICON_NAMES[base] ?? raw.trim().replace(/\.Color$/i, '')
}

function inferVendorFromId(id: string): string | undefined {
  const lower = id.toLowerCase()
  if (lower.startsWith('deepseek')) return 'DeepSeek'
  if (lower.startsWith('claude')) return 'Anthropic'
  if (/^(gpt|o\d|o-|codex|chatgpt)/.test(lower)) return 'OpenAI'
  if (/^(gemini|gemma)/.test(lower)) return 'Google'
  if (/^(kimi|k3\b|moonshot)/.test(lower)) return 'Moonshot'
  if (/^(glm|chatglm)/.test(lower)) return '智谱'
  if (/^(grok|composer)/.test(lower)) return 'xAI'
  if (/^(qwen|qwq)/.test(lower)) return 'Alibaba'
  if (/^(mimo)/.test(lower)) return 'Xiaomi'
  if (/^(hy\d|hunyuan)/.test(lower)) return '腾讯混元'
  if (/^(swe-)/.test(lower)) return 'Cognition'
  if (/^(tako-)/.test(lower)) return 'Tako'
  if (/^(minimax)/.test(lower)) return 'MiniMax'
  if (/^(doubao)/.test(lower)) return '字节跳动'
  if (/^(mistral|codestral)/.test(lower)) return 'Mistral'
  return undefined
}

function resolveVendorName(
  card: TakoPricingModel,
  id: string,
  vendorsById?: ReadonlyMap<number, TakoPricingVendor>,
): string | undefined {
  if (typeof card.vendor_id === 'number') {
    const listed = vendorsById?.get(card.vendor_id)?.name?.trim()
    if (listed !== undefined && listed !== '') return listed === '阿里巴巴' ? 'Alibaba' : listed
  }
  if (typeof card.vendor_name === 'string' && card.vendor_name.trim() !== '') return card.vendor_name.trim()
  if (typeof card.icon === 'string' && card.icon.trim() !== '') return normalizeVendorToken(card.icon)
  if (typeof card.vendor_icon === 'string' && card.vendor_icon.trim() !== '') return normalizeVendorToken(card.vendor_icon)
  return inferVendorFromId(id)
}

function resolveCapabilities(
  card: TakoPricingModel,
  model: TakoModel,
  tags: readonly string[],
): TakoModelCapability[] {
  const caps: TakoModelCapability[] = []
  const lowerTags = tags.map(t => t.toLowerCase())
  const text = `${model.id} ${card.description ?? ''} ${tags.join(' ')}`.toLowerCase()
  const vision = (model.input ?? []).includes('image') || lowerTags.includes('vision') || tags.includes('视觉')
  const reasoning = model.reasoningEfforts !== false || lowerTags.some(t => t.includes('reason') || t.includes('think')) || tags.includes('推理')
  const code = /\b(code|codex|coder|swe|composer|agent)\b/.test(text)
    || /(编码|代码|编程|开发|智能体)/.test(text)
    || /^(deepseek-v4|claude-(sonnet|opus|fable)|gpt-[56]|kimi-k|k3$|qwen.*coder|glm-5)/.test(model.id.toLowerCase())
  const tools = /(工具|tool|agent|自动调度|路由)/.test(text)
    || (Array.isArray(card.supported_endpoint_types) && card.supported_endpoint_types.includes('openai'))
  const longContext = typeof model.contextWindow === 'number' && model.contextWindow >= 1_000_000
  if (reasoning) caps.push('reasoning')
  if (vision) caps.push('vision')
  if (code) caps.push('code')
  if (tools) caps.push('tools')
  if (longContext) caps.push('longContext')
  return caps
}

function resolvePromo(
  card: TakoPricingModel,
  tags: readonly string[],
  effectiveRatio: number,
): TakoModelCardPromo | undefined {
  if (card.promo !== undefined && card.promo !== null) {
    const label = (card.promo.label ?? card.promo.tag ?? '').trim()
    if (label !== '') {
      const orig = positiveNumber(card.promo.original_input_price_per_million)
      const endsAt = (card.promo.ends_at ?? card.promo.end ?? '').trim()
      return {
        label,
        ...orig === undefined ? {} : { originalInputPriceUsdPerMillion: orig * effectiveRatio },
        ...endsAt === '' ? {} : { endsAt },
      }
    }
  }
  const promoTag = tags.find(tag => /(限时|半价|特惠|促销|活动)/.test(tag))
  return promoTag === undefined ? undefined : { label: promoTag }
}

/**
 * Project one directory card onto a filtered route model for the console.
 * @param card - the pricing row the model came from.
 * @param model - the resulting route model (override-applied), for display flags.
 * @param options - optional top-level vendor map and group ratios from `/api/pricing`.
 */
export function toModelCard(
  card: TakoPricingModel,
  model: TakoModel,
  options: BuildCardsOptions = {},
): TakoModelCard {
  const tags = parseTags(card.tags)
  const channels = Array.isArray(card.channels) ? card.channels : []
  const vendorsById = options.vendors === undefined ? undefined : new Map(options.vendors.map(v => [v.id, v]))
  const { ratio: effectiveRatio, hasChannelPricing } = resolveEffectiveRatio(card, options.groupRatio)

  const channelRealized = channels
    .map(channel => positiveNumber(channel.realized_price_per_million))
    .filter((value): value is number => value !== undefined)
  const topRealized = positiveNumber(card.realized_price_per_million)
  const realizedPriceUsdPerMillion = channelRealized.length > 0
    ? Math.min(...channelRealized)
    : topRealized !== undefined ? topRealized * (hasChannelPricing ? effectiveRatio : 1) : undefined

  const channelStandard = channels
    .map(channel => positiveNumber(channel.standard_load_price_per_million))
    .filter((value): value is number => value !== undefined)
  const topStandard = positiveNumber(card.standard_load_price_per_million)

  const cacheHits = [
    ...channels.map(channel => finiteNumber(channel.cache_hit_rate)),
    finiteNumber(card.cache_hit_rate),
  ].filter((value): value is number => value !== undefined && value >= 0 && value <= 1)

  const isDynamic = card.billing_mode === 'tiered_expr' && typeof card.billing_expr === 'string' && card.billing_expr.trim() !== ''
  const isCall = card.quota_type === 1
  const tiered = isDynamic ? parseTieredPrices(card.billing_expr) : {}

  let billingType: TakoModelBillingType = 'token'
  let inputPriceUsdPerMillion: number | undefined
  let cachePriceUsdPerMillion: number | undefined
  let outputPriceUsdPerMillion: number | undefined
  let callPriceUsd: number | undefined
  let baseOfficialInputUsd: number | undefined
  let baseOfficialOutputUsd: number | undefined

  if (isCall) {
    const rawCall = finiteNumber(card.model_price) ?? 0
    const effectiveCall = rawCall * effectiveRatio
    if (effectiveCall <= 0) {
      billingType = 'free'
      inputPriceUsdPerMillion = 0
      cachePriceUsdPerMillion = 0
      outputPriceUsdPerMillion = 0
    } else {
      billingType = 'call'
      callPriceUsd = effectiveCall
    }
  } else if (isDynamic) {
    billingType = 'dynamic'
    if (tiered.input !== undefined) {
      baseOfficialInputUsd = tiered.input
      inputPriceUsdPerMillion = tiered.input * effectiveRatio
    } else if (positiveNumber(card.model_ratio) !== undefined) {
      baseOfficialInputUsd = card.model_ratio! * 2
      inputPriceUsdPerMillion = baseOfficialInputUsd * effectiveRatio
    }
    if (tiered.output !== undefined) {
      baseOfficialOutputUsd = tiered.output
      outputPriceUsdPerMillion = tiered.output * effectiveRatio
    } else if (inputPriceUsdPerMillion !== undefined) {
      const comp = finiteNumber(card.completion_ratio) ?? 1
      baseOfficialOutputUsd = (baseOfficialInputUsd ?? 0) * comp
      outputPriceUsdPerMillion = inputPriceUsdPerMillion * comp
    }
    if (tiered.cache !== undefined) {
      cachePriceUsdPerMillion = tiered.cache * effectiveRatio
    } else if (inputPriceUsdPerMillion !== undefined && finiteNumber(card.cache_ratio) !== undefined) {
      cachePriceUsdPerMillion = inputPriceUsdPerMillion * Number(card.cache_ratio)
    }
  } else {
    const mr = finiteNumber(card.model_ratio)
    const mp = finiteNumber(card.model_price)
    const explicitlyFree = (mr === 0 && (mp === undefined || mp === 0) && realizedPriceUsdPerMillion === undefined && topStandard === undefined && channelStandard.length === 0)
      || (tags.includes('免费') && (mr === undefined || mr === 0) && (mp === undefined || mp === 0))
    if (explicitlyFree) {
      billingType = 'free'
      inputPriceUsdPerMillion = 0
      cachePriceUsdPerMillion = 0
      outputPriceUsdPerMillion = 0
    } else if (mr !== undefined && mr > 0) {
      baseOfficialInputUsd = mr * 2
      inputPriceUsdPerMillion = baseOfficialInputUsd * effectiveRatio
      const comp = finiteNumber(card.completion_ratio) ?? 1
      baseOfficialOutputUsd = baseOfficialInputUsd * comp
      outputPriceUsdPerMillion = inputPriceUsdPerMillion * comp
      if (finiteNumber(card.cache_ratio) !== undefined) {
        cachePriceUsdPerMillion = inputPriceUsdPerMillion * Number(card.cache_ratio)
      }
    }
  }

  // Standard load average (for Avg view fallback) — preserve legacy model_ratio * 2 behavior when unpublished.
  const standardPriceUsdPerMillion = billingType === 'free'
    ? 0
    : billingType === 'call'
      ? undefined
      : channelStandard.length > 0
        ? Math.min(...channelStandard)
        : topStandard !== undefined
          ? topStandard * effectiveRatio
          : inputPriceUsdPerMillion

  // Official comparison & discount badge — STRICTLY gated to token/dynamic models with positive pricing.
  // Free and per-call models NEVER receive an officialRatio or discount badge.
  let officialInputPriceUsdPerMillion: number | undefined
  let officialOutputPriceUsdPerMillion: number | undefined
  let officialRatio: number | undefined
  if (billingType === 'token' || billingType === 'dynamic') {
    const explicitOffIn = positiveNumber(card.official_input_price_per_million)
    const explicitOffOut = positiveNumber(card.official_output_price_per_million)
    if (explicitOffIn !== undefined) {
      officialInputPriceUsdPerMillion = explicitOffIn
      officialOutputPriceUsdPerMillion = explicitOffOut
    } else if (hasChannelPricing && baseOfficialInputUsd !== undefined && baseOfficialInputUsd > 0) {
      officialInputPriceUsdPerMillion = baseOfficialInputUsd * OFFICIAL_QUOTA_PER_USD
      if (baseOfficialOutputUsd !== undefined && baseOfficialOutputUsd > 0) {
        officialOutputPriceUsdPerMillion = baseOfficialOutputUsd * OFFICIAL_QUOTA_PER_USD
      }
    }
    if (officialInputPriceUsdPerMillion !== undefined && inputPriceUsdPerMillion !== undefined && inputPriceUsdPerMillion > 0) {
      const siteSum = inputPriceUsdPerMillion + (outputPriceUsdPerMillion ?? 0)
      const offSum = officialInputPriceUsdPerMillion + (officialOutputPriceUsdPerMillion ?? 0)
      const r = offSum > 0 ? siteSum / offSum : Number.NaN
      if (Number.isFinite(r) && r > 0 && r < 0.99) officialRatio = r
    }
  }

  const vendor = typeof card.icon === 'string' && card.icon !== '' ? card.icon
    : typeof card.vendor_icon === 'string' && card.vendor_icon !== '' ? card.vendor_icon
    : typeof card.vendor_id === 'number' ? String(card.vendor_id) : undefined
  const vendorName = resolveVendorName(card, model.id, vendorsById)
  const restricted = card.client_restriction !== undefined
    ? card.client_restriction !== null
    : tags.includes(CLAUDE_CODE_ONLY_TAG)
  const promo = resolvePromo(card, tags, effectiveRatio)
  const channelSummary: TakoModelCardChannel[] = channels
    .filter(channel => typeof channel.channel_name === 'string' && channel.channel_name !== '')
    .map(channel => ({
      name: channel.channel_name,
      ...typeof channel.channel_tag === 'string' && channel.channel_tag !== '' ? { tag: channel.channel_tag } : {},
      ...positiveNumber(channel.channel_ratio) === undefined ? {} : { ratio: channel.channel_ratio },
    }))

  return {
    id: model.id,
    ...typeof card.description === 'string' && card.description !== '' ? { description: card.description } : {},
    ...vendor === undefined ? {} : { vendor },
    ...vendorName === undefined ? {} : { vendorName },
    ...vendor === undefined || typeof card.icon !== 'string' || card.icon === '' ? {} : { icon: card.icon },
    tags,
    endpoints: Array.isArray(card.supported_endpoint_types) ? card.supported_endpoint_types.filter(type => typeof type === 'string') : [],
    groups: Array.isArray(card.enable_groups) ? card.enable_groups.filter(group => typeof group === 'string') : [],
    ...model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow },
    vision: (model.input ?? []).includes('image'),
    reasoning: model.reasoningEfforts !== false,
    claudeCodeOnly: restricted,
    billingType,
    capabilities: resolveCapabilities(card, model, tags),
    ...inputPriceUsdPerMillion === undefined ? {} : { inputPriceUsdPerMillion },
    ...cachePriceUsdPerMillion === undefined ? {} : { cachePriceUsdPerMillion },
    ...outputPriceUsdPerMillion === undefined ? {} : { outputPriceUsdPerMillion },
    ...callPriceUsd === undefined ? {} : { callPriceUsd },
    ...officialInputPriceUsdPerMillion === undefined ? {} : { officialInputPriceUsdPerMillion },
    ...officialOutputPriceUsdPerMillion === undefined ? {} : { officialOutputPriceUsdPerMillion },
    ...officialRatio === undefined ? {} : { officialRatio },
    ...promo === undefined ? {} : { promo },
    ...standardPriceUsdPerMillion === undefined ? {} : { standardPriceUsdPerMillion },
    ...realizedPriceUsdPerMillion === undefined ? {} : { realizedPriceUsdPerMillion },
    ...cacheHits.length === 0 ? {} : { cacheHitRate: Math.max(...cacheHits) },
    channelCount: channels.length,
    ...typeof channels[0]?.channel_tag === 'string' && channels[0].channel_tag !== '' ? { channelTag: channels[0].channel_tag } : {},
    ...channelSummary.length === 0 ? {} : { channels: channelSummary },
    ...typeof card.completion_ratio === 'number' && Number.isFinite(card.completion_ratio) && card.completion_ratio !== 1 ? { outputRatio: card.completion_ratio } : {},
  }
}

/**
 * Build the console's card list in route order. Cards are skipped when their
 * pricing row cannot be matched back, so the client can fall back to the plain
 * model rows for those ids.
 */
export function buildCards(
  data: readonly TakoPricingModel[],
  models: readonly TakoModel[],
  options: BuildCardsOptions = {},
): TakoModelCard[] {
  const rawById = new Map<string, TakoPricingModel>()
  for (const card of data) {
    const id = card.model_name.trim()
    if (id === '' || rawById.has(id)) continue
    rawById.set(id, card)
  }
  return models.map(model => {
    const raw = rawById.get(model.id)
    return raw === undefined
      ? toModelCard({ model_name: model.id }, model, options)
      : toModelCard(raw, model, options)
  })
}
