/**
 * Runtime Tako skills for official DSH profiles that mount `ctx.skills`.
 *
 * Bodies live in memory (not packaged markdown) and tell the model which
 * already-registered tools to call. Search reuses DSH `web_search`.
 * @module dsh-tako/skills
 */

import type { Context } from '@deepseek-ai/cordis'

/** Skill name grammar enforced by `ctx.skills.register`. */
export const TAKO_SEARCH_SKILL = 'tako-search'
export const TAKO_IMAGE_GENERATE_SKILL = 'tako-image-generate'
export const TAKO_IMAGE_EDIT_SKILL = 'tako-image-edit'
export const TAKO_DECIDE_SKILL = 'tako-decide'
export const TAKO_SPEECH_SKILL = 'tako-speech'

export const TAKO_SKILL_NAMES = [
  TAKO_SEARCH_SKILL,
  TAKO_IMAGE_GENERATE_SKILL,
  TAKO_IMAGE_EDIT_SKILL,
  TAKO_DECIDE_SKILL,
  TAKO_SPEECH_SKILL,
] as const

export type TakoSkillName = (typeof TAKO_SKILL_NAMES)[number]

/** Duck-typed payload accepted by `ctx.skills.register`. */
export interface TakoSkillRegistration {
  readonly name: TakoSkillName
  readonly description: string
  readonly whenToUse: string
  readonly source: 'runtime'
  readonly content: string
  readonly provider: 'dsh-tako'
}

const SIGN_IN = 'The user must be signed into Tako (a TAKO_API_KEY stored via the Tako console or `npx dsh-tako login`). Without a key the tools fail.'

export const TAKO_SKILLS: readonly TakoSkillRegistration[] = [
  {
    name: TAKO_SEARCH_SKILL,
    description: 'Search the live web through Tako using the existing DSH web_search tool.',
    whenToUse: 'Use when the user needs current web information and is signed into Tako.',
    source: 'runtime',
    provider: 'dsh-tako',
    content: [
      'Use the existing DSH tool `web_search`. Do not invent a second search tool.',
      'When a Tako API key is configured, `web_search` is already Tako-backed.',
      'Pass one or more search queries; cite returned source URLs.',
      SIGN_IN,
    ].join('\n'),
  },
  {
    name: TAKO_IMAGE_GENERATE_SKILL,
    description: 'Generate a new image with Tako.',
    whenToUse: 'Use when the user wants a new image generated from a text prompt.',
    source: 'runtime',
    provider: 'dsh-tako',
    content: [
      'Call the tool `tako_image_generate`.',
      'Required: `prompt` (what to draw).',
      'Optional: `model` (default `gpt-image-2`), `n`, `size` (for example `1024x1024`).',
      'The tool returns `url` and/or `b64_json` for the first image.',
      SIGN_IN,
    ].join('\n'),
  },
  {
    name: TAKO_IMAGE_EDIT_SKILL,
    description: 'Edit an existing image with Tako.',
    whenToUse: 'Use when the user wants to modify an existing image from a prompt.',
    source: 'runtime',
    provider: 'dsh-tako',
    content: [
      'Call the tool `tako_image_edit`.',
      'Required: `prompt` (what to change) and `image` (an https URL or a data URL). Do not pass a local filesystem path.',
      'Optional: `model` (default `gpt-image-2`).',
      SIGN_IN,
    ].join('\n'),
  },
  {
    name: TAKO_DECIDE_SKILL,
    description: 'Structured yes/no, choice, and score judgments via Tako System One.',
    whenToUse: 'Use when the user needs a structured classification, routing, or scoring decision rather than prose.',
    source: 'runtime',
    provider: 'dsh-tako',
    content: [
      'Call the tool `tako_decide`. This is not a chat model; do not use it to write text.',
      'Required: `state` (string or object) and `questions` (a non-empty object).',
      'Each question value has `type` `noul` (yes/no), `choice` (pick one named option), or `score` (ranked labels), plus `instructions`.',
      'For `choice`, `criteria` is an object of option id → description. For `score`, `criteria` is an array of labels. Do not send `type` "criterion".',
      'Optional: `model` (default `jev-latest`). Prefer English state text.',
      SIGN_IN,
    ].join('\n'),
  },
  {
    name: TAKO_SPEECH_SKILL,
    description: 'Tako text-to-speech and audio transcription.',
    whenToUse: 'Use when the user wants spoken audio from text, or a transcript from an audio file.',
    source: 'runtime',
    provider: 'dsh-tako',
    content: [
      'Text to speech: call `tako_speech_tts`. Required: `input`. Optional: `model` (default `speech_tts`), `voice`. Returns `{ path, contentType }` for a temp audio file.',
      'Speech to text: call `tako_speech_transcribe`. Required: `file` (a local path or an http(s) URL). Optional: `model` (default `speech_asr`). Returns `{ text }`.',
      SIGN_IN,
    ].join('\n'),
  },
]

interface SkillsLike {
  register: (skill: TakoSkillRegistration) => (() => void) | void
}

/**
 * Register the five Tako skills while `skills` is mounted.
 * Profiles without that service never enter this path (`ctx.inject`).
 */
export function applyTakoSkills(ctx: Context): void {
  ctx.inject(['skills'], inner => {
    inner.effect(() => {
      const skills = (inner as unknown as { skills?: SkillsLike }).skills
      if (typeof skills?.register !== 'function') {
        inner.logger.debug?.('skills seam has no register; Tako skills not registered')
        return () => {}
      }
      const disposers: (() => void)[] = []
      for (const skill of TAKO_SKILLS) {
        const unregister = skills.register(skill)
        if (unregister !== undefined) disposers.push(unregister)
      }
      return () => {
        for (const dispose of disposers) dispose()
      }
    })
  })
}
