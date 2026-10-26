import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createUpdateService, pluginVersion, UPDATE_CACHE_MS, UPDATE_ERROR_CACHE_MS, UPDATE_ROUTE, type UpdateServiceOptions } from '../src/web.ts'
import { NPM_REGISTRY, profileFromPluginPath, type SpawnAddRequest, type UpgradeResult } from '../src/upgrade.ts'

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version?: string }

/**
 * A fake npm registry answering the dist-tags document. The state can change
 * between calls, so a test can let a check fail and then let it recover.
 */
function registryFetch(initial: { latest?: unknown, body?: unknown, status?: number, raw?: boolean, fail?: boolean, hang?: boolean } = {}) {
  const state = { ...initial }
  const urls: string[] = []
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    urls.push(String(input instanceof Request ? input.url : input))
    if (state.hang === true) {
      return await new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal
        if (signal === null || signal === undefined || signal.aborted) throw new Error('already aborted')
        signal.addEventListener('abort', () => { reject(signal.reason) })
      })
    }
    if (state.fail === true) throw new TypeError('fetch failed')
    if (state.raw === true) return new Response('<not json>', { status: state.status ?? 200, headers: { 'content-type': 'application/json' } })
    return Response.json(state.body ?? { latest: state.latest }, { status: state.status ?? 200 })
  }) as unknown as typeof fetch
  return { fetchImpl, urls, set: (patch: Partial<typeof state>) => { Object.assign(state, patch) } }
}

function service(overrides: Partial<UpdateServiceOptions> & { registry?: ReturnType<typeof registryFetch> } = {}) {
  const { registry, ...rest } = overrides
  let clock = 1_000
  const logger = { info: vi.fn(), warn: vi.fn() }
  const svc = createUpdateService({
    logger,
    currentVersion: '0.3.0',
    fetch: (registry ?? registryFetch()).fetchImpl,
    now: () => clock,
    ...rest,
  })
  return { svc, logger, advance: (ms: number) => { clock += ms } }
}

describe('console route /api/tako.update', () => {
  it('is registered under /api/tako.update', () => {
    expect(UPDATE_ROUTE).toBe('/api/tako.update')
  })

  it('asks the official registry dist-tags — never a configured mirror — and reports a newer latest', async () => {
    const registry = registryFetch({ latest: '0.4.0' })
    const { svc, logger } = service({ registry })
    const response = await svc.handleUpdate()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ current: '0.3.0', latest: '0.4.0', upToDate: false })
    // The official registry is hardcoded: only the dist-tags document is fetched, not the packument.
    expect(registry.urls).toEqual(['https://registry.npmjs.org/-/package/dsh-tako/dist-tags'])
    expect(logger.info).toHaveBeenCalled()
  })

  it('reads an equal or older registry latest as up to date', async () => {
    const equal = service({ registry: registryFetch({ latest: '0.3.0' }) })
    expect(await (await equal.svc.handleUpdate()).json()).toEqual({ current: '0.3.0', latest: '0.3.0', upToDate: true })
    const older = service({ registry: registryFetch({ latest: '0.2.9' }) })
    expect(await (await older.svc.handleUpdate()).json()).toEqual({ current: '0.3.0', latest: '0.2.9', upToDate: true })
  })

  it('compares x.y.z numerically, not lexicographically', async () => {
    const minor = service({ registry: registryFetch({ latest: '0.9.0' }), currentVersion: '0.10.0' })
    expect(await (await minor.svc.handleUpdate()).json()).toMatchObject({ latest: '0.9.0', upToDate: true }) // lexicographic would call 0.10.0 "older" than 0.9.0
    const patch = service({ registry: registryFetch({ latest: '0.3.10' }), currentVersion: '0.3.9' })
    expect(await (await patch.svc.handleUpdate()).json()).toMatchObject({ latest: '0.3.10', upToDate: false }) // lexicographic would call 0.3.9 newer than 0.3.10
  })

  it('answers {current, checkError} with HTTP 200 — never 500 — when the registry is unreachable, unhealthy, or answers garbage', async () => {
    const registries = [
      registryFetch({ fail: true }),
      registryFetch({ status: 500 }),
      registryFetch({ status: 404, body: { error: 'not found' } }),
      registryFetch({ body: {} }),
      registryFetch({ body: { latest: '' } }),
      registryFetch({ raw: true }),
    ]
    for (const registry of registries) {
      const { svc, logger } = service({ registry })
      const response = await svc.handleUpdate()
      const body = await response.json() as Record<string, unknown>
      expect(response.status, JSON.stringify(registry.urls)).toBe(200)
      expect(body.current).toBe('0.3.0')
      expect(typeof body.checkError).toBe('string')
      expect(body.checkError as string).not.toBe('')
      expect(body.latest).toBeUndefined()
      expect(body.upToDate).toBeUndefined()
      expect(logger.warn).toHaveBeenCalled()
    }
  })

  it('gives up on a hanging registry after the timeout', async () => {
    const { svc } = service({ registry: registryFetch({ hang: true }), timeoutMs: 25 })
    const response = await svc.handleUpdate()
    expect(response.status).toBe(200)
    const body = await response.json() as Record<string, unknown>
    expect(body.current).toBe('0.3.0')
    expect(typeof body.checkError).toBe('string')
  })

  it('caches the answer for an hour: repeated opens hit the registry once', async () => {
    const registry = registryFetch({ latest: '0.4.0' })
    const { svc, advance } = service({ registry })
    const first = await (await svc.handleUpdate()).json()
    await svc.handleUpdate()
    await svc.handleUpdate()
    expect(registry.fetchImpl).toHaveBeenCalledTimes(1)
    advance(UPDATE_CACHE_MS - 1)
    await svc.handleUpdate()
    expect(registry.fetchImpl).toHaveBeenCalledTimes(1) // still inside the TTL
    advance(2)
    expect(await (await svc.handleUpdate()).json()).toEqual(first)
    expect(registry.fetchImpl).toHaveBeenCalledTimes(2) // TTL over: one fresh check
  })

  it('caches a failure only briefly, so a blip neither hammers the registry nor sticks for an hour', async () => {
    const registry = registryFetch({ fail: true })
    const { svc, advance } = service({ registry })
    await svc.handleUpdate()
    await svc.handleUpdate()
    expect(registry.fetchImpl).toHaveBeenCalledTimes(1)
    advance(UPDATE_ERROR_CACHE_MS - 1)
    await svc.handleUpdate()
    expect(registry.fetchImpl).toHaveBeenCalledTimes(1) // still inside the short error TTL
    advance(2)
    registry.set({ fail: false, latest: '0.4.0' })
    expect(await (await svc.handleUpdate()).json()).toEqual({ current: '0.3.0', latest: '0.4.0', upToDate: false })
    expect(registry.fetchImpl).toHaveBeenCalledTimes(2) // the check recovered
  })

  it('pluginVersion() reads the package.json that ships beside lib/', () => {
    expect(pluginVersion()).toBe(manifest.version)
  })
})

describe('POST /api/tako.update', () => {
  it('skips when already up to date and does not install', async () => {
    const runUpgrade = vi.fn()
    const pluginManager = { installBundle: vi.fn() }
    const { svc } = service({
      currentVersion: '0.4.0',
      registry: registryFetch({ latest: '0.4.0' }),
      runUpgrade,
      pluginManager: () => pluginManager,
    })
    const response = await svc.handleInstall()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, skipped: true, current: '0.4.0', latest: '0.4.0' })
    expect(runUpgrade).not.toHaveBeenCalled()
    expect(pluginManager.installBundle).not.toHaveBeenCalled()
  })

  it('skips with pendingRestart when the disk is already latest and the running copy is behind', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-tako-disk-'))
    const dir = join(root, 'profiles', 'web')
    mkdirSync(join(dir, 'node_modules', 'dsh-tako'), { recursive: true })
    writeFileSync(join(dir, 'node_modules', 'dsh-tako', 'package.json'), JSON.stringify({ name: 'dsh-tako', version: '0.4.0' }))
    const runUpgrade = vi.fn()
    const { svc } = service({
      registry: registryFetch({ latest: '0.4.0' }),
      profile: () => ({ name: 'web', dir }),
      runUpgrade,
    })
    const response = await svc.handleInstall()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      ok: true,
      skipped: true,
      current: '0.3.0',
      latest: '0.4.0',
      installed: '0.4.0',
      pendingRestart: true,
    })
    expect(runUpgrade).not.toHaveBeenCalled()
  })

  it('installs via pluginManager.installBundle with the official registry', async () => {
    const installBundle = vi.fn(async () => ({ application: 'restart-required', version: '0.4.0' }))
    const spawnAdd = vi.fn()
    const { svc } = service({
      registry: registryFetch({ latest: '0.4.0' }),
      pluginManager: () => ({ installBundle }),
      spawnAdd,
    })
    const response = await svc.handleInstall()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      ok: true,
      skipped: false,
      current: '0.3.0',
      latest: '0.4.0',
      installed: '0.4.0',
      application: 'restart-required',
      via: 'plugin-manager',
      pendingRestart: true,
    })
    expect(installBundle).toHaveBeenCalledExactlyOnceWith('dsh-tako@0.4.0', { registry: NPM_REGISTRY })
    expect(spawnAdd).not.toHaveBeenCalled()
  })

  it('spawns dsh plugin add when there is no pluginManager', async () => {
    const spawnAdd = vi.fn(async (_request: SpawnAddRequest) => ({ status: 0, stdout: '', stderr: '' }))
    const locateDsh = vi.fn(() => ({ packageJson: '/opt/dsh/package.json', version: '1.0.0' }))
    const { svc } = service({
      registry: registryFetch({ latest: '0.4.0' }),
      spawnAdd,
      locateDsh,
      execPath: '/usr/bin/node',
      profile: () => ({ name: 'web' }),
    })
    const response = await svc.handleInstall()
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, skipped: false, via: 'cli', installed: '0.4.0', pendingRestart: true })
    expect(spawnAdd).toHaveBeenCalledTimes(1)
    const spawned = spawnAdd.mock.calls.at(0)?.at(0)
    expect(spawned).toBeDefined()
    const args = spawned!.args.join(' ')
    expect(args).toContain('--registry=https://registry.npmjs.org/')
    expect(args).toContain('--config.minimum-release-age=0')
    expect(args).toContain('dsh-tako@0.4.0')
    expect(spawned!.args[0]).toBe('/opt/dsh/lib/bin.js')
  })

  it('does not install when the registry check failed', async () => {
    const runUpgrade = vi.fn()
    const { svc } = service({ registry: registryFetch({ fail: true }), runUpgrade })
    const response = await svc.handleInstall()
    expect(response.status).toBe(200)
    const body = await response.json() as Record<string, unknown>
    expect(body.current).toBe('0.3.0')
    expect(typeof body.error).toBe('string')
    expect(body.ok).toBeUndefined()
    expect(runUpgrade).not.toHaveBeenCalled()
  })

  it('rejects a second POST with 409 while an install is running', async () => {
    let started!: () => void
    const startedPromise = new Promise<void>(resolve => { started = resolve })
    let finish!: (result: UpgradeResult) => void
    const runUpgrade = vi.fn(() => {
      started()
      return new Promise<UpgradeResult>(resolve => { finish = resolve })
    })
    const { svc } = service({ registry: registryFetch({ latest: '0.4.0' }), runUpgrade })
    const first = svc.handleInstall()
    await startedPromise
    const second = await svc.handleInstall()
    expect(second.status).toBe(409)
    expect(await second.json()).toEqual({ error: 'install already running' })
    finish({ ok: true, via: 'plugin-manager', application: 'restart-required', installed: '0.4.0' })
    expect((await first).status).toBe(200)
  })

  it('returns the pluginManager error and does not fall back to spawn', async () => {
    const spawnAdd = vi.fn()
    const installBundle = vi.fn(async () => ({
      application: 'failed',
      error: { code: 'operation-error', diagnostic: 'pnpm exploded' },
      packageResult: { output: 'ignored output tail' },
    }))
    const { svc } = service({
      registry: registryFetch({ latest: '0.4.0' }),
      pluginManager: () => ({ installBundle }),
      spawnAdd,
    })
    const response = await svc.handleInstall()
    expect(response.status).toBe(200)
    const body = await response.json() as Record<string, unknown>
    expect(body).toMatchObject({ ok: false, current: '0.3.0', latest: '0.4.0' })
    expect(String(body.error)).toContain('pnpm exploded')
    expect(String(body.error)).not.toContain('[object Object]')
    expect(spawnAdd).not.toHaveBeenCalled()
  })

  it('retries spawn without minimum-release-age when the old pnpm rejects the flag', async () => {
    const spawnAdd = vi.fn(async (request: SpawnAddRequest) => {
      if (request.args.some(arg => arg.includes('minimum-release-age'))) {
        return { status: 1, stdout: '', stderr: 'Unknown option: --config.minimum-release-age' }
      }
      return { status: 0, stdout: 'added dsh-tako', stderr: '' }
    })
    const { svc } = service({
      registry: registryFetch({ latest: '0.4.0' }),
      spawnAdd,
      locateDsh: () => ({ packageJson: '/opt/dsh/package.json', version: '1.0.0' }),
      execPath: '/usr/bin/node',
    })
    const response = await svc.handleInstall()
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, via: 'cli', installed: '0.4.0' })
    expect(spawnAdd).toHaveBeenCalledTimes(2)
    const firstArgs = spawnAdd.mock.calls.at(0)?.at(0)?.args.join(' ') ?? ''
    const secondArgs = spawnAdd.mock.calls.at(1)?.at(0)?.args.join(' ') ?? ''
    expect(firstArgs).toContain('--config.minimum-release-age=0')
    expect(secondArgs).not.toContain('minimum-release-age')
  })
})

describe('profileFromPluginPath', () => {
  it('walks up from the plugin file to $DSH_HOME/profiles/<name>', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-tako-profile-'))
    const dir = join(root, 'profiles', 'web')
    const plugin = join(dir, 'node_modules', 'dsh-tako', 'lib')
    mkdirSync(plugin, { recursive: true })
    writeFileSync(join(dir, 'package.json'), '{}')
    writeFileSync(join(plugin, 'web.js'), '')
    expect(profileFromPluginPath(join(plugin, 'web.js'))).toEqual({ name: 'web', dir })
  })
})