import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { TakoModel, TakoPricingModel, TakoPricingResponse } from '../src/catalog.ts'
import { buildCatalog, contextFromTags, isChatModel, parseTags, toModel } from '../src/catalog.ts'

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

  it('deduplicates repeated ids', () => {
    const card: TakoPricingModel = { model_name: 'dup', tags: '1M', supported_endpoint_types: ['openai'] }
    expect(buildCatalog([card, { ...card, tags: '2M' }])).toEqual([{ id: 'dup', name: 'dup', contextWindow: 1_000_000, input: ['text'] }])
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
    expect(model).toEqual({ id: 'm', name: 'm', contextWindow: 400_000, maxTokens: 64_000, input: ['text'] })
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
