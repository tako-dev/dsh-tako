/**
 * Look up npm's `dist-tags.latest` for this package and install that version
 * into a dsh profile. Shared by the console route and `dsh-tako update`.
 *
 * The check always reads the official registry (never a configured mirror).
 * Installation prefers the host `pluginManager.installBundle` service — the
 * same pnpm path the official plugin page uses — and only spawns
 * `dsh plugin add` when that service is absent. A failed service call is
 * returned to the caller; it does not fall back to the CLI. Self-updates
 * cannot hot-replace the running plugin, so callers tell the user to restart.
 * @module dsh-tako/upgrade
 */

import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_PROFILE } from './shared.ts'
import type { DshInstall } from './store.ts'
import { locateDsh } from './store.ts'

export const PACKAGE_NAME = 'dsh-tako'
export const NPM_REGISTRY = 'https://registry.npmjs.org'
/** Dist-tags document on the official registry; not the packument. */
export const NPM_DIST_TAGS_URL = `${NPM_REGISTRY}/-/package/${PACKAGE_NAME}/dist-tags`

/** How long a fresh registry answer stays cached. */
export const UPDATE_CACHE_MS = 60 * 60_000
/** How long a failed check stays cached: short, so a blip does not pin the error for an hour. */
export const UPDATE_ERROR_CACHE_MS = 5 * 60_000
const UPDATE_TIMEOUT_MS = 10_000
const INSTALL_TIMEOUT_MS = 120_000
const OUTPUT_TAIL = 400
const AGE_FLAG = '--config.minimum-release-age=0'

let cachedVersion: string | undefined

/**
 * This package's own version, read from the `package.json` shipped beside
 * `lib/` (`import.meta.url` keeps working inside the npm package, where the
 * file sits next to the build output). Falls back to `unknown` if it cannot
 * be read.
 */
export function pluginVersion(): string {
  if (cachedVersion === undefined) {
    try {
      cachedVersion = (JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')) as { version?: string }).version ?? 'unknown'
    } catch {
      cachedVersion = 'unknown'
    }
  }
  return cachedVersion
}

/** `x.y.z` as comparable numbers; `undefined` when the value is not a plain release. */
function versionTuple(version: string): [number, number, number] | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version)
  return match === null ? undefined : [Number(match[1]), Number(match[2]), Number(match[3])]
}

/**
 * Whether `current` sorts before `latest`. Plain `x.y.z` triples compare
 * numerically (`0.10.0` is newer than `0.9.0`); anything else falls back to
 * string order, which keeps a local prerelease from reading as behind.
 */
export function isOlder(current: string, latest: string): boolean {
  const a = versionTuple(current)
  const b = versionTuple(latest)
  if (a === undefined || b === undefined) return current < latest
  return a[0] < b[0] || (a[0] === b[0] && (a[1] < b[1] || (a[1] === b[1] && a[2] < b[2])))
}

/**
 * Official-registry `dist-tags.latest` for this package. Throws when the
 * registry is unreachable, unhealthy, or answers no latest tag.
 */
export async function fetchLatest(fetchImpl: typeof fetch = fetch, timeoutMs = UPDATE_TIMEOUT_MS): Promise<{ latest: string }> {
  const response = await fetchImpl(NPM_DIST_TAGS_URL, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!response.ok) throw new Error(`npm dist-tags answered HTTP ${response.status}`)
  const tags = await response.json() as { latest?: unknown }
  if (typeof tags.latest !== 'string' || tags.latest === '') throw new Error('npm dist-tags carry no latest tag')
  return { latest: tags.latest }
}

/**
 * Walk from a plugin file up to `$DSH_HOME/profiles/<name>/`: the parent
 * directory is named `profiles` and the profile directory has a `package.json`.
 */
export function profileFromPluginPath(start: string): { name: string, dir: string } | undefined {
  let current = resolve(start)
  for (;;) {
    const parent = dirname(current)
    if (parent === current) return undefined
    if (basename(parent) === 'profiles' && existsSync(join(current, 'package.json'))) {
      return { name: basename(current), dir: current }
    }
    current = parent
  }
}

/** Version written on disk at `profileDir/node_modules/dsh-tako`; `undefined` when missing. */
export function readInstalledVersion(profileDir: string): string | undefined {
  try {
    const version = (JSON.parse(readFileSync(join(profileDir, 'node_modules', PACKAGE_NAME, 'package.json'), 'utf8')) as { version?: unknown }).version
    return typeof version === 'string' && version !== '' ? version : undefined
  } catch {
    return undefined
  }
}

/** Local view of `ctx.pluginManager` — no dependency on `@deepseek-ai/dsh-plugin-manager`. */
export interface PluginManagerLike {
  installBundle: (spec: string, options?: { registry?: string }) => Promise<InstallBundleResult>
}

/** Slice of `installBundle`'s result this module reads. */
export interface InstallBundleResult {
  application?: string
  error?: unknown
  version?: string
  restartReason?: string
  packageResult?: { output?: string }
}

export interface SpawnAddRequest {
  execPath: string
  args: readonly string[]
  env: NodeJS.ProcessEnv
  timeoutMs: number
}

export interface SpawnAddResult {
  status: number | null
  stdout: string
  stderr: string
}

export type SpawnAdd = (request: SpawnAddRequest) => Promise<SpawnAddResult>

export interface RunUpgradeInput {
  latest: string
  profile: { name: string, dir?: string }
  pluginManager?: PluginManagerLike
  spawnAdd?: SpawnAdd
  locateDsh?: (explicit?: string, env?: NodeJS.ProcessEnv) => DshInstall
  readInstalledVersion?: (profileDir: string) => string | undefined
  execPath?: string
  env?: NodeJS.ProcessEnv
  timeoutMs?: number
  /** `--dsh` / `$DSH_TAKO_DSH` for {@link locateDsh}. */
  dsh?: string
}

export type UpgradeResult =
  | { ok: true, via: 'plugin-manager' | 'cli', application: 'applied' | 'restart-required', installed: string, restartReason?: string }
  | { ok: false, error: string }

const json = (body: unknown, status = 200): Response => Response.json(body, { status, headers: { 'cache-control': 'no-store' } })

const tail = (text: string, max = OUTPUT_TAIL): string => {
  const trimmed = text.trim()
  return trimmed.length <= max ? trimmed : trimmed.slice(-max)
}

/** `Error`, a string, or the plugin-manager `{ diagnostic, message, code }` shape. */
const describeError = (error: unknown): string => {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (error !== null && typeof error === 'object') {
    const record = error as { diagnostic?: unknown, message?: unknown, code?: unknown }
    for (const field of [record.diagnostic, record.message, record.code]) {
      if (typeof field === 'string' && field !== '') return field
    }
  }
  if (error === undefined || error === null) return ''
  return String(error)
}

function pluginAddArgs(profile: string, latest: string, withAgeFlag: boolean): string[] {
  const flags = [`--registry=${NPM_REGISTRY}/`]
  if (withAgeFlag) flags.push(AGE_FLAG)
  return ['plugin', '--profile', profile, 'add', ...flags, `${PACKAGE_NAME}@${latest}`]
}

async function defaultSpawnAdd(request: SpawnAddRequest): Promise<SpawnAddResult> {
  return await new Promise<SpawnAddResult>((resolveSpawn, reject) => {
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const child = spawn(request.execPath, [...request.args], {
      env: request.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
    }, request.timeoutMs)
    child.stdout?.on('data', (chunk: Buffer | string) => { stdout += String(chunk) })
    child.stderr?.on('data', (chunk: Buffer | string) => { stderr += String(chunk) })
    child.on('error', error => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', status => {
      clearTimeout(timer)
      if (timedOut && !stderr.toLowerCase().includes('timed out')) stderr = `${stderr}\ndsh plugin add timed out after ${request.timeoutMs}ms`.trim()
      resolveSpawn({ status, stdout, stderr })
    })
  })
}

function installFailure(result: InstallBundleResult): string {
  const parts: string[] = []
  const message = describeError(result.error)
  if (message !== '') parts.push(message)
  const output = result.packageResult?.output
  if (typeof output === 'string' && output.trim() !== '') parts.push(tail(output))
  return parts.join('\n') || 'install failed'
}

/**
 * Install `dsh-tako@<latest>` into the profile. Prefers `pluginManager`;
 * spawns `dsh plugin add` only when that service is missing.
 */
export async function runUpgrade(input: RunUpgradeInput): Promise<UpgradeResult> {
  const spec = `${PACKAGE_NAME}@${input.latest}`
  const env = input.env ?? process.env
  if (input.pluginManager !== undefined) {
    let result: InstallBundleResult
    try {
      result = await input.pluginManager.installBundle(spec, { registry: NPM_REGISTRY })
    } catch (error: unknown) {
      return { ok: false, error: describeError(error) || 'install failed' }
    }
    if (result.application === 'failed' || result.error) {
      return { ok: false, error: installFailure(result) }
    }
    const installed: UpgradeResult = {
      ok: true,
      via: 'plugin-manager',
      application: result.application === 'applied' ? 'applied' : 'restart-required',
      installed: result.version ?? input.latest,
    }
    if (typeof result.restartReason === 'string' && result.restartReason !== '') installed.restartReason = result.restartReason
    return installed
  }

  let install: DshInstall
  try {
    install = (input.locateDsh ?? locateDsh)(input.dsh, env)
  } catch (error: unknown) {
    return { ok: false, error: describeError(error) || 'could not find the dsh installation' }
  }
  const bin = join(dirname(install.packageJson), 'lib/bin.js')
  const spawnAdd = input.spawnAdd ?? defaultSpawnAdd
  const timeoutMs = input.timeoutMs ?? INSTALL_TIMEOUT_MS
  const execPath = input.execPath ?? process.execPath
  const runAdd = async (withAgeFlag: boolean): Promise<SpawnAddResult> => spawnAdd({
    execPath,
    args: [bin, ...pluginAddArgs(input.profile.name, input.latest, withAgeFlag)],
    env,
    timeoutMs,
  })

  let spawned: SpawnAddResult
  try {
    spawned = await runAdd(true)
    const spawnText = `${spawned.stderr}\n${spawned.stdout}`
    if (spawned.status !== 0 && /unknown option/i.test(spawnText) && /minimum-release-age/i.test(spawnText)) {
      spawned = await runAdd(false)
    }
  } catch (error: unknown) {
    return { ok: false, error: describeError(error) || 'dsh plugin add failed' }
  }
  if (spawned.status !== 0) {
    const text = [spawned.stderr, spawned.stdout].filter(part => part.trim() !== '').join('\n')
    return { ok: false, error: tail(text) || `dsh plugin add exited ${String(spawned.status)}` }
  }
  const readVer = input.readInstalledVersion ?? readInstalledVersion
  const installed = input.profile.dir !== undefined ? readVer(input.profile.dir) : undefined
  return { ok: true, via: 'cli', application: 'restart-required', installed: installed ?? input.latest }
}

/** What `GET /api/tako.update` answers: the verdict, or why there is none. */
export type UpdateAnswer =
  | { current: string, latest: string, upToDate: boolean, pendingRestart?: boolean, installed?: string }
  | { current: string, checkError: string }

export interface UpdateServiceOptions {
  logger: { info: (...args: unknown[]) => void, warn: (...args: unknown[]) => void }
  /** Seams for tests. */
  fetch?: typeof fetch
  now?: () => number
  /** Overrides the installed version read from `package.json`. */
  currentVersion?: string
  cacheMs?: number
  errorCacheMs?: number
  timeoutMs?: number
  pluginManager?: () => PluginManagerLike | undefined
  profile?: () => { name: string, dir?: string }
  runUpgrade?: (input: RunUpgradeInput) => Promise<UpgradeResult>
  spawnAdd?: SpawnAdd
  locateDsh?: (explicit?: string, env?: NodeJS.ProcessEnv) => DshInstall
  readInstalledVersion?: (profileDir: string) => string | undefined
  execPath?: string
  env?: NodeJS.ProcessEnv
}

/**
 * The update-route handler. One instance per Web connection; the npm answer
 * is cached in memory, so the registry is asked at most once per cache TTL
 * per connection. A failed check answers `{current, checkError}` with HTTP 200.
 * POST installs at most one upgrade at a time (a second POST answers 409).
 */
export function createUpdateService(options: UpdateServiceOptions): { handleUpdate: () => Promise<Response>, handleInstall: () => Promise<Response> } {
  const fetchImpl = options.fetch ?? fetch
  const now = options.now ?? Date.now
  const current = options.currentVersion ?? pluginVersion()
  let cache: { answer: UpdateAnswer, at: number, ttl: number } | undefined
  let pendingRestart: { installed: string } | undefined
  let installing = false

  const diskVersion = (): string | undefined => {
    const profile = options.profile?.()
    if (profile?.dir === undefined) return undefined
    return (options.readInstalledVersion ?? readInstalledVersion)(profile.dir)
  }

  const extras = (): { pendingRestart?: boolean, installed?: string } => {
    const installed = pendingRestart?.installed ?? diskVersion()
    const extra: { pendingRestart?: boolean, installed?: string } = {}
    if (pendingRestart !== undefined) extra.pendingRestart = true
    if (installed !== undefined) extra.installed = installed
    return extra
  }

  const decorate = (answer: UpdateAnswer): UpdateAnswer => {
    if ('checkError' in answer) return answer
    return { ...answer, ...extras() }
  }

  const check = async (): Promise<UpdateAnswer> => {
    try {
      const { latest } = await fetchLatest(fetchImpl, options.timeoutMs ?? UPDATE_TIMEOUT_MS)
      options.logger.info('dsh-tako update check: installed %s, npm latest %s', current, latest)
      return { current, latest, upToDate: !isOlder(current, latest) }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      options.logger.warn('dsh-tako update check failed: %s', message)
      return { current, checkError: message }
    }
  }

  const loadAnswer = async (): Promise<UpdateAnswer> => {
    if (cache !== undefined && now() - cache.at < cache.ttl) return cache.answer
    const answer = await check()
    cache = { answer, at: now(), ttl: 'checkError' in answer ? (options.errorCacheMs ?? UPDATE_ERROR_CACHE_MS) : (options.cacheMs ?? UPDATE_CACHE_MS) }
    return answer
  }

  const handleUpdate = async (): Promise<Response> => json(decorate(await loadAnswer()))

  const handleInstall = async (): Promise<Response> => {
    if (installing) return json({ error: 'install already running' }, 409)
    installing = true
    try {
      const answer = await loadAnswer()
      if ('checkError' in answer) return json({ current, error: answer.checkError })
      const { latest } = answer
      const disk = diskVersion()
      const alreadyLatest = !isOlder(current, latest)
      const diskLatest = disk !== undefined && !isOlder(disk, latest)
      const pendingLatest = pendingRestart?.installed === latest
      if (alreadyLatest || diskLatest || pendingLatest) {
        if (isOlder(current, latest)) pendingRestart = { installed: disk ?? pendingRestart?.installed ?? latest }
        const body: Record<string, unknown> = { ok: true, skipped: true, current, latest }
        const installed = disk ?? pendingRestart?.installed
        if (installed !== undefined) body.installed = installed
        if (isOlder(current, latest)) body.pendingRestart = true
        return json(body)
      }
      const profile = options.profile?.() ?? { name: DEFAULT_PROFILE }
      const result = await (options.runUpgrade ?? runUpgrade)({
        latest,
        profile,
        pluginManager: options.pluginManager?.(),
        spawnAdd: options.spawnAdd,
        locateDsh: options.locateDsh,
        readInstalledVersion: options.readInstalledVersion,
        execPath: options.execPath,
        env: options.env,
      })
      if (!result.ok) {
        options.logger.warn('dsh-tako update: install failed: %s', result.error)
        return json({ ok: false, current, latest, error: result.error })
      }
      pendingRestart = { installed: result.installed }
      cache = undefined
      options.logger.info('dsh-tako update: installed %s via %s', result.installed, result.via)
      return json({
        ok: true,
        skipped: false,
        current,
        latest,
        installed: result.installed,
        application: result.application,
        via: result.via,
        pendingRestart: true,
      })
    } finally {
      installing = false
    }
  }

  return { handleUpdate, handleInstall }
}
