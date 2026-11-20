#!/usr/bin/env node
/**
 * Real DSH Web-profile acceptance for desktop #34's npm-plugin lifecycle.
 *
 * All Tako traffic goes to a loopback TEST service. No real profiles, keys,
 * browser profiles or model calls are used. Chromium's sandbox stays enabled.
 *
 * Prerequisites: npm ci && npm run build, a clean @deepseek-ai/dsh@0.2.1-rc.2
 * installation and Playwright with Chromium. Dependencies are supplied, not
 * downloaded or installed by this script:
 *
 *   DSH_UI_RUNTIME=/absolute/clean/dsh-install
 *   DSH_UI_PLAYWRIGHT=/absolute/path/to/playwright/index.mjs
 *   DSH_UI_CHROMIUM=/absolute/path/to/chromium  (optional)
 *   node scripts/e2e/login-ui.mjs
 *
 * Baseline mode installs an actual pre-fix tarball in its own fresh profile:
 *   DSH_UI_MODE=before DSH_UI_TGZ=/absolute/baseline-plugin.tgz ...
 * Evidence is stored in DSH_UI_OUTPUT (default: docs/acceptance/.../).
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import YAML from 'yaml'
import { startMockTako } from './mock-tako.mjs'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const mode = process.env.DSH_UI_MODE || 'after'
assert.ok(['before', 'after'].includes(mode), 'DSH_UI_MODE must be before or after')
const runtime = process.env.DSH_UI_RUNTIME
const playwrightModule = process.env.DSH_UI_PLAYWRIGHT
assert.ok(runtime && playwrightModule, 'Set DSH_UI_RUNTIME and DSH_UI_PLAYWRIGHT')
const dshBin = join(resolve(runtime), 'node_modules/@deepseek-ai/dsh/lib/bin.js')
assert.ok(existsSync(dshBin), 'DSH installation must be ready')
const output = resolve(process.env.DSH_UI_OUTPUT || join(repo, 'docs/acceptance/2026-11-16-desktop-34-login'))
mkdirSync(output, { recursive: true })
const work = mkdtempSync(join(tmpdir(), '441ba182-login-ui-'))
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  !/^(DSH_|DSH_UI_|TAKO_|DEEPSEEK_|OPENAI_|ANTHROPIC_|XDG_|npm_|HTTP_PROXY$|HTTPS_PROXY$|ALL_PROXY$|NO_PROXY$)/i.test(key)))
Object.assign(env, { HOME: join(work, 'home'), DSH_HOME: join(work, 'dsh-home'),
  DSH_AGENTS_HOME: join(work, 'agents'), COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
  COREPACK_HOME: process.env.COREPACK_HOME || join(process.env.XDG_CACHE_HOME || join(process.env.HOME, '.cache'), 'node/corepack'),
  NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost' })
for (const path of [env.HOME, env.DSH_HOME, env.DSH_AGENTS_HOME]) mkdirSync(path, { recursive: true })
const logs = []
const checks = []
const pageErrors = []
const network = []
let host
let browser
let proxy
let mock
let currentAccount = 'TEST Account A'
const testKeys = new Map()
const originalFetch = globalThis.fetch
const report = { mode, label: 'TEST authorization service; not a real account or packaged desktop acceptance',
  startedAt: new Date().toISOString(), work, dshVersion: JSON.parse(readFileSync(join(resolve(runtime), 'node_modules/@deepseek-ai/dsh/package.json'))).version,
  checks, pageErrors, network }
const check = (name, detail = {}) => { checks.push({ name, ...detail, at: new Date().toISOString() }); console.log(`[${mode}] PASS ${name}`) }
const waitFor = async (predicate, label, timeout = 90_000) => {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const value = await predicate()
    if (value) return value
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`Timed out waiting for ${label}`)
}
const run = (args, timeout = 180_000) => new Promise((resolveRun, reject) => {
  const child = spawn(process.execPath, [dshBin, ...args], { cwd: repo, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let text = ''
  child.stdout.on('data', chunk => { text += chunk })
  child.stderr.on('data', chunk => { text += chunk })
  const timer = setTimeout(() => child.kill('SIGTERM'), timeout)
  child.on('error', reject)
  child.on('exit', code => { clearTimeout(timer); logs.push(text); code === 0 ? resolveRun(text) : reject(new Error(`dsh ${args.join(' ')} failed (${code}): ${text}`)) })
})
const shot = async (page, name) => {
  await page.screenshot({ path: join(output, `${mode}-${name}.png`), fullPage: true })
  check(`screenshot ${name}`)
}
const banner = async page => {
  await page.evaluate(label => {
    if (document.getElementById('login-test-evidence-label')) return
    const node = document.createElement('div')
    node.id = 'login-test-evidence-label'
    node.textContent = label
    node.style.cssText = 'position:fixed;z-index:2147483647;top:0;left:0;right:0;padding:5px 12px;background:#fff4cc;color:#302900;font:12px system-ui;text-align:center;pointer-events:none'
    document.body.append(node)
  }, `TEST · ${mode.toUpperCase()} · isolated DSH Web / local authorization · no real account / no model calls`)
}

try {
  mock = await startMockTako({ pricingFile: join(repo, 'tests/fixtures/pricing-2026-10-25.json') })
  // A local proxy adds an explicit TEST consent page while retaining the
  // existing mock's real state, one-use-code and S256 PKCE verification.
  proxy = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1')
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      const body = Buffer.concat(chunks)
      if (url.pathname === '/app/authorize' && !url.searchParams.has('test_decision')) {
        const approve = new URL(url)
        approve.searchParams.set('test_decision', 'approve')
        const deny = new URL(url)
        deny.searchParams.set('test_decision', 'deny')
        const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>TEST Tako authorization</title><body style="font:18px system-ui;max-width:650px;margin:80px auto"><h1>TEST · Tako 授权测试</h1><p>隔离本地授权服务，仅假账号；不调用真实账号或付费模型。</p><p>Account: ${currentAccount}</p><p><a id="test-approve" href="${approve.pathname + approve.search.replaceAll('&', '&amp;')}">TEST 确认授权 / Approve</a></p><p><a id="test-deny" href="${deny.pathname + deny.search.replaceAll('&', '&amp;')}">TEST 拒绝 / Deny</a></p></body></html>`
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(html)
        return
      }
      if (url.pathname === '/app/authorize') mock.state.authorizeMode = url.searchParams.get('test_decision') === 'deny' ? 'deny' : 'approve'
      const target = new URL(url.pathname + url.search, mock.origin)
      const upstream = await originalFetch(target, { method: req.method, redirect: 'manual',
        headers: { 'content-type': req.headers['content-type'] || 'application/json',
          ...(req.headers.authorization ? { authorization: req.headers.authorization } : {}) },
        ...(body.length ? { body } : {}), signal: AbortSignal.timeout(15_000) })
      let payload = await upstream.text()
      if (url.pathname === '/api/desktop/token' && upstream.ok) {
        const value = JSON.parse(payload)
        if (value.success) {
          testKeys.set(value.data.key, currentAccount)
          value.data.user.name = currentAccount
          value.data.plan.name = 'TEST Plan'
          payload = JSON.stringify(value)
        }
      }
      if (url.pathname === '/api/desktop/me' && upstream.ok) {
        const value = JSON.parse(payload)
        const key = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
        const account = testKeys.get(key)
        if (value.success && account) {
          value.data.user.name = account
          value.data.plan.name = 'TEST Plan'
          value.data.quota.remain = account.endsWith('B') ? 4_000_000 : 1_000_000
          payload = JSON.stringify(value)
        }
      }
      if (url.pathname === '/api/status') payload = JSON.stringify({ success: true, data: { quota_per_unit: 500000, announcements: [{ content: 'TEST：隔离授权服务，非真实账号验收', type: 'info' }] } })
      network.push({ method: req.method, path: url.pathname, status: upstream.status })
      res.writeHead(url.pathname === '/api/status' ? 200 : upstream.status, {
        'content-type': upstream.headers.get('content-type') || 'application/json',
        ...(upstream.headers.has('location') ? { location: upstream.headers.get('location') } : {}),
        'cache-control': 'no-store',
      }).end(payload)
    } catch (error) {
      res.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ success: false, message: String(error) }))
    }
  })
  await new Promise(resolveListen => proxy.listen(0, '127.0.0.1', resolveListen))
  const origin = `http://127.0.0.1:${proxy.address().port}`
  const tgzDir = join(work, 'pack')
  mkdirSync(tgzDir)
  if (mode === 'before') assert.ok(process.env.DSH_UI_TGZ, 'Baseline mode requires DSH_UI_TGZ')
  const packed = process.env.DSH_UI_TGZ ? { filename: resolve(process.env.DSH_UI_TGZ) } : await new Promise((resolvePack, reject) => {
    const child = spawn('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', tgzDir], { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = '', stderr = ''
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.on('exit', code => code === 0 ? resolvePack(JSON.parse(stdout)[0]) : reject(new Error(stderr)))
    child.on('error', reject)
  })
  const tgz = resolve(tgzDir, packed.filename)
  report.tarballSha256 = createHash('sha256').update(readFileSync(tgz)).digest('hex')
  await run(['plugin', '--profile', 'web', 'add', tgz, '--workspace-root', '--ignore-scripts'])
  const profileDir = join(env.DSH_HOME, 'profiles/web')
  const patchPath = join(profileDir, 'cordis.patch.yml')
  const patch = YAML.parse(readFileSync(patchPath, 'utf8')) || []
  writeFileSync(patchPath, YAML.stringify([{ id: 'tako', config: { baseURL: origin } }, ...patch.filter(entry => entry.id !== 'tako')]))
  check('packed plugin installed in a fresh isolated official Web profile', { integrity: packed.integrity })

  let hostOutput = ''
  host = spawn(process.execPath, [dshBin, 'web', '--no-open', '--port', '0', '--host', '127.0.0.1'], { cwd: repo, env, stdio: ['ignore', 'pipe', 'pipe'] })
  host.stdout.on('data', chunk => { hostOutput += chunk })
  host.stderr.on('data', chunk => { hostOutput += chunk })
  const url = await waitFor(() => {
    if (host.exitCode !== null) throw new Error(`DSH exited: ${hostOutput}`)
    return /dsh web: (http\S+)/.exec(hostOutput)?.[1]
  }, 'the actual DSH Web URL')
  logs.push(() => hostOutput.replace(/token=[^\s&]+/g, 'token=<redacted>'))
  const { chromium } = await import(pathToFileURL(resolve(playwrightModule)).href)
  browser = await chromium.launch({ headless: true, chromiumSandbox: true,
    ...(process.env.DSH_UI_CHROMIUM ? { executablePath: process.env.DSH_UI_CHROMIUM } : {}) })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1080 }, locale: 'zh-CN',
    recordVideo: { dir: join(output, `${mode}-video`), size: { width: 1440, height: 1080 } } })
  const allowedHosts = new Set(['127.0.0.1', 'localhost'])
  await context.route('**/*', async route => {
    const requestUrl = new URL(route.request().url())
    if (!['http:', 'https:'].includes(requestUrl.protocol)) return route.continue()
    if (!allowedHosts.has(requestUrl.hostname)) {
      network.push({ blockedExternal: requestUrl.origin })
      return route.abort('blockedbyclient')
    }
    return route.continue()
  })
  const page = await context.newPage()
  page.on('pageerror', error => pageErrors.push(String(error)))
  await page.goto(url)
  await page.getByRole('button', { name: /^(继续|Continue)$/ }).click()
  await page.getByRole('button', { name: /^(添加 API Key|Add API Key)$/ }).click()
  await page.getByRole('button', { name: /^(稍后配置|Configure later)$/ }).click()
  check('fresh-profile preview notice and optional provider setup dismissed through the UI')
  await page.getByRole('button', { name: /Tako 控制台|Tako Console/ }).click()
  await page.getByTestId('dsh-tako-console-sign-in').waitFor()
  await banner(page)
  await shot(page, 'signed-out-1440')
  check('real console and sidebar footer rendered before login')

  const signIn = async (account, decision = 'approve') => {
    currentAccount = account
    const popupPromise = page.waitForEvent('popup')
    const primary = page.getByTestId('dsh-tako-console-sign-in')
    if (await primary.count()) await primary.click()
    else await page.getByRole('button', { name: /重新登录 Tako|Sign in to Tako again/ }).click()
    const popup = await popupPromise
    await popup.locator('#test-approve').waitFor()
    const authorize = new URL(popup.url())
    assert.equal(authorize.pathname, '/app/authorize')
    assert.equal(authorize.searchParams.get('code_challenge_method'), 'S256')
    assert.equal(authorize.searchParams.get('client_id'), 'tako-connect')
    assert.ok(authorize.searchParams.get('state'))
    check('main sign-in button opened the authorization popup with S256 and state')
    await shot(popup, `${decision}-${account.endsWith('B') ? 'b' : 'a'}-authorization`)
    await popup.locator(`#test-${decision}`).click()
    await popup.waitForURL('**/tako/callback?**')
    await popup.getByRole('heading', { name: decision === 'approve' ? /登录成功/ : /授权已取消/ }).waitFor()
    await shot(popup, `${decision}-callback`)
    await popup.close()
    if (decision === 'approve') {
      await page.getByTestId('dsh-tako-console-sign-out').waitFor()
      await page.getByRole('heading', { name: account, exact: true }).waitFor()
      check(`PKCE completed, official credentials saved, console shows ${account}`)
    } else {
      await page.getByText(/已在 Tako 页面拒绝授权|The request was declined/).waitFor()
      check('denied authorization is visibly reported')
    }
  }

  await signIn('TEST Account A')
  await shot(page, 'signed-in-1440')
  assert.equal(await page.getByTestId('dsh-tako-footer').getAttribute('data-tako-quota'), 'plan')
  check('console and sidebar agree after primary-button login')
  if (mode === 'before') {
    await page.getByTestId('dsh-tako-console-sign-out').click()
    await page.getByTestId('dsh-tako-console-sign-in').waitFor()
    assert.equal(await page.getByTestId('dsh-tako-footer').getAttribute('data-tako-quota'), 'empty')
    assert.ok((await page.locator('[data-dsh-tako-card="account"]').innerText()).includes('API key 已保存'))
    check('baseline reproduced: logout is signed out but completed sign-in success remains')
    await shot(page, 'logout-stale-note-1440')
  } else {
    await page.route('**/api/tako.logout', route => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'TEST credential store unavailable' }) }))
    await page.getByTestId('dsh-tako-console-sign-out').click()
    await page.getByText('登录失败: TEST credential store unavailable', { exact: true }).waitFor()
    assert.ok((await page.locator('[data-dsh-tako-card="account"]').innerText()).includes('API key 已保存'))
    await shot(page, 'logout-error-1440')
    check('HTTP logout error remains visible without falsely clearing login')
    await page.unroute('**/api/tako.logout')
    await page.getByTestId('dsh-tako-console-sign-out').click()
    await page.getByTestId('dsh-tako-console-sign-in').waitFor()
    await waitFor(async () => await page.getByTestId('dsh-tako-footer').getAttribute('data-tako-quota') === 'empty', 'signed-out footer')
    assert.ok(!(await page.locator('[data-dsh-tako-card="account"]').innerText()).includes('API key 已保存'))
    await shot(page, 'signed-out-after-logout-1440')
    check('logout clears credential, both surfaces and completed success note')
    await signIn('TEST Account A', 'deny')
    await shot(page, 'denied-1440')
    await signIn('TEST Account B')
    await shot(page, 'account-b-1440')
    await page.setViewportSize({ width: 390, height: 844 })
    await shot(page, 'account-b-390')
    check('mobile viewport captured (Web profile only)')
  }
  assert.ok(mock.state.tokenExchanges.filter(entry => entry.ok).length >= 1)
  assert.equal(mock.chatRequests().length, 0)
  report.pkceExchanges = mock.state.tokenExchanges.map(({ ok, reason }) => ({ ok, reason }))
  report.modelRequests = mock.chatRequests().length
  report.success = true
} catch (error) {
  report.success = false
  report.error = error instanceof Error ? error.stack : String(error)
  if (browser) {
    const pages = browser.contexts().flatMap(context => context.pages())
    for (let index = 0; index < pages.length; index++) {
      await pages[index].screenshot({ path: join(output, `${mode}-failure-${index}.png`), fullPage: true }).catch(() => {})
      report[`failurePage${index}`] = await pages[index].locator('body').innerText().catch(() => '')
    }
  }
  console.error(report.error)
  process.exitCode = 1
} finally {
  if (browser) await browser.close().catch(() => {})
  if (host && host.exitCode === null) {
    host.kill('SIGTERM')
    await new Promise(resolveExit => { const timer = setTimeout(() => { host.kill('SIGKILL'); resolveExit() }, 8000); host.once('exit', () => { clearTimeout(timer); resolveExit() }) })
  }
  if (proxy) await new Promise(resolveClose => { proxy.closeAllConnections(); proxy.close(resolveClose) })
  if (mock) await mock.close()
  report.finishedAt = new Date().toISOString()
  writeFileSync(join(output, `${mode}-ui-results.json`), JSON.stringify(report, null, 2) + '\n')
  writeFileSync(join(output, `${mode}-host.log`), logs.map(value => typeof value === 'function' ? value() : value).join('\n'))
}
