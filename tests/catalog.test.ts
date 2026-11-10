import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { TakoModel, TakoPricingModel, TakoPricingResponse } from '../src/catalog.ts'
import { buildCards, buildCatalog, contextFromTags, DEFAULT_REASONING_EFFORTS, isChatModel, parseTags, reasoningCapabilityReport, toModel } from '../src/catalog.ts'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/pricing-2026-10-25.json', import.meta.url), 'utf8')) as TakoPricingResponse
const data = fixture.data ?? []
const byId = (models: TakoModel[], id: string): TakoModel | undefined => models.find(model => model.id === id)

/** 55 cards − 10 non-chat (search, speech, image generation, jev) − 10 Claude-Code-only. */
const EXPECTED_CHAT_MODELS = 35

describe('fixture catalog', () => {
  const models = buildCatalog(data)
  const ids = models.map(model => model.id)

  it('keeps exactly the chat models', () => {
    expect(data).toHaveLength(55)
    expect(models).toHaveLength(EXPECTED_CHAT_MODELS)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('drops non-chat, jev and Claude-Code-only models', () => {
    const banned = [
      'web_search', 'speech_asr', 'speech_tts',
      'gpt-image-2', 'gpt-image-2.5-sunburst', 'gpt-image-2.5-flare',
      'gemini-3-pro-image', 'gemini-3.1-flash-image', 'grok-imagine-image-quality',
      'jev-latest',
    ]
    for (const id of banned) expect(ids).not.toContain(id)
    expect(ids.some(id => id.startsWith('jev-') || id.startsWith('gpt-image-'))).toBe(false)
    const claudeCodeOnly = data.filter(card => parseTags(card.tags).includes('仅Claude Code')).map(card => card.model_name)
    expect(claudeCodeOnly).toHaveLength(10)
    for (const id of claudeCodeOnly) expect(ids).not.toContain(id)
    // Claude models without the restriction tag stay.
    expect(ids).toContain('claude-haiku-4-5')
    expect(ids).toContain('claude-fable-5-1')
  })

  it('reads context windows from size tags', () => {
    expect(byId(models, 'deepseek-v4.1-flash')?.contextWindow).toBe(1_000_000)
    expect(byId(models, 'gpt-5.6')?.contextWindow).toBe(272_000)
    expect(byId(models, 'gpt-6-sol')?.contextWindow).toBe(1_050_000)
    expect(byId(models, 'hy3')?.contextWindow).toBe(256_000)
    expect(byId(models, 'claude-haiku-4-5')?.contextWindow).toBe(200_000)
  })

  it('ignores a parameter-count tag', () => {
    const gemma = byId(models, 'gemma-4-31b-it')
    expect(gemma).toBeDefined()
    expect(gemma).not.toHaveProperty('contextWindow')
    expect(byId(models, 'tako-auto')).not.toHaveProperty('contextWindow')
    expect(byId(models, 'claude-fable-5-1')).not.toHaveProperty('contextWindow')
  })

  it('maps the Vision tag to image input', () => {
    expect(byId(models, 'deepseek-v4.1-flash')?.input).toEqual(['text', 'image'])
    expect(byId(models, 'gpt-5.6')?.input).toEqual(['text', 'image'])
    expect(byId(models, 'deepseek-v4-pro')?.input).toEqual(['text'])
    expect(byId(models, 'hy3')?.input).toEqual(['text'])
  })

  it('attaches selectable reasoning levels to every chat model', () => {
    expect(models.length).toBeGreaterThan(0)
    for (const model of models) {
      expect(model.reasoningEfforts).toEqual(DEFAULT_REASONING_EFFORTS)
    }
  })

  it('sorts alphabetically without pins', () => {
    expect(ids).toEqual([...ids].sort((a, b) => a.localeCompare(b)))
  })

  it('keeps Claude-Code-only models on request', () => {
    const all = buildCatalog(data, { includeClaudeCodeOnly: true })
    expect(all).toHaveLength(EXPECTED_CHAT_MODELS + 10)
    expect(byId(all, 'claude-opus-5-5')?.contextWindow).toBe(1_000_000)
  })
})

describe('catalog options', () => {
  it('include keeps only matching globs', () => {
    const ids = buildCatalog(data, { include: ['gpt-*'] }).map(model => model.id)
    expect(ids.length).toBeGreaterThan(0)
    expect(ids.every(id => id.startsWith('gpt-'))).toBe(true)
    expect(ids).toContain('gpt-5.6')
  })

  it('exclude removes matching globs after include', () => {
    const ids = buildCatalog(data, { include: ['gpt-*'], exclude: ['gpt-6*'] }).map(model => model.id)
    expect(ids).toContain('gpt-5.6')
    expect(ids.some(id => id.startsWith('gpt-6'))).toBe(false)
  })

  it('treats glob metacharacters other than * literally', () => {
    const ids = buildCatalog(data, { include: ['gpt-5.6'] }).map(model => model.id)
    expect(ids).toEqual(['gpt-5.6'])
  })

  it('lists pinned ids first in the given order', () => {
    const ids = buildCatalog(data, { pinned: ['tako-auto', 'deepseek-v4.1-flash', 'not-listed'] }).map(model => model.id)
    expect(ids.slice(0, 2)).toEqual(['tako-auto', 'deepseek-v4.1-flash'])
    expect(ids).not.toContain('not-listed')
    const rest = ids.slice(2)
    expect(rest).toEqual([...rest].sort((a, b) => a.localeCompare(b)))
  })

  it('applies overrides last without changing the id', () => {
    const models = buildCatalog(data, {
      overrides: {
        'gemma-4-31b-it': { contextWindow: 262_144, maxTokens: 8_192 },
        'hy3': { input: ['text', 'image'], name: 'Hunyuan 3' },
      },
    })
    expect(byId(models, 'gemma-4-31b-it')).toMatchObject({ id: 'gemma-4-31b-it', contextWindow: 262_144, maxTokens: 8_192 })
    expect(byId(models, 'hy3')).toMatchObject({ id: 'hy3', name: 'Hunyuan 3', contextWindow: 256_000, input: ['text', 'image'] })
  })

  it('keeps the catalog input when an override leaves it unset', () => {
    const card: TakoPricingModel = { model_name: 'swe-2', tags: '262K,Vision', supported_endpoint_types: ['openai'] }
    const [named] = buildCatalog([card], { overrides: { 'swe-2': { reasoningEfforts: { medium: 'medium' } } } })
    expect(named).toMatchObject({ input: ['text', 'image'], reasoningEfforts: { medium: 'medium' } })
    const [explicit] = buildCatalog([card], { overrides: { 'swe-2': { input: ['text'] } } })
    expect(explicit?.input).toEqual(['text'])
  })

  it('deduplicates repeated ids', () => {
    const card: TakoPricingModel = { model_name: 'dup', tags: '1M', supported_endpoint_types: ['openai'] }
    expect(buildCatalog([card, { ...card, tags: '2M' }])).toEqual([{
      id: 'dup', name: 'dup', contextWindow: 1_000_000, input: ['text'], reasoningEfforts: DEFAULT_REASONING_EFFORTS,
    }])
  })
})

describe('declared reasoning levels', () => {
  it('uses the levels a card declares', () => {
    expect(toModel({ model_name: 'swe-2', reasoning_levels: ['medium', 'high', 'max'] }).reasoningEfforts)
      .toEqual({ medium: 'medium', high: 'high', max: 'max' })
    expect(toModel({ model_name: 'm', reasoning_levels: ['off', 'xhigh'] }).reasoningEfforts)
      .toEqual({ off: null, xhigh: 'xhigh' })
  })

  it('falls back to the legacy defaults when a card declares nothing usable', () => {
    expect(toModel({ model_name: 'm' }).reasoningEfforts).toEqual(DEFAULT_REASONING_EFFORTS)
    expect(toModel({ model_name: 'm', reasoning_levels: [] }).reasoningEfforts).toEqual(DEFAULT_REASONING_EFFORTS)
    expect(toModel({ model_name: 'm', reasoning_levels: ['ultra', 'medium', 'medium'] }).reasoningEfforts)
      .toEqual({ medium: 'medium' })
  })
})

describe('structured fields', () => {
  it('win over tags', () => {
    const model = toModel({
      model_name: ' m ',
      tags: 'Vision,1M',
      context_length: 400_000,
      max_output_tokens: 64_000,
      input_modalities: ['text'],
    })
    expect(model).toEqual({
      id: 'm', name: 'm', contextWindow: 400_000, maxTokens: 64_000, input: ['text'],
      reasoningEfforts: DEFAULT_REASONING_EFFORTS,
    })
    expect(toModel({ model_name: 'v', input_modalities: ['text', 'image'] }).input).toEqual(['text', 'image'])
  })

  it('fall back to tags when invalid', () => {
    expect(toModel({ model_name: 'm', tags: '272K', context_length: 0 }).contextWindow).toBe(272_000)
    expect(toModel({ model_name: 'm', tags: '272K', context_length: 1.5 }).contextWindow).toBe(272_000)
  })

  it('kind decides chat-ness when present', () => {
    expect(isChatModel({ model_name: 'a', kind: 'chat', supported_endpoint_types: ['image-generation'] })).toBe(true)
    expect(isChatModel({ model_name: 'b', kind: 'image', supported_endpoint_types: ['openai'] })).toBe(false)
  })

  it('client_restriction decides restriction when present', () => {
    const card: TakoPricingModel = { model_name: 'c', kind: 'chat', tags: '仅Claude Code', client_restriction: null }
    expect(isChatModel(card)).toBe(true)
    expect(isChatModel({ ...card, tags: '', client_restriction: 'claude-code' })).toBe(false)
    expect(isChatModel({ ...card, tags: '', client_restriction: 'claude-code' }, { includeClaudeCodeOnly: true })).toBe(true)
  })

  it('requires the openai endpoint without kind', () => {
    expect(isChatModel({ model_name: 'x', supported_endpoint_types: ['anthropic'] })).toBe(false)
    expect(isChatModel({ model_name: 'jev-x', kind: 'chat' })).toBe(false)
    expect(isChatModel({ model_name: '   ', kind: 'chat' })).toBe(false)
  })
})

describe('reasoning capability evidence', () => {
  it('marks missing capability metadata unknown rather than confirming legacy defaults', () => {
    const cards: TakoPricingModel[] = ['a', 'b', 'disabled'].map(model_name => ({ model_name, kind: 'chat' }))
    expect(reasoningCapabilityReport(cards, { overrides: {
      a: { reasoningEfforts: { off: null, high: 'medium' } }, disabled: { reasoningEfforts: false },
    } })).toEqual([
      { model: 'a', source: 'override', reasoningEfforts: { off: null, high: 'medium' } },
      { model: 'b', source: 'unknown' },
      { model: 'disabled', source: 'override', reasoningEfforts: false },
    ])
  })

  it('uses the same filters and pins as the offered catalog', () => {
    const report = reasoningCapabilityReport(data, { include: ['gpt-*'], pinned: ['gpt-5.6'] })
    expect(report[0]?.model).toBe('gpt-5.6')
    expect(report.every(row => row.model.startsWith('gpt-') && row.source === 'unknown')).toBe(true)
  })
})

describe('contextFromTags', () => {
  it('accepts exact size labels only', () => {
    expect(contextFromTags(['272K'])).toBe(272_000)
    expect(contextFromTags(['1.05M'])).toBe(1_050_000)
    expect(contextFromTags(['1m'])).toBe(1_000_000)
    expect(contextFromTags(['31B', 'Open model'])).toBeUndefined()
    expect(contextFromTags(['272K tokens'])).toBeUndefined()
    expect(contextFromTags([])).toBeUndefined()
  })
})

describe('buildCards', () => {
  it('pairs display fields with the filtered models in route order', () => {
    const data: TakoPricingModel[] = [
      { model_name: 'b-model', kind: 'chat', description: 'Beta', tags: '272K', vendor_id: 7 },
      { model_name: 'a-model', kind: 'chat', icon: 'alpha', tags: 'Vision,1M', context_length: 1_000_000,
        supported_endpoint_types: ['openai', 'anthropic'], enable_groups: ['default'],
        model_ratio: 2, completion_ratio: 4,
        channels: [
          { channel_name: 'fast', channel_tag: '安全', realized_price_per_million: 6.5, cache_hit_rate: 0.8 },
          { channel_name: 'cheap', realized_price_per_million: 3.2 },
        ] },
      { model_name: 'tool', kind: 'image-generation' },
    ]
    const models = buildCatalog(data, { pinned: ['b-model'] })
    const cards = buildCards(data, models)
    expect(models.map(m => m.id)).toEqual(['b-model', 'a-model'])
    expect(cards.map(c => c.id)).toEqual(['b-model', 'a-model'])
    const a = cards[1]!
    expect(a.vendor).toBe('alpha')
    expect(cards[0]!.description).toBe('Beta')
    expect(a.description).toBeUndefined()
    expect(a.contextWindow).toBe(1_000_000)
    expect(a.vision).toBe(true)
    expect(a.reasoning).toBe(true)
    expect(a.endpoints).toEqual(['openai', 'anthropic'])
    expect(a.groups).toEqual(['default'])
    expect(a.standardPriceUsdPerMillion).toBe(4)
    expect(a.realizedPriceUsdPerMillion).toBe(3.2)
    expect(a.cacheHitRate).toBe(0.8)
    expect(a.channelCount).toBe(2)
    expect(a.channelTag).toBe('安全')
    expect(a.outputRatio).toBe(4)
  })

  it('falls back to a sparse card for models without a pricing row and skips non-chat rows', () => {
    const data: TakoPricingModel[] = [{ model_name: 'kept', kind: 'chat' }, { model_name: 'dropped', kind: 'image-generation' }]
    const models = buildCatalog(data)
    expect(models.map(m => m.id)).toEqual(['kept'])
    const cards = buildCards([{ model_name: 'other' }], models)
    expect(cards).toHaveLength(1)
    expect(cards[0]!.id).toBe('kept')
    expect(cards[0]!.channelCount).toBe(0)
    expect(cards[0]!.tags).toEqual([])
  })
})
