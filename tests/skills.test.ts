import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import {
  applyTakoSkills,
  TAKO_DECIDE_SKILL,
  TAKO_IMAGE_EDIT_SKILL,
  TAKO_IMAGE_GENERATE_SKILL,
  TAKO_SEARCH_SKILL,
  TAKO_SKILL_NAMES,
  TAKO_SPEECH_SKILL,
  type TakoSkillRegistration,
} from '../src/skills.ts'

function skillsCtx(options: { skills?: { register?: (skill: TakoSkillRegistration) => () => void } } = {}) {
  const register = vi.fn((_skill: TakoSkillRegistration) => () => {})
  const disposers: (() => void)[] = []
  const log = { info: vi.fn(), warn: vi.fn(), debug: vi.fn() }
  const skills = options.skills !== undefined ? options.skills : { register }
  const inner = {
    skills,
    logger: log,
    effect: (fn: () => (() => void) | void) => {
      const dispose = fn()
      if (dispose !== undefined) disposers.push(dispose)
    },
  }
  const inject = vi.fn((_deps: string[], fn: (next: typeof inner) => void) => { fn(inner) })
  const ctx = { logger: log, inject, effect: inner.effect }
  return {
    ctx: ctx as unknown as Context,
    inject,
    register,
    logger: log,
    dispose: () => { disposers.forEach(dispose => dispose()) },
  }
}

const TOOL_BY_SKILL: Record<string, string> = {
  [TAKO_SEARCH_SKILL]: 'web_search',
  [TAKO_IMAGE_GENERATE_SKILL]: 'tako_image_generate',
  [TAKO_IMAGE_EDIT_SKILL]: 'tako_image_edit',
  [TAKO_DECIDE_SKILL]: 'tako_decide',
  [TAKO_SPEECH_SKILL]: 'tako_speech_tts',
}

describe('applyTakoSkills', () => {
  it('injects skills and registers exactly the five Tako skill names', () => {
    const fake = skillsCtx()
    applyTakoSkills(fake.ctx)
    expect(fake.inject).toHaveBeenCalledWith(['skills'], expect.any(Function))
    expect(fake.register).toHaveBeenCalledTimes(TAKO_SKILL_NAMES.length)
    const names = fake.register.mock.calls.map(call => call[0].name)
    expect(names).toEqual([...TAKO_SKILL_NAMES])
    expect(new Set(names)).toEqual(new Set(TAKO_SKILL_NAMES))
  })

  it('registers each skill with a description and content that names the right tool', () => {
    const fake = skillsCtx()
    applyTakoSkills(fake.ctx)
    for (const [skill] of fake.register.mock.calls) {
      expect(skill.description.length).toBeGreaterThan(0)
      expect(skill.whenToUse.length).toBeGreaterThan(0)
      expect(skill.source).toBe('runtime')
      expect(skill.provider).toBe('dsh-tako')
      const tool = TOOL_BY_SKILL[skill.name]
      expect(tool).toBeDefined()
      expect(skill.content).toContain(tool)
    }
  })

  it('skips registration when skills.register is missing', () => {
    const fake = skillsCtx({ skills: {} })
    applyTakoSkills(fake.ctx)
    expect(fake.logger.debug).toHaveBeenCalled()
    expect(fake.logger.debug.mock.calls.some(call => String(call[0]).includes('register'))).toBe(true)
  })

  it('unregisters skills when the effect disposes', () => {
    const unregister = vi.fn()
    const register = vi.fn(() => unregister)
    const fake = skillsCtx({ skills: { register } })
    applyTakoSkills(fake.ctx)
    fake.dispose()
    expect(unregister).toHaveBeenCalledTimes(TAKO_SKILL_NAMES.length)
  })
})
