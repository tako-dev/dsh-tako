import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  applyTakoTools,
  DEFAULT_ASR_MODEL,
  DEFAULT_DECIDE_MODEL,
  DEFAULT_IMAGE_MODEL,
  DEFAULT_TTS_MODEL,
  jsonTool,
  MISSING_KEY,
  TAKO_TOOL_NAMES,
  takoDecide,
  takoImageEdit,
  takoImageGenerate,
  takoSpeechTranscribe,
  takoSpeechTts,
  type JsonToolDefinition,
  type TakoHttpOptions,
} from '../src/tako-tools.ts'

const ORIGIN = 'https://tako.test'
const KEY = 'cr_0123456789abcdefWXYZ'

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

function jsonFetch(body: unknown = { data: [{ url: 'https://cdn.test/a.png' }] }, status = 200) {
  return vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => jsonResponse(body, status))
}

function http(overrides: Partial<TakoHttpOptions> = {}): TakoHttpOptions {
  return { origin: ORIGIN, apiKey: KEY, ...overrides }
}

const created: string[] = []
afterEach(() => {
  for (const path of created.splice(0)) {
    try { unlinkSync(path) } catch { /* already gone */ }
  }
})

describe('takoImageGenerate', () => {
  it('POSTs /v1/images/generations with Bearer and default model, and maps data[0].url', async () => {
    const fetchImpl = jsonFetch({ data: [{ url: 'https://cdn.test/cat.png', revised_prompt: 'a cat' }] })
    const result = await takoImageGenerate(http({ fetch: fetchImpl as unknown as typeof fetch }), { prompt: 'a cat' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(url).toBe('https://tako.test/v1/images/generations')
    expect(init).toMatchObject({ method: 'POST', redirect: 'error' })
    const headers = new Headers(init?.headers)
    expect(headers.get('authorization')).toBe(`Bearer ${KEY}`)
    expect(headers.get('content-type')).toBe('application/json')
    expect(headers.get('accept')).toBe('application/json')
    expect(JSON.parse(String(init?.body))).toEqual({
      model: DEFAULT_IMAGE_MODEL,
      prompt: 'a cat',
      response_format: 'url',
    })
    expect(result).toEqual({ url: 'https://cdn.test/cat.png', revised_prompt: 'a cat' })
  })
})

describe('takoImageEdit', () => {
  it('POSTs /v1/images/edits with the image URL', async () => {
    const fetchImpl = jsonFetch({ data: [{ url: 'https://cdn.test/edited.png' }] })
    const result = await takoImageEdit(http({ fetch: fetchImpl as unknown as typeof fetch }), {
      prompt: 'make it green',
      image: 'https://cdn.test/src.png',
    })
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(url).toBe('https://tako.test/v1/images/edits')
    expect(JSON.parse(String(init?.body))).toEqual({
      model: DEFAULT_IMAGE_MODEL,
      prompt: 'make it green',
      image: 'https://cdn.test/src.png',
    })
    expect(result).toEqual({ url: 'https://cdn.test/edited.png' })
  })
})

describe('takoDecide', () => {
  it('POSTs /v1/systemone with default jev-latest when model is omitted', async () => {
    const answers = { answers: { greeting: { noul: 0.9 } } }
    const fetchImpl = jsonFetch(answers)
    const result = await takoDecide(http({ fetch: fetchImpl as unknown as typeof fetch }), {
      state: 'hello',
      questions: { greeting: { type: 'noul', instructions: 'Is this a greeting?' } },
    })
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(url).toBe('https://tako.test/v1/systemone')
    expect(JSON.parse(String(init?.body))).toEqual({
      state: 'hello',
      questions: { greeting: { type: 'noul', instructions: 'Is this a greeting?' } },
      model: DEFAULT_DECIDE_MODEL,
    })
    expect(result).toEqual(answers)
  })
})

describe('takoSpeechTts', () => {
  it('writes a temp file and returns its path', async () => {
    const bytes = Uint8Array.from([1, 2, 3, 4])
    const fetchImpl = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(bytes, { status: 200, headers: { 'content-type': 'audio/mpeg' } }))
    const result = await takoSpeechTts(http({ fetch: fetchImpl as unknown as typeof fetch }), { input: 'hello' })
    created.push(result.path)
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(url).toBe('https://tako.test/v1/audio/speech')
    expect(JSON.parse(String(init?.body))).toEqual({ model: DEFAULT_TTS_MODEL, input: 'hello' })
    expect(result.path.startsWith(join(tmpdir(), 'dsh-tako-tts-'))).toBe(true)
    expect(result.path.endsWith('.mp3')).toBe(true)
    expect(result.contentType).toBe('audio/mpeg')
    expect(existsSync(result.path)).toBe(true)
    expect(readFileSync(result.path)).toEqual(Buffer.from(bytes))
  })
})

describe('takoSpeechTranscribe', () => {
  it('POSTs multipart from a temp audio file and returns text', async () => {
    const audio = join(tmpdir(), `dsh-tako-asr-test-${Date.now()}.wav`)
    writeFileSync(audio, Buffer.from('RIFF'))
    created.push(audio)
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(init?.body).toBeInstanceOf(FormData)
      const form = init?.body as FormData
      expect(form.get('model')).toBe(DEFAULT_ASR_MODEL)
      expect(form.get('file')).toBeTruthy()
      return jsonResponse({ text: 'hello from audio' })
    })
    const result = await takoSpeechTranscribe(http({ fetch: fetchImpl as unknown as typeof fetch }), { file: audio })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(String(fetchImpl.mock.calls[0]![0])).toBe('https://tako.test/v1/audio/transcriptions')
    expect(result).toEqual({ text: 'hello from audio' })
  })
})

describe('errors', () => {
  it('throws when no key is configured', async () => {
    const fetchImpl = jsonFetch()
    await expect(takoImageGenerate(http({ apiKey: undefined, fetch: fetchImpl as unknown as typeof fetch }), { prompt: 'x' })).rejects.toThrow(MISSING_KEY)
    await expect(takoImageGenerate(http({ apiKey: '', fetch: fetchImpl as unknown as typeof fetch }), { prompt: 'x' })).rejects.toThrow(MISSING_KEY)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('uses error.message from HTTP 402', async () => {
    const fetchImpl = jsonFetch({ error: { message: 'insufficient quota' } }, 402)
    await expect(takoImageGenerate(http({ fetch: fetchImpl as unknown as typeof fetch }), { prompt: 'x' })).rejects.toThrow('insufficient quota')
  })

  it('throws an error whose message includes aborted', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new DOMException('This operation was aborted', 'AbortError')
    })
    await expect(takoImageGenerate(http({ fetch: fetchImpl as unknown as typeof fetch }), { prompt: 'x' })).rejects.toThrow(/aborted/)
  })
})

describe('jsonTool', () => {
  it('stringifies the value from render and marks calls concurrency-safe', () => {
    const tool = jsonTool({
      name: 'tako_probe',
      description: 'probe',
      parameters: { type: 'object', additionalProperties: false, properties: {}, required: [] },
      outputSchema: { type: 'object', additionalProperties: true },
      timeoutMs: 1_000,
      execute: async () => ({ ok: true }),
    })
    expect(tool.output.schema).toEqual({ type: 'object', additionalProperties: true })
    expect(tool.output.render({}, { ok: true })).toEqual([{ type: 'text', text: '{"ok":true}' }])
    expect(tool.isConcurrencySafe()).toBe(true)
  })
})

function toolsCtx(options: {
  configured?: boolean
  tools?: { register?: (definition: JsonToolDefinition) => () => void }
} = {}) {
  const register = vi.fn((_definition: JsonToolDefinition) => () => {})
  const resolve = vi.fn(async () => options.configured === false ? undefined : { value: KEY, source: 'file' as const })
  const disposers: (() => void)[] = []
  const log = { info: vi.fn(), warn: vi.fn(), debug: vi.fn() }
  const tools = options.tools !== undefined ? options.tools : { register }
  const credentials = { resolve }
  const inner = {
    tools,
    credentials,
    logger: log,
    effect: (fn: () => (() => void) | void) => {
      const dispose = fn()
      if (dispose !== undefined) disposers.push(dispose)
    },
  }
  const inject = vi.fn((_deps: string[], fn: (next: typeof inner) => void) => { fn(inner) })
  const ctx = { logger: log, inject, effect: inner.effect, get: (name: string) => name === 'credentials' ? credentials : undefined }
  return {
    ctx: ctx as unknown as Context,
    inject,
    register,
    logger: log,
    dispose: () => { disposers.forEach(dispose => dispose()) },
  }
}

describe('applyTakoTools', () => {
  it('injects tools + credentials and registers the five Tako tools', () => {
    const fake = toolsCtx()
    applyTakoTools(fake.ctx, { baseURL: 'https://tako.test/v1', apiKeyEnv: 'TAKO_API_KEY' })
    expect(fake.inject).toHaveBeenCalledWith(['tools', 'credentials'], expect.any(Function))
    expect(fake.register).toHaveBeenCalledTimes(TAKO_TOOL_NAMES.length)
    expect(fake.register.mock.calls.map(call => call[0].name)).toEqual([...TAKO_TOOL_NAMES])
    for (const [definition] of fake.register.mock.calls) {
      expect(definition.output.schema).toMatchObject({ type: 'object' })
      expect(typeof definition.output.render).toBe('function')
      expect(definition.timeoutMs).toBeGreaterThan(0)
    }
  })

  it('skips registration when tools.register is missing', () => {
    const fake = toolsCtx({ tools: {} })
    applyTakoTools(fake.ctx, { baseURL: ORIGIN, apiKeyEnv: 'TAKO_API_KEY' })
    expect(fake.logger.debug).toHaveBeenCalled()
    expect(fake.logger.debug.mock.calls.some(call => String(call[0]).includes('register'))).toBe(true)
  })

  it('unregisters tools when the effect disposes', () => {
    const unregister = vi.fn()
    const register = vi.fn(() => unregister)
    const fake = toolsCtx({ tools: { register } })
    applyTakoTools(fake.ctx, { baseURL: ORIGIN, apiKeyEnv: 'TAKO_API_KEY' })
    fake.dispose()
    expect(unregister).toHaveBeenCalledTimes(TAKO_TOOL_NAMES.length)
  })

  it('registered generate execute POSTs with the resolved key', async () => {
    const fetchImpl = jsonFetch({ data: [{ url: 'https://cdn.test/cat.png' }] })
    const fake = toolsCtx({ configured: true })
    applyTakoTools(fake.ctx, { baseURL: ORIGIN, apiKeyEnv: 'TAKO_API_KEY' }, { fetch: fetchImpl as unknown as typeof fetch })
    const tool = fake.register.mock.calls.find(call => call[0].name === 'tako_image_generate')?.[0]
    expect(tool).toBeDefined()
    await expect(tool!.execute({ prompt: 'a cat' })).resolves.toEqual({ url: 'https://cdn.test/cat.png' })
    const headers = new Headers(fetchImpl.mock.calls[0]![1]?.headers)
    expect(headers.get('authorization')).toBe(`Bearer ${KEY}`)
  })

  it('registered generate execute throws when the key is missing', async () => {
    const fetchImpl = jsonFetch()
    const fake = toolsCtx({ configured: false })
    applyTakoTools(fake.ctx, { baseURL: ORIGIN, apiKeyEnv: 'TAKO_API_KEY' }, { fetch: fetchImpl as unknown as typeof fetch })
    const tool = fake.register.mock.calls.find(call => call[0].name === 'tako_image_generate')?.[0]
    await expect(tool!.execute({ prompt: 'a cat' })).rejects.toThrow(MISSING_KEY)
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
