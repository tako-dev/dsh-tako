#!/usr/bin/env node
/**
 * End-to-end test against a clean install of the official dsh.
 *
 * It packs this repository, installs `@deepseek-ai/dsh` into a temporary
 * directory, points every DSH_HOME (and HOME) at temporary directories, starts
 * a mock Tako, installs the tarball with `dsh plugin --profile <p> add`, and
 * boots real profiles: `web` for the settings behavior and `acp` (Agent
 * Client Protocol over stdio) for the model list and a real chat turn, then
 * signs in with `dsh-tako login` and the Web route against the mock's
 * `/app/authorize` + `/api/desktop/token`.
 *
 * Environment:
 *   DSH_VERSION   dsh version to install (default 0.2.1-rc.2)
 *   E2E_TGZ       use this tarball instead of building and packing
 *   E2E_DSH_DIR   reuse a directory where @deepseek-ai/dsh is already installed
 *   E2E_KEEP=1    keep the dsh install too (the DSH homes and report are always kept)
 *   E2E_ONLY      comma-separated case ids to run (a,b,c,...)
 */
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath, pathToFileURL } from 'node:url'
import YAML from 'yaml'
import { REPLY, startMockTako } from './mock-tako.mjs'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const fixture = join(repo, 'tests/fixtures/pricing-2026-10-25.json')
const DSH_VERSION = process.env.DSH_VERSION || '0.2.1-rc.2'
const API_KEY = 'test-key'
const only = new Set((process.env.E2E_ONLY ?? '').split(',').map(s => s.trim()).filter(Boolean))

const work = mkdtempSync(join(tmpdir(), 'dsh-tako-e2e-'))
console.log(`[e2e] work dir: ${work}`)

/** @type {{ id: string, title: string, status: 'PASS' | 'FAIL' | 'SKIP', detail: string[] }[]} */
const results = []
/** @type {Set<import('node:child_process').ChildProcess>} */
const children = new Set()
const cleanups = []
// Never leave a dsh process behind, whatever ends this script.
const killAll = () => { for (const child of children) { try { process.kill(-child.pid, 'SIGKILL') } catch { try { child.kill('SIGKILL') } catch {} } } }
process.on('exit', killAll)
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { killAll(); process.exit(130) })

// ---------------------------------------------------------------- helpers

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const sha256 = path => createHash('sha256').update(readFileSync(path)).digest('hex')

async function waitFor(predicate, ms, label) {
  const deadline = Date.now() + ms
  for (;;) {
    const value = await predicate()
    if (value) return value
    if (Date.now() > deadline) throw new Error(`timed out after ${ms}ms waiting for ${label}`)
    await sleep(200)
  }
}

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 << 20, ...options })
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} exited ${result.status}\n${result.stdout ?? ''}\n${result.stderr ?? ''}`)
  }
  return result
}

/** Inherited environment without anything that could reach a real account or proxy. */
function cleanEnv() {
  const env = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(DSH_|TAKO_|DEEPSEEK_|OPENAI_|ANTHROPIC_|XDG_|npm_)/i.test(key)) continue
    if (/^(http_proxy|https_proxy|all_proxy|no_proxy)$/i.test(key)) continue
    env[key] = value
  }
  // HOME is replaced per scenario; keep a corepack-managed pnpm on the
  // version and cache it already resolved to instead of downloading anew.
  const corepackHome = process.env.COREPACK_HOME
    ?? join(process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), 'node/corepack')
  if (existsSync(corepackHome)) env.COREPACK_HOME = corepackHome
  env.COREPACK_ENABLE_DOWNLOAD_PROMPT = '0'
  env.NO_PROXY = '127.0.0.1,localhost'
  env.no_proxy = '127.0.0.1,localhost'
  return env
}

function check(detail, condition, message) {
  detail.push(`${condition ? 'ok  ' : 'FAIL'} ${message}`)
  return condition
}

async function testCase(id, title, body) {
  if (only.size > 0 && !only.has(id)) {
    results.push({ id, title, status: 'SKIP', detail: ['not selected by E2E_ONLY'] })
    return
  }
  const detail = []
  const started = Date.now()
  console.log(`\n[e2e] --- ${id}. ${title}`)
  let ok
  try {
    ok = (await body(detail)) !== false && !detail.some(line => line.startsWith('FAIL'))
  } catch (error) {
    detail.push(`FAIL threw: ${error instanceof Error ? error.stack ?? error.message : String(error)}`)
    ok = false
  }
  for (const line of detail) console.log(`  ${line}`)
  const status = ok ? 'PASS' : 'FAIL'
  console.log(`[e2e] ${status} ${id}. ${title} (${((Date.now() - started) / 1000).toFixed(1)}s)`)
  results.push({ id, title, status, detail })
}

// ---------------------------------------------------------------- setup

const mock = await startMockTako({ pricingFile: fixture })
cleanups.push(() => mock.close())
console.log(`[e2e] mock Tako: ${mock.origin}`)

let dshDir = process.env.E2E_DSH_DIR
if (dshDir) {
  dshDir = resolve(dshDir)
  console.log(`[e2e] reusing dsh install in ${dshDir}`)
} else {
  dshDir = join(work, 'dsh-install')
  mkdirSync(dshDir, { recursive: true })
  writeFileSync(join(dshDir, 'package.json'), JSON.stringify({ name: 'dsh-e2e-install', private: true }))
  console.log(`[e2e] installing @deepseek-ai/dsh@${DSH_VERSION} into ${dshDir} ...`)
  run('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error', `@deepseek-ai/dsh@${DSH_VERSION}`], { cwd: dshDir, stdio: 'inherit' })
  if (process.env.E2E_KEEP !== '1') cleanups.push(() => rmSync(dshDir, { recursive: true, force: true }))
}
const dshBin = join(dshDir, 'node_modules/@deepseek-ai/dsh/lib/bin.js')
if (!existsSync(dshBin)) throw new Error(`dsh binary not found at ${dshBin}`)
const installedVersion = JSON.parse(readFileSync(join(dshDir, 'node_modules/@deepseek-ai/dsh/package.json'), 'utf8')).version
console.log(`[e2e] dsh ${installedVersion}; pnpm ${spawnSync('pnpm', ['--version'], { encoding: 'utf8' }).stdout?.trim() || 'NOT FOUND (dsh plugin needs pnpm on PATH)'}`)

let tgzSource = process.env.E2E_TGZ ? resolve(process.env.E2E_TGZ) : undefined
if (tgzSource === undefined) {
  console.log('[e2e] building and packing the plugin ...')
  run('npm', ['run', 'build'], { cwd: repo, stdio: 'inherit' })
  const packed = run('npm', ['pack', '--json', '--pack-destination', work], { cwd: repo })
  tgzSource = join(work, JSON.parse(packed.stdout)[0].filename)
}
const tgz = join(work, basename(tgzSource))
if (tgzSource !== tgz) copyFileSync(tgzSource, tgz)
console.log(`[e2e] plugin tarball: ${tgz}`)

/** The installed plugin's own catalog code, so expectations follow the packed build. */
async function expectedModels(options = {}) {
  const extract = join(work, 'tgz-extract')
  if (!existsSync(extract)) {
    mkdirSync(extract)
    run('tar', ['-xzf', tgz, '-C', extract])
  }
  // catalog.js is the pure mapping (no peer dependency to resolve).
  const { buildCatalog } = await import(pathToFileURL(join(extract, 'package/lib/catalog.js')).href)
  const directory = JSON.parse(readFileSync(fixture, 'utf8'))
  return buildCatalog(directory.data, {
    include: [],
    exclude: options.exclude ?? [],
    pinned: options.pinned ?? ['deepseek-v4.1-flash', 'deepseek-v4-pro', 'tako-auto'],
    includeClaudeCodeOnly: false,
    overrides: {},
  })
}

// ---------------------------------------------------------------- dsh driving

let homeCounter = 0
/** A fresh DSH_HOME (and OS HOME) for one scenario. */
function newHome(label) {
  const root = join(work, `${String(++homeCounter).padStart(2, '0')}-${label}`)
  const env = {
    ...cleanEnv(),
    HOME: join(root, 'os-home'),
    DSH_HOME: join(root, 'dsh-home'),
    DSH_AGENTS_HOME: join(root, 'agents-home'),
  }
  for (const dir of [env.HOME, env.DSH_HOME, env.DSH_AGENTS_HOME, join(root, 'cwd')]) mkdirSync(dir, { recursive: true })
  return {
    root,
    env,
    cwd: join(root, 'cwd'),
    profileDir: profile => join(env.DSH_HOME, 'profiles', profile),
    patchFile: profile => join(env.DSH_HOME, 'profiles', profile, 'cordis.patch.yml'),
  }
}

/** Run one dsh command to completion without blocking the event loop (the mocks live in this process). */
function dshRun(home, args, extraEnv = {}) {
  const handle = spawnDsh(home, args, extraEnv)
  handle.child.stdout.on('data', chunk => { handle.log.stdout += chunk })
  const timer = setTimeout(() => { void stopChild(handle) }, 180_000)
  return handle.exited.then(({ code }) => {
    clearTimeout(timer)
    return { code, stdout: handle.log.stdout, stderr: handle.log.stderr }
  })
}

async function pluginCmd(home, profile, ...args) {
  const result = await dshRun(home, ['plugin', '--profile', profile, ...args])
  if (result.code !== 0) throw new Error(`dsh plugin ${args.join(' ')} failed (${result.code}):\n${result.stdout}\n${result.stderr}`)
  return result
}

function readPatch(home, profile) {
  const file = home.patchFile(profile)
  if (!existsSync(file)) return []
  return YAML.parse(readFileSync(file, 'utf8')) ?? []
}

function writePatch(home, profile, entries) {
  writeFileSync(home.patchFile(profile), YAML.stringify(entries))
}

function takoRoute(home, profile) {
  for (const entry of readPatch(home, profile)) {
    if (entry?.id === 'llm-pi-ai') return entry.config?.providers?.tako
  }
  return undefined
}

/** Set the plugin's own config row (`id: tako`) in the profile patch. */
function setPluginConfig(home, profile, config) {
  const entries = readPatch(home, profile).filter(entry => entry?.id !== 'tako')
  writePatch(home, profile, [{ id: 'tako', config }, ...entries])
}

function spawnDsh(home, args, extraEnv = {}, stdio = ['ignore', 'pipe', 'pipe']) {
  const child = spawn(process.execPath, [dshBin, ...args], {
    cwd: home.cwd,
    env: { ...home.env, ...extraEnv },
    stdio,
    detached: process.platform !== 'win32',
  })
  children.add(child)
  const log = { stdout: '', stderr: '' }
  child.stdout?.setEncoding('utf8')
  child.stderr?.on('data', chunk => { log.stderr += chunk })
  const exited = new Promise(resolve => child.on('exit', (code, signal) => { children.delete(child); resolve({ code, signal }) }))
  return { child, log, exited }
}

async function stopChild(handle) {
  const { child, exited } = handle
  if (child.exitCode !== null || child.signalCode !== null) return exited
  const kill = signal => { try { process.kill(-child.pid, signal) } catch { try { child.kill(signal) } catch {} } }
  kill('SIGTERM')
  const timer = setTimeout(() => kill('SIGKILL'), 8000)
  const status = await exited
  clearTimeout(timer)
  return status
}

/**
 * Boot `dsh web`, wait for it to serve, then wait until the plugin's startup
 * sync has happened (`until`, or a fixed settle after the first directory fetch).
 */
async function bootWeb(home, { until, settleMs = 5000, extraEnv = {}, expectPricingFetch = true } = {}) {
  const pricingBefore = mock.pricingRequests().length
  const handle = spawnDsh(home, ['web', '--no-open', '--port', '0', '--host', '127.0.0.1'], extraEnv)
  handle.child.stdout.on('data', chunk => { handle.log.stdout += chunk })
  try {
    const url = await waitFor(() => /dsh web: (http\S+)/.exec(handle.log.stdout)?.[1], 90_000, 'dsh web to print its URL')
    if (expectPricingFetch) await waitFor(() => mock.pricingRequests().length > pricingBefore, 30_000, 'the plugin to fetch /api/pricing')
    if (until !== undefined) await waitFor(until, 30_000, 'the expected profile state')
    else await sleep(settleMs)
    return { url, pricingFetches: mock.pricingRequests().length - pricingBefore, log: handle.log }
  } catch (error) {
    throw new Error(`${error.message}\n--- dsh web stdout:\n${handle.log.stdout}\n--- stderr:\n${handle.log.stderr}`)
  } finally {
    await stopChild(handle)
  }
}

/** Newline-delimited JSON-RPC client for `dsh acp`. */
function startAcp(home, extraEnv) {
  const handle = spawnDsh(home, ['acp'], extraEnv, ['pipe', 'pipe', 'pipe'])
  const lines = createInterface({ input: handle.child.stdout })
  const pending = new Map()
  const notifications = []
  let nextId = 0
  lines.on('line', line => {
    let message
    try { message = JSON.parse(line) } catch { return }
    if (message.method !== undefined) {
      notifications.push(message)
      // Agent-to-client requests (permissions, fs) are refused; the e2e prompt needs none.
      if (message.id !== undefined) handle.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'not supported by the e2e client' } }) + '\n')
      return
    }
    const waiter = pending.get(message.id)
    if (waiter !== undefined) { pending.delete(message.id); waiter(message) }
  })
  const call = (method, params, ms = 60_000) => new Promise((resolve, reject) => {
    const id = ++nextId
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`ACP ${method} timed out\n--- stderr:\n${handle.log.stderr}`)) }, ms)
    pending.set(id, message => {
      clearTimeout(timer)
      if (message.error !== undefined) reject(new Error(`ACP ${method} failed: ${JSON.stringify(message.error)}`))
      else resolve(message.result)
    })
    handle.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
  })
  return { call, notifications, stop: () => stopChild(handle), log: handle.log }
}

function modelOption(result) {
  return result.configOptions?.find(option => option.id === 'model')
}
function takoGroup(result) {
  return modelOption(result)?.options?.find(group => group.group === 'tako')
}

// ---------------------------------------------------------------- cases

mock.state.pricingStatus = 200
const main = newHome('web-main')
const pluginConfig = { baseURL: mock.origin }
let mainHashAfterBoot

await testCase('a', 'web profile: install the tarball, boot, providers.tako written from the directory', async detail => {
  const added = await pluginCmd(main, 'web', 'add', tgz)
  check(detail, /dsh-tako/.test(added.stdout), `dsh plugin --profile web add ${basename(tgz)} succeeded`)
  const manifest = JSON.parse(readFileSync(join(main.profileDir('web'), 'package.json'), 'utf8'))
  check(detail, manifest.dsh?.profile?.bundles?.includes('dsh-tako'), `profile bundles: ${JSON.stringify(manifest.dsh?.profile?.bundles)}`)
  setPluginConfig(main, 'web', pluginConfig)
  const boot = await bootWeb(main, { until: () => takoRoute(main, 'web') !== undefined })
  await sleep(3000) // let any follow-up write land before reading
  detail.push(`info dsh web served at ${boot.url.replace(/token=[^&]+/, 'token=<redacted>')}; /api/pricing fetched ${boot.pricingFetches}x during boot`)
  const route = takoRoute(main, 'web')
  const expected = await expectedModels()
  check(detail, route !== undefined, 'providers.tako present in profiles/web/cordis.patch.yml')
  check(detail, route?.displayName === 'Tako' && route?.api === 'openai-completions', `displayName=${route?.displayName} api=${route?.api}`)
  check(detail, route?.baseURL === `${mock.origin}/v1`, `baseURL=${route?.baseURL}`)
  check(detail, route?.apiKeyEnv === 'TAKO_API_KEY', `apiKeyEnv=${route?.apiKeyEnv}`)
  const ids = (route?.models ?? []).map(model => model.id)
  check(detail, ids.length === expected.length && expected.length === 35, `model count ${ids.length} (expected ${expected.length}, fixture filtered = 35)`)
  check(detail, JSON.stringify(ids) === JSON.stringify(expected.map(model => model.id)), 'model ids and order equal buildCatalog(fixture) of the packed build')
  check(detail, JSON.stringify(ids.slice(0, 3)) === JSON.stringify(['deepseek-v4.1-flash', 'deepseek-v4-pro', 'tako-auto']), `pinned first: ${ids.slice(0, 3).join(', ')}`)
  const byId = Object.fromEntries((route?.models ?? []).map(model => [model.id, model]))
  const flash = byId['deepseek-v4.1-flash']
  check(detail, flash?.contextWindow === 1_000_000 && JSON.stringify(flash?.input) === '["text","image"]', `deepseek-v4.1-flash ${JSON.stringify(flash)}`)
  check(detail, byId['gpt-6-sol']?.contextWindow === 1_050_000, `gpt-6-sol contextWindow=${byId['gpt-6-sol']?.contextWindow}`)
  check(detail, byId['gpt-5.6-luna']?.contextWindow === 272_000, `gpt-5.6-luna contextWindow=${byId['gpt-5.6-luna']?.contextWindow}`)
  check(detail, byId['tako-auto']?.contextWindow === undefined, 'tako-auto has no contextWindow (uses defaultContextWindow 128000)')
  check(detail, !ids.some(id => id.startsWith('jev-') || id === 'claude-opus-5-5'), 'no jev-* or Claude-Code-only models')
  check(detail, readPatch(main, 'web').some(entry => entry?.id === 'tako' && entry.config?.baseURL === mock.origin), 'plugin config row kept in the patch')
  mainHashAfterBoot = sha256(main.patchFile('web'))
  detail.push(`info patch sha256 ${mainHashAfterBoot}`)
})

await testCase('b', 'restart: profile file unchanged (no rewrite)', async detail => {
  if (mainHashAfterBoot === undefined) throw new Error('case a did not leave a route')
  const before = sha256(main.patchFile('web'))
  const mtime = statSync(main.patchFile('web')).mtimeMs
  const boot = await bootWeb(main, { settleMs: 6000 })
  detail.push(`info /api/pricing fetched ${boot.pricingFetches}x during the restart`)
  const after = sha256(main.patchFile('web'))
  check(detail, before === after, `sha256 before=${before.slice(0, 16)} after=${after.slice(0, 16)}`)
  check(detail, statSync(main.patchFile('web')).mtimeMs === mtime, 'mtime unchanged')
})

const acpHome = newHome('acp')
await testCase('c', 'acp profile: with TAKO_API_KEY=test-key dsh lists the Tako models; without a key it does not', async detail => {
  await pluginCmd(acpHome, 'acp', 'add', tgz)
  setPluginConfig(acpHome, 'acp', pluginConfig)
  // First boot writes the route; the model list is read by ACP session/new.
  const acp = startAcp(acpHome, { TAKO_API_KEY: API_KEY })
  try {
    await acp.call('initialize', { protocolVersion: 1, clientCapabilities: {} })
    await waitFor(() => takoRoute(acpHome, 'acp') !== undefined, 30_000, 'providers.tako in profiles/acp')
    const session = await waitFor(async () => {
      const result = await acp.call('session/new', { cwd: acpHome.cwd, mcpServers: [] })
      return takoGroup(result) !== undefined ? result : undefined
    }, 30_000, 'a Tako group in the ACP model option')
    const group = takoGroup(session)
    const expected = await expectedModels()
    const listed = group.options.map(option => JSON.parse(option.value))
    check(detail, group.name === 'Tako', `group "${group.group}" named "${group.name}"`)
    check(detail, listed.every(([provider]) => provider === 'tako'), 'every option routes to provider tako')
    check(detail, JSON.stringify(listed.map(([, model]) => model)) === JSON.stringify(expected.map(model => model.id)), `${listed.length} Tako models listed in catalog order`)
  } finally {
    await acp.stop()
  }
  const noKey = startAcp(acpHome, {})
  try {
    await noKey.call('initialize', { protocolVersion: 1, clientCapabilities: {} })
    await sleep(2000)
    const result = await noKey.call('session/new', { cwd: acpHome.cwd, mcpServers: [] })
    const groups = modelOption(result)?.options?.map(group => `${group.group}(${group.options.length})`) ?? []
    check(detail, takoGroup(result) === undefined, `without a key the Tako group is absent; groups: ${groups.join(', ') || 'none'}`)
  } finally {
    await noKey.stop()
  }
})

/** Evidence for the report. */
let chatEvidence
await testCase('d', 'real chat turn through dsh acp -> pi-ai -> mock /v1/chat/completions', async detail => {
  if (takoRoute(acpHome, 'acp') === undefined) throw new Error('case c did not write the route')
  const chatBefore = mock.chatRequests().length
  const acp = startAcp(acpHome, { TAKO_API_KEY: API_KEY })
  try {
    await acp.call('initialize', { protocolVersion: 1, clientCapabilities: {} })
    const session = await waitFor(async () => {
      const result = await acp.call('session/new', { cwd: acpHome.cwd, mcpServers: [] })
      return takoGroup(result) !== undefined ? result : undefined
    }, 30_000, 'a Tako group in the ACP model option')
    const value = JSON.stringify(['tako', 'deepseek-v4.1-flash'])
    const set = await acp.call('session/set_config_option', { sessionId: session.sessionId, configId: 'model', value })
    check(detail, modelOption(set)?.currentValue === value, `model selected: ${modelOption(set)?.currentValue}`)
    const prompt = await acp.call('session/prompt', { sessionId: session.sessionId, prompt: [{ type: 'text', text: 'Reply with the fixed e2e text.' }] }, 120_000)
    const text = acp.notifications
      .filter(message => message.method === 'session/update' && message.params?.sessionId === session.sessionId && message.params.update?.sessionUpdate === 'agent_message_chunk')
      .map(message => message.params.update.content?.text ?? '')
      .join('')
    const usage = acp.notifications.find(message => message.params?.update?.sessionUpdate === 'usage_update')?.params.update
    const requests = mock.chatRequests().slice(chatBefore)
    chatEvidence = { stopReason: prompt.stopReason, reply: text, usage, requests }
    check(detail, prompt.stopReason === 'end_turn', `stopReason=${prompt.stopReason}`)
    check(detail, text === REPLY, `dsh reply text: ${JSON.stringify(text)}`)
    check(detail, requests.length >= 1, `mock received ${requests.length} chat request(s)`)
    for (const request of requests) {
      check(detail, request.authorization === `Bearer ${API_KEY}`, `Authorization: ${request.authorization}`)
      check(detail, request.model === 'deepseek-v4.1-flash', `model: ${request.model}, stream: ${request.stream}`)
    }
    if (usage !== undefined) check(detail, usage.size === 1_000_000, `usage_update.size=${usage.size} (dsh uses the 1M context window from the route)`)
  } finally {
    await acp.stop()
  }
})

await testCase('e', 'directory unreachable (HTTP 500): fallback seeded when absent, existing list kept', async detail => {
  const home = newHome('web-fallback')
  await pluginCmd(home, 'web', 'add', tgz)
  setPluginConfig(home, 'web', pluginConfig)
  mock.state.pricingStatus = 500
  try {
    await bootWeb(home, { until: () => takoRoute(home, 'web') !== undefined })
    const route = takoRoute(home, 'web')
    const ids = (route?.models ?? []).map(model => model.id)
    check(detail, JSON.stringify(ids) === '["deepseek-v4.1-flash","deepseek-v4-pro"]', `no route + 500 -> fallback models ${JSON.stringify(ids)}`)
    // Existing route (the full list from case a), directory still down.
    const fullRoute = takoRoute(main, 'web')
    if (fullRoute === undefined) throw new Error('case a did not leave a full route to copy')
    const entries = readPatch(home, 'web').map(entry => entry?.id === 'llm-pi-ai' ? { ...entry, config: { ...entry.config, providers: { ...entry.config.providers, tako: fullRoute } } } : entry)
    writePatch(home, 'web', entries)
    const before = sha256(home.patchFile('web'))
    await bootWeb(home, { settleMs: 6000 })
    const after = takoRoute(home, 'web')
    check(detail, sha256(home.patchFile('web')) === before, 'existing route + 500 -> patch file byte-identical')
    check(detail, (after?.models ?? []).length === 35, `existing list kept: ${(after?.models ?? []).length} models`)
  } finally {
    mock.state.pricingStatus = 200
  }
})

await testCase('f', 'plugin config exclude / pinned take effect', async detail => {
  const pinned = ['gpt-5.6', 'kimi-k3', 'deepseek-v4.1-flash']
  const exclude = ['grok-*', 'mimo-*']
  setPluginConfig(main, 'web', { ...pluginConfig, pinned, exclude })
  const before = JSON.stringify(takoRoute(main, 'web'))
  await bootWeb(main, { until: () => JSON.stringify(takoRoute(main, 'web')) !== before })
  await sleep(2000)
  const ids = (takoRoute(main, 'web')?.models ?? []).map(model => model.id)
  const expected = (await expectedModels({ pinned, exclude })).map(model => model.id)
  check(detail, JSON.stringify(ids.slice(0, 3)) === JSON.stringify(pinned), `first three: ${ids.slice(0, 3).join(', ')}`)
  check(detail, !ids.some(id => id.startsWith('grok-') || id.startsWith('mimo-')), 'no grok-* / mimo-* models')
  check(detail, JSON.stringify(ids) === JSON.stringify(expected), `${ids.length} models, equal to buildCatalog with the same options`)
  // Restore the default config for the following cases.
  setPluginConfig(main, 'web', pluginConfig)
  await bootWeb(main, { until: () => (takoRoute(main, 'web')?.models ?? []).length === 35 })
  check(detail, takoRoute(main, 'web')?.models?.[0]?.id === 'deepseek-v4.1-flash', 'default config restored, route rewritten back')
})

/** Behavior notes for the report. */
const notes = {}
await testCase('g', 'user deletes providers.tako, then restarts (documented: plugin writes it back)', async detail => {
  // What the Models page "delete" amounts to: the route is gone from the
  // pi-ai settings layer. Simulated by editing the patch file while dsh is down.
  const entries = readPatch(main, 'web').map(entry => {
    if (entry?.id !== 'llm-pi-ai') return entry
    const { tako: _removed, ...providers } = entry.config.providers
    return { ...entry, config: { ...entry.config, providers } }
  })
  writePatch(main, 'web', entries)
  check(detail, takoRoute(main, 'web') === undefined, 'route removed from profiles/web/cordis.patch.yml')
  let readded = false
  try {
    await bootWeb(main, { until: () => takoRoute(main, 'web') !== undefined })
    readded = true
  } catch (error) {
    detail.push(`info ${error.message.split('\n')[0]}`)
  }
  const count = (takoRoute(main, 'web')?.models ?? []).length
  notes.g = readded ? `re-added on restart with ${count} models` : 'not re-added within 30s'
  check(detail, readded && count === 35, `after restart: ${notes.g}`)
})

await testCase('h', 'dsh plugin remove: boot still works, route stays as a static custom provider', async detail => {
  await pluginCmd(main, 'web', 'remove', 'dsh-tako')
  const manifest = JSON.parse(readFileSync(join(main.profileDir('web'), 'package.json'), 'utf8'))
  check(detail, !(manifest.dsh?.profile?.bundles ?? []).includes('dsh-tako') && manifest.dependencies?.['dsh-tako'] === undefined, `bundles after remove: ${JSON.stringify(manifest.dsh?.profile?.bundles)}`)
  check(detail, !existsSync(join(main.profileDir('web'), 'node_modules/dsh-tako')), 'package removed from the profile node_modules')
  const hashBefore = sha256(main.patchFile('web'))
  const pricingBefore = mock.pricingRequests().length
  const boot = await bootWeb(main, { expectPricingFetch: false, settleMs: 6000 })
  check(detail, true, `dsh web still boots (${boot.url.replace(/\?.*/, '')})`)
  const route = takoRoute(main, 'web')
  const orphan = readPatch(main, 'web').some(entry => entry?.id === 'tako')
  check(detail, (route?.models ?? []).length === 35, `providers.tako left in the patch with ${(route?.models ?? []).length} models`)
  check(detail, mock.pricingRequests().length === pricingBefore, 'directory no longer fetched')
  check(detail, sha256(main.patchFile('web')) === hashBefore, 'patch file untouched by the boot')
  notes.h = `remove drops the package and bundle; providers.tako (${(route?.models ?? []).length} models) and the orphan "- id: tako" config row stay in cordis.patch.yml (orphan row present: ${orphan}); dsh web boots without error${boot.log.stderr.trim() ? `; stderr: ${boot.log.stderr.trim().slice(0, 300)}` : ' and prints nothing on stderr'}`
  detail.push(`info ${notes.h}`)
})

await testCase('i', 'dsh plugin add <http URL to the tgz> (GitHub Release style install)', async detail => {
  const server = createServer((req, res) => {
    const name = basename(tgz)
    if (req.url !== `/${name}`) { res.writeHead(404).end(); return }
    res.writeHead(200, { 'content-type': 'application/gzip', 'content-length': statSync(tgz).size })
    createReadStream(tgz).pipe(res)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const url = `http://127.0.0.1:${server.address().port}/${basename(tgz)}`
    const home = newHome('web-http-url')
    const added = await dshRun(home, ['plugin', '--profile', 'web', 'add', url])
    check(detail, added.code === 0, `dsh plugin --profile web add ${url} -> exit ${added.code}`)
    if (added.code !== 0) { detail.push(`info ${(added.stdout + added.stderr).trim().slice(-800)}`); notes.i = 'install from URL failed'; return }
    const manifest = JSON.parse(readFileSync(join(home.profileDir('web'), 'package.json'), 'utf8'))
    detail.push(`info package.json dependency: dsh-tako -> ${manifest.dependencies?.['dsh-tako']}`)
    check(detail, manifest.dsh?.profile?.bundles?.includes('dsh-tako'), 'registered as a profile bundle')
    setPluginConfig(home, 'web', pluginConfig)
    await bootWeb(home, { until: () => takoRoute(home, 'web') !== undefined })
    check(detail, (takoRoute(home, 'web')?.models ?? []).length === 35, 'route written after boot')
    notes.i = `works; package.json records "${manifest.dependencies?.['dsh-tako']}"`
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})

// ---------------------------------------------------------------- browser sign-in

/** Install the packed tarball the way `npx dsh-tako` would, outside any profile. */
let cliBin
function installCli() {
  if (cliBin !== undefined) return cliBin
  const dir = join(work, 'cli-install')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'dsh-tako-cli-e2e', private: true }))
  // The CLI needs no peer; skip resolving the plugin's schemastery peer.
  run('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error', '--legacy-peer-deps', tgz], { cwd: dir })
  cliBin = join(dir, 'node_modules/.bin/dsh-tako')
  if (!existsSync(cliBin)) throw new Error(`dsh-tako bin not installed at ${cliBin}`)
  return cliBin
}

/** dsh on PATH exactly as a global install puts it, so the CLI finds it by itself. */
const pathWithDsh = home => ({ PATH: `${join(dshDir, 'node_modules/.bin')}${process.platform === 'win32' ? ';' : ':'}${home.env.PATH ?? ''}` })

/** Run `dsh-tako <args>`; `onUrl` receives the printed authorize URL (the "browser"). */
function cli(home, args, { onUrl, extraEnv = {} } = {}) {
  const child = spawn(installCli(), args, { cwd: home.cwd, env: { ...home.env, ...pathWithDsh(home), ...extraEnv }, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' })
  children.add(child)
  let stdout = ''
  let stderr = ''
  let browser
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', chunk => {
    stdout += chunk
    const url = /(http:\/\/\S+\/app\/authorize\?\S+)/.exec(stdout)?.[1]
    if (url !== undefined && browser === undefined && onUrl !== undefined) browser = onUrl(url)
  })
  child.stderr.on('data', chunk => { stderr += chunk })
  const timer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL') } catch {} }, 120_000)
  return new Promise(resolve => child.on('exit', async code => {
    clearTimeout(timer)
    children.delete(child)
    resolve({ code, stdout, stderr, browser: await browser })
  }))
}

/** What a browser does with the authorize URL when the user already confirmed: follow the 302 to the loopback callback. */
async function browse(url) {
  const response = await fetch(url, { redirect: 'follow' })
  return { status: response.status, url: response.url, body: await response.text() }
}

function storedRefs(home) {
  const file = join(home.env.DSH_HOME, '.credentials.yaml')
  if (!existsSync(file)) return { refs: {}, mode: undefined }
  return { refs: YAML.parse(readFileSync(file, 'utf8'))?.refs ?? {}, mode: statSync(file).mode & 0o777 }
}

/** One chat turn through `dsh acp`; returns the mock's chat requests for it. */
async function chatTurn(home, extraEnv) {
  const before = mock.chatRequests().length
  const acp = startAcp(home, extraEnv)
  try {
    await acp.call('initialize', { protocolVersion: 1, clientCapabilities: {} })
    const session = await waitFor(async () => {
      const result = await acp.call('session/new', { cwd: home.cwd, mcpServers: [] })
      return takoGroup(result) !== undefined ? result : undefined
    }, 30_000, 'a Tako group in the ACP model option')
    await acp.call('session/set_config_option', { sessionId: session.sessionId, configId: 'model', value: JSON.stringify(['tako', 'deepseek-v4.1-flash']) })
    const prompt = await acp.call('session/prompt', { sessionId: session.sessionId, prompt: [{ type: 'text', text: 'Reply with the fixed e2e text.' }] }, 120_000)
    return { stopReason: prompt.stopReason, requests: mock.chatRequests().slice(before) }
  } finally {
    await acp.stop()
  }
}

let loginKey
const loginHome = newHome('cli-login')
await testCase('j', 'dsh-tako login --no-open: PKCE loopback sign-in stores the key via dsh credentials, dsh acp uses it', async detail => {
  await pluginCmd(loginHome, 'acp', 'add', tgz)
  setPluginConfig(loginHome, 'acp', pluginConfig)
  const exchangesBefore = mock.state.tokenExchanges.length
  const result = await cli(loginHome, ['login', '--no-open', '--profile', 'acp'], { onUrl: browse })
  const exchanges = mock.state.tokenExchanges.slice(exchangesBefore)
  loginKey = exchanges.find(entry => entry.ok)?.key
  const authorize = new URL(/(http:\/\/\S+\/app\/authorize\?\S+)/.exec(result.stdout)?.[1] ?? 'http://invalid/')
  check(detail, result.code === 0, `dsh-tako login exited ${result.code}${result.code !== 0 ? `: ${result.stderr.trim()}` : ''}`)
  check(detail, authorize.origin === mock.origin && authorize.searchParams.get('client_id') === 'tako-connect' && authorize.searchParams.get('code_challenge_method') === 'S256', `authorize URL from the profile config: ${authorize.origin}${authorize.pathname} client_id=${authorize.searchParams.get('client_id')}`)
  check(detail, /^http:\/\/127\.0\.0\.1:\d+\/tako\/callback$/.test(authorize.searchParams.get('redirect_uri') ?? ''), `redirect_uri ${authorize.searchParams.get('redirect_uri')}`)
  // Expected default from the packed build itself: dsh-tako@<short hostname>.
  const { defaultDeviceName } = await import(pathToFileURL(join(installCli(), '../../dsh-tako/lib/login.js')).href)
  const deviceName = authorize.searchParams.get('device_name')
  check(detail, deviceName === defaultDeviceName() && /^dsh-tako@[A-Za-z0-9._+-]+$/.test(deviceName) && deviceName.length <= 32, `device_name ${deviceName} (default dsh-tako@<hostname>)`)
  check(detail, result.browser?.status === 200 && result.browser.body.includes('登录成功'), `browser landed on the callback page: HTTP ${result.browser?.status}`)
  check(detail, exchanges.length === 1 && exchanges[0].ok && exchanges[0].body.client_id === 'tako-connect', `mock token endpoint: ${JSON.stringify(exchanges.map(entry => entry.ok ? 'ok (PKCE verifier matched the challenge)' : entry.reason))}`)
  check(detail, loginKey !== undefined && !result.stdout.includes(loginKey) && !result.stderr.includes(loginKey), 'the key never appears in the CLI output')
  check(detail, result.stdout.includes(`cr_****${loginKey?.slice(-4)}`), `CLI shows only cr_****${loginKey?.slice(-4)}`)
  const stored = storedRefs(loginHome)
  check(detail, stored.refs.TAKO_API_KEY === loginKey, '$DSH_HOME/.credentials.yaml refs.TAKO_API_KEY is the issued key')
  if (process.platform !== 'win32') check(detail, stored.mode === 0o600, `credentials file mode ${stored.mode?.toString(8)}`)
  // No TAKO_API_KEY in the environment: the only key is the stored one.
  const chat = await chatTurn(loginHome, {})
  check(detail, chat.stopReason === 'end_turn' && chat.requests.length >= 1, `dsh acp chat turn: stopReason=${chat.stopReason}, ${chat.requests.length} request(s)`)
  check(detail, chat.requests.every(request => request.authorization === `Bearer ${loginKey}`), `mock saw Authorization: Bearer cr_****${loginKey?.slice(-4)} (the new key)`)
})

await testCase('k', 'dsh-tako whoami / logout: /api/desktop/me, then revoke + credential removed', async detail => {
  if (loginKey === undefined) throw new Error('case j did not sign in')
  const who = await cli(loginHome, ['whoami', '--profile', 'acp'])
  check(detail, who.code === 0 && who.stdout.includes('e2e-user') && who.stdout.includes('E2E Plan'), `whoami exited ${who.code}: ${who.stdout.trim().split('\n').join(' | ')}`)
  check(detail, !who.stdout.includes(loginKey), 'whoami does not print the key')
  const out = await cli(loginHome, ['logout', '--profile', 'acp'])
  check(detail, out.code === 0, `logout exited ${out.code}: ${out.stdout.trim()}${out.stderr.trim()}`)
  check(detail, mock.state.revoked.includes(loginKey), 'mock /api/desktop/revoke received the key')
  check(detail, storedRefs(loginHome).refs.TAKO_API_KEY === undefined, 'TAKO_API_KEY removed from the credentials file')
  const after = await cli(loginHome, ['whoami', '--profile', 'acp'])
  check(detail, after.code === 1 && after.stderr.includes('dsh-tako login'), `whoami after logout exited ${after.code}: ${after.stderr.trim()}`)
})

await testCase('l', 'dsh-tako login when the user denies in the browser: exit 1, nothing stored', async detail => {
  mock.state.authorizeMode = 'deny'
  try {
    const result = await cli(loginHome, ['login', '--no-open', '--profile', 'acp'], { onUrl: browse })
    check(detail, result.code === 1 && /denied/.test(result.stderr), `exit ${result.code}: ${result.stderr.trim()}`)
    check(detail, result.browser?.body.includes('拒绝') === true, 'browser shows the denied page')
    check(detail, storedRefs(loginHome).refs.TAKO_API_KEY === undefined, 'no credential written')
  } finally {
    mock.state.authorizeMode = 'approve'
  }
})

await testCase('m', 'Web UI: client bundle served for the Models page; /api/tako.login signs in and stores the key', async detail => {
  const home = newHome('web-login')
  await pluginCmd(home, 'web', 'add', tgz)
  setPluginConfig(home, 'web', pluginConfig)
  const handle = spawnDsh(home, ['web', '--no-open', '--port', '0', '--host', '127.0.0.1'])
  handle.child.stdout.on('data', chunk => { handle.log.stdout += chunk })
  try {
    const url = await waitFor(() => /dsh web: (http\S+)/.exec(handle.log.stdout)?.[1], 90_000, 'dsh web to print its URL')
    await waitFor(() => takoRoute(home, 'web') !== undefined, 30_000, 'the Tako route')
    // Exchange the launch token for the browser session cookie, as the browser does.
    const first = await fetch(url, { redirect: 'manual' })
    const cookie = (first.headers.getSetCookie?.() ?? []).map(value => value.split(';')[0]).join('; ')
    const origin = new URL(url).origin
    const html = await (await fetch(`${origin}/`, { headers: { cookie } })).text()
    const bundle = /"id":"dsh-tako","url":"([^"]+)"/.exec(html)?.[1]
    check(detail, bundle !== undefined, `boot graph lists the dsh-tako client bundle: ${bundle}`)
    const script = bundle === undefined ? '' : await (await fetch(`${origin}/${bundle}`, { headers: { cookie } })).text()
    check(detail, script.includes("'settings.models.provider-card'") && script.includes("id: 'dsh-tako'"), `bundle (${script.length} bytes) registers the settings.models.provider-card slot`)
    check(detail, script.includes('dsh-tako-stamps') && script.includes('windowHours'), `bundle carries the plan-window stamps (dsh-tako-stamps, windowHours)`)
    const unauthenticated = await fetch(`${origin}/api/tako.login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    check(detail, unauthenticated.status === 401 || unauthenticated.status === 403, `route without the session cookie -> HTTP ${unauthenticated.status}`)
    const api = (method, body, query = '') => fetch(`${origin}/api/tako.login${query}`, { method, headers: { cookie, origin, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }).then(response => response.json())
    const started = await api('POST', { action: 'start' })
    check(detail, started.status === 'pending' && started.url?.startsWith(`${mock.origin}/app/authorize?`), `POST start -> ${started.status}, redirect_uri ${started.redirectUri}`)
    const landed = await browse(started.url)
    check(detail, landed.status === 200 && landed.body.includes('登录成功'), `browser landed on the callback: HTTP ${landed.status}`)
    const done = await waitFor(async () => { const status = await api('GET', undefined, `?id=${started.id}`); return status.status !== 'pending' ? status : undefined }, 20_000, 'the sign-in to finish')
    const key = mock.state.tokenExchanges.filter(entry => entry.ok).at(-1)?.key
    check(detail, done.status === 'success' && done.user === 'e2e-user' && done.key === `cr_****${key?.slice(-4)}`, `GET status -> ${JSON.stringify(done)}`)
    check(detail, !JSON.stringify(done).includes(key), 'status response carries only the masked key')
    check(detail, storedRefs(home).refs.TAKO_API_KEY === key, 'credentials file refs.TAKO_API_KEY is the issued key (written by ctx.credentials.set)')
  } finally {
    await stopChild(handle)
  }
})

await testCase('n', 'console routes: /api/tako.status + /api/tako.catalog + /api/tako.update + logout against the mock', async detail => {
  const home = newHome('web-console')
  await pluginCmd(home, 'web', 'add', tgz)
  setPluginConfig(home, 'web', pluginConfig)
  const handle = spawnDsh(home, ['web', '--no-open', '--port', '0', '--host', '127.0.0.1'])
  handle.child.stdout.on('data', chunk => { handle.log.stdout += chunk })
  try {
    const url = await waitFor(() => /dsh web: (http\S+)/.exec(handle.log.stdout)?.[1], 90_000, 'dsh web to print its URL')
    await waitFor(() => takoRoute(home, 'web') !== undefined, 30_000, 'the Tako route (first sync done)')
    // Exchange the launch token for the browser session cookie, as the browser does.
    const first = await fetch(url, { redirect: 'manual' })
    const cookie = (first.headers.getSetCookie?.() ?? []).map(value => value.split(';')[0]).join('; ')
    const origin = new URL(url).origin
    const headers = { cookie, origin, 'content-type': 'application/json' }
    const api = (method, path, body) => fetch(`${origin}/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }).then(response => response.json())
    const status0 = await api('GET', 'api/tako.status')
    check(detail, JSON.stringify(status0) === '{"configured":false}', `status without a key -> ${JSON.stringify(status0)}`)
    const catalog = await api('GET', 'api/tako.catalog')
    const expected = await expectedModels()
    check(detail, JSON.stringify(catalog.models.map(model => model.id)) === JSON.stringify(expected.map(model => model.id)), `catalog lists the ${catalog.models.length} synced models in catalog order`)
    check(detail, typeof catalog.lastSyncAt === 'number' && catalog.nextSyncAt - catalog.lastSyncAt === 30 * 60_000, `catalog lastSyncAt -> nextSyncAt = ${catalog.nextSyncAt - catalog.lastSyncAt}ms (refreshIntervalMs default)`)
    // Update route: the packed tarball's own version, then npm's verdict (or a graceful error when npm is unreachable).
    const packedVersion = JSON.parse(readFileSync(join(work, 'tgz-extract/package/package.json'), 'utf8')).version
    const upd = await api('GET', 'api/tako.update')
    check(detail, upd.current === packedVersion, `update current=${JSON.stringify(upd.current)} equals the packed version ${packedVersion}`)
    check(detail, (upd.upToDate === true && typeof upd.latest === 'string') || typeof upd.checkError === 'string', `update verdict -> ${JSON.stringify(upd)}`)
    const updAgain = await api('GET', 'api/tako.update')
    check(detail, JSON.stringify(updAgain) === JSON.stringify(upd), `a second update read answers the same -> ${JSON.stringify(updAgain)}`)
    if (upd.upToDate === true) {
      const posted = await api('POST', 'api/tako.update', {})
      check(detail, posted.ok === true && posted.skipped === true, `POST update when up to date skips -> ${JSON.stringify(posted)}`)
    } else if (typeof upd.checkError === 'string') {
      const postedRes = await fetch(`${origin}/api/tako.update`, { method: 'POST', headers, body: '{}' })
      let posted
      try { posted = await postedRes.json() } catch { posted = undefined }
      check(detail, postedRes.status !== 500 && posted !== undefined, `POST update after checkError -> HTTP ${postedRes.status} ${JSON.stringify(posted)}`)
    }
    // Sign in through the login route, then read the account back through the console status.
    const started = await api('POST', 'api/tako.login', { action: 'start' })
    check(detail, started.status === 'pending', `login start -> ${started.status}`)
    const landed = await browse(started.url)
    check(detail, landed.status === 200 && landed.body.includes('登录成功'), `browser landed on the callback: HTTP ${landed.status}`)
    const done = await waitFor(async () => { const status = await api('GET', `api/tako.login?id=${started.id}`); return status.status !== 'pending' ? status : undefined }, 20_000, 'the sign-in to finish')
    const key = mock.state.tokenExchanges.filter(entry => entry.ok).at(-1)?.key
    check(detail, done.status === 'success', `login -> ${done.status}`)
    const status1 = await api('GET', 'api/tako.status')
    check(detail, status1.configured === true && status1.maskedKey === `cr_****${key?.slice(-4)}` && status1.credential === 'TAKO_API_KEY', `status after sign-in -> ${JSON.stringify({ ...status1, me: '…' })}`)
    check(detail, status1.me?.userName === 'e2e-user' && status1.me?.planName === 'E2E Plan' && status1.me?.quotaRemain === 1_000_000 && status1.me?.quotaUsed === 250_000 && status1.me?.quotaRemainUsd === 2 && status1.me?.quotaUsedUsd === 0.5, `status me -> ${JSON.stringify(status1.me)}`)
    check(detail, !JSON.stringify(status1).includes(key), 'status carries only the masked key')
    // Logout: revoke on the mock, credential removed, back to not configured.
    const meBefore = mock.state.requests.filter(request => request.url === '/api/desktop/me').length
    const statusAgain = await api('GET', 'api/tako.status')
    check(detail, mock.state.requests.filter(request => request.url === '/api/desktop/me').length === meBefore, 'a second status read within 45s is served from the cache (no extra /api/desktop/me)')
    const out = await api('POST', 'api/tako.logout', {})
    check(detail, out.ok === true && out.action === 'revoked', `logout -> ${JSON.stringify(out)}`)
    check(detail, mock.state.revoked.includes(key), 'mock /api/desktop/revoke received the key')
    check(detail, storedRefs(home).refs.TAKO_API_KEY === undefined, 'TAKO_API_KEY removed from the credentials file')
    const status2 = await api('GET', 'api/tako.status')
    check(detail, status2.configured === false, `status after logout -> ${JSON.stringify(status2)}`)
  } finally {
    await stopChild(handle)
  }
})

// ---------------------------------------------------------------- report

async function finish() {
  for (const child of children) await stopChild({ child, exited: new Promise(resolve => child.once('exit', resolve)) })
  for (const fn of cleanups.reverse()) { try { await fn() } catch {} }
}
await finish()

const report = { dshVersion: installedVersion, tarball: basename(tgz), work, results, chatEvidence, notes, mockRequests: mock.state.requests }
writeFileSync(join(work, 'e2e-report.json'), JSON.stringify(report, null, 2))

console.log('\n[e2e] ================= summary =================')
console.log(`[e2e] dsh ${installedVersion}, plugin ${basename(tgz)}`)
for (const result of results) console.log(`[e2e] ${result.status.padEnd(4)} ${result.id}. ${result.title}`)
if (chatEvidence !== undefined) {
  console.log(`[e2e] chat evidence: reply=${JSON.stringify(chatEvidence.reply)} requests=${JSON.stringify(chatEvidence.requests.map(({ authorization, model, stream }) => ({ authorization, model, stream })))}`)
}
for (const [id, note] of Object.entries(notes)) console.log(`[e2e] behavior ${id}: ${note}`)
console.log(`[e2e] work dir (DSH homes, report): ${work}`)
console.log(`[e2e] report: ${join(work, 'e2e-report.json')}`)
const failed = results.filter(result => result.status === 'FAIL').length
console.log(`[e2e] ${results.filter(r => r.status === 'PASS').length} passed, ${failed} failed, ${results.filter(r => r.status === 'SKIP').length} skipped`)
process.exit(failed > 0 ? 1 : 0)
