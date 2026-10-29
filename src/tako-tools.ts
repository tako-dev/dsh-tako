/**
 * Tako-backed executable tools for official DSH profiles that mount `ctx.tools`.
 *
 * Duck-types `tools.register` the same way search duck-types `ctx.web`.
 * Image, System One, and speech calls share the plugin's Tako origin and
 * `TAKO_API_KEY`. Search is not duplicated: the model uses DSH `web_search`.
 * @module dsh-tako/tako-tools
 */

import { writeFile, unlink, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { normalizeOrigin } from './shared.ts'

export const TAKO_IMAGE_GENERATE_TOOL = 'tako_image_generate'
export const TAKO_IMAGE_EDIT_TOOL = 'tako_image_edit'
export const TAKO_DECIDE_TOOL = 'tako_decide'
export const TAKO_SPEECH_TTS_TOOL = 'tako_speech_tts'
export const TAKO_SPEECH_TRANSCRIBE_TOOL = 'tako_speech_transcribe'

export const TAKO_TOOL_NAMES = [
  TAKO_IMAGE_GENERATE_TOOL,
  TAKO_IMAGE_EDIT_TOOL,
  TAKO_DECIDE_TOOL,
  TAKO_SPEECH_TTS_TOOL,
  TAKO_SPEECH_TRANSCRIBE_TOOL,
] as const

export const DEFAULT_IMAGE_MODEL = 'gpt-image-2'
export const DEFAULT_DECIDE_MODEL = 'jev-latest'
export const DEFAULT_TTS_MODEL = 'speech_tts'
export const DEFAULT_ASR_MODEL = 'speech_asr'

export const IMAGE_TIMEOUT_MS = 120_000
export const DECIDE_TIMEOUT_MS = 60_000
export const SPEECH_TIMEOUT_MS = 60_000

export const MISSING_KEY = 'no Tako API key is configured'

/** Duck-typed `ctx.credentials.resolve`. */
export interface CredentialResolver {
  resolve: (ref: string) => Promise<{ value: string, source: string } | undefined>
}

export interface TakoHttpOptions {
  origin: string
  apiKey: string | undefined
  fetch?: typeof fetch
  signal?: AbortSignal
}

export interface ImageResult {
  url?: string
  b64_json?: string
  revised_prompt?: string
}

export interface SpeechTtsResult {
  path: string
  contentType: string
}

export interface SpeechTranscribeResult {
  text: string
}

export interface JsonToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
  output: {
    schema: Record<string, unknown>
    render: (args: unknown, value: unknown) => Array<{ type: 'text', text: string }>
  }
  timeoutMs: number
  isConcurrencySafe: () => boolean
  execute: (args: unknown, exec?: { signal?: AbortSignal }) => Promise<unknown>
}

interface JsonToolOptions {
  name: string
  description: string
  parameters: Record<string, unknown>
  execute: (args: unknown, signal?: AbortSignal) => Promise<unknown>
  timeoutMs: number
  outputSchema: Record<string, unknown>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'name' in error && (error as { name: unknown }).name === 'AbortError'
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

function aborted(label: string, cause?: unknown): Error {
  return cause === undefined ? new Error(`Tako ${label} aborted`) : new Error(`Tako ${label} aborted`, { cause })
}

function requireKey(apiKey: string | undefined): string {
  if (apiKey === undefined || apiKey === '') throw new Error(MISSING_KEY)
  return apiKey
}

function argsObject(args: unknown): Record<string, unknown> {
  if (!isRecord(args)) throw new Error('arguments must be an object')
  return args
}

function requireArgString(args: Record<string, unknown>, field: string): string {
  const value = nonEmptyString(args[field])
  if (value === undefined) throw new Error(`${field} is required`)
  return value
}

/** Build a registry-ready tool with JSON-string render and a closed output schema. */
export function jsonTool(options: JsonToolOptions): JsonToolDefinition {
  return {
    name: options.name,
    description: options.description,
    parameters: options.parameters,
    output: {
      schema: options.outputSchema,
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    timeoutMs: options.timeoutMs,
    isConcurrencySafe: () => true,
    execute: (args, exec) => options.execute(args, exec?.signal),
  }
}

async function takoFetch(opts: TakoHttpOptions, path: string, init: RequestInit, label: string): Promise<Response> {
  const key = requireKey(opts.apiKey)
  const fetchImpl = opts.fetch ?? fetch
  const headers = new Headers(init.headers)
  headers.set('authorization', `Bearer ${key}`)
  const request: RequestInit = { ...init, headers, redirect: 'error' }
  if (opts.signal !== undefined) request.signal = opts.signal
  try {
    return await fetchImpl(`${opts.origin}${path}`, request)
  } catch (error: unknown) {
    if (isAbortError(error)) throw aborted(label, error)
    throw new Error(`Tako ${label} request failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
  }
}

async function throwHttpError(response: Response, label: string): Promise<never> {
  let message = `Tako ${label} returned HTTP ${response.status}`
  try {
    const parsed: unknown = await response.json()
    const detail = isRecord(parsed) && isRecord(parsed.error) ? parsed.error.message : undefined
    if (typeof detail === 'string' && detail !== '') message = detail
  } catch (error: unknown) {
    if (isAbortError(error)) throw aborted(label, error)
  }
  throw new Error(message)
}

async function readJson(response: Response, label: string): Promise<unknown> {
  if (!response.ok) await throwHttpError(response, label)
  try {
    return await response.json()
  } catch (error: unknown) {
    if (isAbortError(error)) throw aborted(label, error)
    throw new Error(`Tako ${label} returned an unprocessable response body: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
  }
}

async function postJson(opts: TakoHttpOptions, path: string, body: unknown, label: string): Promise<unknown> {
  const response = await takoFetch(opts, path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
  }, label)
  return readJson(response, label)
}

function mapImageData(body: unknown, label: string): ImageResult {
  const record = isRecord(body) ? body : {}
  const rows = Array.isArray(record.data) ? record.data : []
  const first = rows[0]
  if (!isRecord(first)) throw new Error(`Tako ${label} returned no image`)
  const result: ImageResult = {}
  const url = nonEmptyString(first.url)
  const b64 = nonEmptyString(first.b64_json)
  const revised = nonEmptyString(first.revised_prompt)
  if (url !== undefined) result.url = url
  if (b64 !== undefined) result.b64_json = b64
  if (revised !== undefined) result.revised_prompt = revised
  if (result.url === undefined && result.b64_json === undefined) throw new Error(`Tako ${label} returned no image`)
  return result
}

/** `POST /v1/images/generations`. */
export async function takoImageGenerate(opts: TakoHttpOptions, args: unknown): Promise<ImageResult> {
  const fields = argsObject(args)
  const body: Record<string, unknown> = {
    model: nonEmptyString(fields.model) ?? DEFAULT_IMAGE_MODEL,
    prompt: requireArgString(fields, 'prompt'),
    response_format: 'url',
  }
  if (isPositiveInteger(fields.n)) body.n = fields.n
  const size = nonEmptyString(fields.size)
  if (size !== undefined) body.size = size
  return mapImageData(await postJson(opts, '/v1/images/generations', body, 'image generate'), 'image generate')
}

/** `POST /v1/images/edits` with an https or data URL. */
export async function takoImageEdit(opts: TakoHttpOptions, args: unknown): Promise<ImageResult> {
  const fields = argsObject(args)
  const body = {
    model: nonEmptyString(fields.model) ?? DEFAULT_IMAGE_MODEL,
    prompt: requireArgString(fields, 'prompt'),
    image: requireArgString(fields, 'image'),
  }
  return mapImageData(await postJson(opts, '/v1/images/edits', body, 'image edit'), 'image edit')
}

function questionsObject(value: unknown): Record<string, unknown> {
  if (!isRecord(value) || Object.keys(value).length === 0) throw new Error('questions is required')
  return value
}

function stateValue(value: unknown): unknown {
  if (typeof value === 'string' && value !== '') return value
  if (isRecord(value)) return value
  throw new Error('state is required')
}

/** `POST /v1/systemone`. Returns the JSON body as-is. */
export async function takoDecide(opts: TakoHttpOptions, args: unknown): Promise<unknown> {
  const fields = argsObject(args)
  const body = {
    state: stateValue(fields.state),
    questions: questionsObject(fields.questions),
    model: nonEmptyString(fields.model) ?? DEFAULT_DECIDE_MODEL,
  }
  return postJson(opts, '/v1/systemone', body, 'decide')
}

function audioExtension(contentType: string): '.mp3' | '.wav' {
  const type = contentType.split(';')[0]?.trim().toLowerCase() ?? ''
  if (type === 'audio/wav' || type === 'audio/wave' || type === 'audio/x-wav') return '.wav'
  return '.mp3'
}

function ttsPath(contentType: string): string {
  return join(tmpdir(), `dsh-tako-tts-${Date.now()}-${process.hrtime.bigint()}${audioExtension(contentType)}`)
}

/** `POST /v1/audio/speech`; writes a temp file and returns its path. */
export async function takoSpeechTts(opts: TakoHttpOptions, args: unknown): Promise<SpeechTtsResult> {
  const fields = argsObject(args)
  const body: Record<string, unknown> = {
    model: nonEmptyString(fields.model) ?? DEFAULT_TTS_MODEL,
    input: requireArgString(fields, 'input'),
  }
  const voice = nonEmptyString(fields.voice)
  if (voice !== undefined) body.voice = voice
  const response = await takoFetch(opts, '/v1/audio/speech', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'audio/mpeg, audio/wav, */*' },
    body: JSON.stringify(body),
  }, 'speech')
  if (!response.ok) await throwHttpError(response, 'speech')
  let bytes: Uint8Array
  try {
    bytes = new Uint8Array(await response.arrayBuffer())
  } catch (error: unknown) {
    if (isAbortError(error)) throw aborted('speech', error)
    throw new Error(`Tako speech returned an unprocessable response body: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
  }
  const contentType = response.headers.get('content-type') ?? 'audio/mpeg'
  const path = ttsPath(contentType)
  try {
    await writeFile(path, bytes, opts.signal !== undefined ? { signal: opts.signal } : {})
  } catch (error: unknown) {
    await unlink(path).catch(() => {})
    if (isAbortError(error)) throw aborted('speech', error)
    throw error
  }
  if (opts.signal?.aborted) {
    await unlink(path).catch(() => {})
    throw aborted('speech')
  }
  return { path, contentType }
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value)
}

function mimeFromName(name: string): string {
  const lower = name.toLowerCase()
  if (lower.endsWith('.mp3')) return 'audio/mpeg'
  if (lower.endsWith('.wav')) return 'audio/wav'
  if (lower.endsWith('.m4a')) return 'audio/mp4'
  if (lower.endsWith('.ogg')) return 'audio/ogg'
  if (lower.endsWith('.webm')) return 'audio/webm'
  if (lower.endsWith('.flac')) return 'audio/flac'
  return 'application/octet-stream'
}

function filenameFromUrl(url: string): string {
  try {
    const name = new URL(url).pathname.split('/').filter(Boolean).at(-1)
    return name !== undefined && name !== '' ? decodeURIComponent(name) : 'audio'
  } catch {
    return 'audio'
  }
}

async function readAudioFile(opts: TakoHttpOptions, file: string): Promise<{ bytes: Uint8Array, filename: string, mime: string }> {
  if (isHttpUrl(file)) {
    const fetchImpl = opts.fetch ?? fetch
    const init: RequestInit = { method: 'GET', redirect: 'error', headers: { accept: '*/*' } }
    if (opts.signal !== undefined) init.signal = opts.signal
    let response: Response
    try {
      response = await fetchImpl(file, init)
    } catch (error: unknown) {
      if (isAbortError(error)) throw aborted('transcribe', error)
      throw new Error(`Tako transcribe request failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
    }
    if (!response.ok) throw new Error(`Tako transcribe could not fetch audio: HTTP ${response.status}`)
    let bytes: Uint8Array
    try {
      bytes = new Uint8Array(await response.arrayBuffer())
    } catch (error: unknown) {
      if (isAbortError(error)) throw aborted('transcribe', error)
      throw error
    }
    const filename = filenameFromUrl(file)
    const mime = response.headers.get('content-type') ?? mimeFromName(filename)
    return { bytes, filename, mime }
  }
  try {
    const bytes = new Uint8Array(await readFile(file, opts.signal !== undefined ? { signal: opts.signal } : {}))
    const filename = basename(file) || 'audio'
    return { bytes, filename, mime: mimeFromName(filename) }
  } catch (error: unknown) {
    if (isAbortError(error)) throw aborted('transcribe', error)
    throw error
  }
}

function transcribeText(body: unknown): string {
  if (!isRecord(body)) throw new Error('Tako transcribe returned an unprocessable response body: missing text')
  const text = body.text
  if (typeof text === 'string') return text
  throw new Error('Tako transcribe returned an unprocessable response body: missing text')
}

/** `POST /v1/audio/transcriptions` as multipart `file`. */
export async function takoSpeechTranscribe(opts: TakoHttpOptions, args: unknown): Promise<SpeechTranscribeResult> {
  const fields = argsObject(args)
  const file = requireArgString(fields, 'file')
  const model = nonEmptyString(fields.model) ?? DEFAULT_ASR_MODEL
  const audio = await readAudioFile(opts, file)
  const form = new FormData()
  const copy = new ArrayBuffer(audio.bytes.byteLength)
  new Uint8Array(copy).set(audio.bytes)
  form.append('file', new Blob([copy], { type: audio.mime }), audio.filename)
  form.append('model', model)
  const response = await takoFetch(opts, '/v1/audio/transcriptions', {
    method: 'POST',
    headers: { accept: 'application/json' },
    body: form,
  }, 'transcribe')
  return { text: transcribeText(await readJson(response, 'transcribe')) }
}

const IMAGE_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    url: { type: 'string' },
    b64_json: { type: 'string' },
    revised_prompt: { type: 'string' },
  },
}

const DECIDE_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: true,
}

const TTS_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    path: { type: 'string' },
    contentType: { type: 'string' },
  },
  required: ['path', 'contentType'],
}

const TRANSCRIBE_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    text: { type: 'string' },
  },
  required: ['text'],
}

function takoToolDefinitions(
  origin: string,
  resolveApiKey: () => Promise<string | undefined>,
  fetchImpl: typeof fetch,
): JsonToolDefinition[] {
  const call = async <T>(label: string, signal: AbortSignal | undefined, run: (opts: TakoHttpOptions) => Promise<T>): Promise<T> => {
    let key: string | undefined
    try {
      key = await resolveApiKey()
    } catch (error: unknown) {
      if (isAbortError(error)) throw aborted(label, error)
      throw error
    }
    return run({ origin, apiKey: key, fetch: fetchImpl, signal })
  }
  return [
    jsonTool({
      name: TAKO_IMAGE_GENERATE_TOOL,
      description: 'Generate an image with Tako. Required: prompt. Optional: model (default gpt-image-2), n, size.',
      timeoutMs: IMAGE_TIMEOUT_MS,
      outputSchema: IMAGE_OUTPUT_SCHEMA,
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          prompt: { type: 'string', description: 'What to draw.' },
          model: { type: 'string', description: `Defaults to ${DEFAULT_IMAGE_MODEL}.` },
          n: { type: 'integer', description: 'How many images to generate.' },
          size: { type: 'string', description: 'Pixel size such as 1024x1024.' },
        },
        required: ['prompt'],
      },
      execute: (args, signal) => call('image generate', signal, opts => takoImageGenerate(opts, args)),
    }),
    jsonTool({
      name: TAKO_IMAGE_EDIT_TOOL,
      description: 'Edit an image with Tako. Required: prompt and image (https or data URL). Optional: model (default gpt-image-2).',
      timeoutMs: IMAGE_TIMEOUT_MS,
      outputSchema: IMAGE_OUTPUT_SCHEMA,
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          prompt: { type: 'string', description: 'What to change.' },
          image: { type: 'string', description: 'https URL or data URL of the source image.' },
          model: { type: 'string', description: `Defaults to ${DEFAULT_IMAGE_MODEL}.` },
        },
        required: ['prompt', 'image'],
      },
      execute: (args, signal) => call('image edit', signal, opts => takoImageEdit(opts, args)),
    }),
    jsonTool({
      name: TAKO_DECIDE_TOOL,
      description: 'Structured System One judgment. Required: state and questions. Optional: model (default jev-latest).',
      timeoutMs: DECIDE_TIMEOUT_MS,
      outputSchema: DECIDE_OUTPUT_SCHEMA,
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          state: {
            oneOf: [
              { type: 'string' },
              { type: 'object', additionalProperties: true },
            ],
            description: 'Situation to judge (string or object).',
          },
          questions: {
            type: 'object',
            additionalProperties: true,
            description: 'Non-empty map of question name → { type, instructions, criteria? }. type is noul, choice, or score.',
          },
          model: { type: 'string', description: `Defaults to ${DEFAULT_DECIDE_MODEL}.` },
        },
        required: ['state', 'questions'],
      },
      execute: (args, signal) => call('decide', signal, opts => takoDecide(opts, args)),
    }),
    jsonTool({
      name: TAKO_SPEECH_TTS_TOOL,
      description: 'Synthesize speech with Tako. Required: input. Optional: model (default speech_tts), voice. Returns a temp file path.',
      timeoutMs: SPEECH_TIMEOUT_MS,
      outputSchema: TTS_OUTPUT_SCHEMA,
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          input: { type: 'string', description: 'Text to speak.' },
          model: { type: 'string', description: `Defaults to ${DEFAULT_TTS_MODEL}.` },
          voice: { type: 'string', description: 'Optional voice name.' },
        },
        required: ['input'],
      },
      execute: (args, signal) => call('speech', signal, opts => takoSpeechTts(opts, args)),
    }),
    jsonTool({
      name: TAKO_SPEECH_TRANSCRIBE_TOOL,
      description: 'Transcribe audio with Tako. Required: file (local path or http(s) URL). Optional: model (default speech_asr).',
      timeoutMs: SPEECH_TIMEOUT_MS,
      outputSchema: TRANSCRIBE_OUTPUT_SCHEMA,
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          file: { type: 'string', description: 'Local path or http(s) URL of the audio.' },
          model: { type: 'string', description: `Defaults to ${DEFAULT_ASR_MODEL}.` },
        },
        required: ['file'],
      },
      execute: (args, signal) => call('transcribe', signal, opts => takoSpeechTranscribe(opts, args)),
    }),
  ]
}

interface ToolsLike {
  register: (definition: JsonToolDefinition) => (() => void) | void
}

export interface ApplyTakoToolsDeps {
  fetch?: typeof fetch
}

/** Register Tako tools while `tools` and `credentials` are both up. */
export function applyTakoTools(ctx: Context, config: { baseURL: string, apiKeyEnv: string }, deps: ApplyTakoToolsDeps = {}): void {
  ctx.inject(['tools', 'credentials'], inner => {
    const credentials = (inner as unknown as { credentials?: CredentialResolver }).credentials
    const fetchImpl = deps.fetch ?? fetch
    const origin = normalizeOrigin(config.baseURL)
    const resolveApiKey = async (): Promise<string | undefined> => {
      if (credentials === undefined) return undefined
      const resolved = await credentials.resolve(config.apiKeyEnv)
      const value = resolved?.value
      return typeof value === 'string' && value !== '' ? value : undefined
    }
    inner.effect(() => {
      const tools = (inner as unknown as { tools?: ToolsLike }).tools
      if (typeof tools?.register !== 'function') {
        inner.logger.debug?.('tools seam has no register; Tako tools not registered')
        return () => {}
      }
      const disposers: (() => void)[] = []
      for (const definition of takoToolDefinitions(origin, resolveApiKey, fetchImpl)) {
        const unregister = tools.register(definition)
        if (unregister !== undefined) disposers.push(unregister)
      }
      return () => {
        for (const dispose of disposers) dispose()
      }
    })
  })
}
