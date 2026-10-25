import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { CliDeps } from '../src/cli.ts'
import { main } from '../src/cli.ts'
import type { BrowserLoginHandle, BrowserLoginOptions, TakoGrant } from '../src/login.ts'
import { defaultDeviceName, TakoLoginError } from '../src/login.ts'
import { pluginConfigFromPatch } from '../src/shared.ts'
import type { CredentialStore, DshRuntime } from '../src/store.ts'
import { locateDsh } from '../src/store.ts'

const KEY = 'cr_0123456789abcdefWXYZ'

function fakeStore(initial: Record<string, { value: string, source: string }> = {}) {
  const values = new Map(Object.entries(initial))
  const store = {
    file: '/home/u/.dsh/.credentials.yaml',
    resolve: vi.fn(async (name: string) => values.get(name)),
    describe: vi.fn(async (name: string) => {
      const hit = values.get(name)
      return hit === undefined ? { configured: false, writable: true } : { configured: true, source: hit.source, writable: true }
    }),
    set: vi.fn(async (name: string, value: string) => { values.set(name, { value, source: 'file' }) }),
    unset: vi.fn(async (name: string) => { if (values.get(name)?.source === 'file') values.delete(name) }),
    close: vi.fn(async () => {}),
  } satisfies CredentialStore
  return { store, values }
}

function fakeRuntime(store: CredentialStore, patches: Record<string, unknown> = {}, dshHome?: string): DshRuntime {
  const home = dshHome ?? mkdtempSync(join(tmpdir(), 'dsh-tako-cli-'))
  for (const [profile, patch] of Object.entries(patches)) {
    mkdirSync(join(home, 'profiles', profile), { recursive: true })
    writeFileSync(join(home, 'profiles', profile, 'cordis.patch.yml'), JSON.stringify(patch))
  }
  return {
    install: { packageJson: '/x/package.json', version: '0.2.1-rc.2' },
    dshHome: home,
    parseYaml: text => JSON.parse(text) as unknown, // JSON is YAML
    credentialRef: name => { if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new TypeError('bad ref'); return name },
    openStore: async () => store,
  }
}

/** A login starter that "receives" a grant (or error) right after start, like a browser completing. */
function fakeLogin(outcome: TakoGrant | TakoLoginError) {
  const seen: BrowserLoginOptions[] = []
  const startLogin = vi.fn(async (options: BrowserLoginOptions): Promise<BrowserLoginHandle> => {
    seen.push(options)
    const result = (async () => {
      await new Promise(resolve => setTimeout(resolve, 5))
      if (outcome instanceof TakoLoginError) throw outcome
      await options.onGrant?.(outcome)
      return outcome
    })()
    result.catch(() => {})
    return {
      authorizeUrl: `${options.origin}/app/authorize?client_id=tako-connect&state=s`,
      redirectUri: 'http://127.0.0.1:50000/tako/callback',
      port: 50000,
      result,
      cancel: vi.fn(),
    }
  })
  return { startLogin, seen }
}

async function run(argv: string[], deps: CliDeps, env: NodeJS.ProcessEnv = {}) {
  let stdout = ''
  let stderr = ''
  const code = await main(argv, { stdout: text => { stdout += text }, stderr: text => { stderr += text }, env }, { onInterrupt: () => () => {}, ...deps })
  return { code, stdout, stderr }
}

describe('dsh-tako login', () => {
  it('stores the key through the credential service under apiKeyEnv and never prints it', async () => {
    const { store } = fakeStore()
    const { startLogin, seen } = fakeLogin({ key: KEY, userName: 'alice', planName: 'Pro', name: 'tako-connect@dsh-tako@linux' })
    const openBrowser = vi.fn(async () => true)
    const result = await run(['login'], { loadRuntime: async () => fakeRuntime(store), startLogin, openBrowser })
    expect(result.code).toBe(0)
    expect(store.set).toHaveBeenCalledExactlyOnceWith('TAKO_API_KEY', KEY)
    expect(store.close).toHaveBeenCalled()
    expect(seen[0]).toMatchObject({ origin: 'https://tako.shiroha.tech', deviceName: defaultDeviceName() })
    expect(openBrowser).toHaveBeenCalledWith('https://tako.shiroha.tech/app/authorize?client_id=tako-connect&state=s')
    expect(result.stdout).toContain('Signed in as alice (Pro).')
    expect(result.stdout).toContain('cr_****WXYZ')
    expect(result.stdout + result.stderr).not.toContain(KEY)
  })

  it('reads baseURL and apiKeyEnv from the profile patch; flags win', async () => {
    const { store } = fakeStore()
    const patch = [{ id: 'tako', config: { baseURL: 'https://tako.example/v1/', apiKeyEnv: 'MY_TAKO' } }, { id: 'llm-pi-ai', config: {} }]
    const login = fakeLogin({ key: KEY })
    const runtime = fakeRuntime(store, { acp: patch })
    const first = await run(['login', '--profile', 'acp', '--no-open'], { loadRuntime: async () => runtime, startLogin: login.startLogin, openBrowser: vi.fn() })
    expect(first.code).toBe(0)
    expect(login.seen[0]?.origin).toBe('https://tako.example')
    expect(store.set).toHaveBeenLastCalledWith('MY_TAKO', KEY)
    expect(first.stdout).toContain('Open this URL in a browser to sign in:\nhttps://tako.example/app/authorize')

    const second = await run(['login', '--profile', 'acp', '--no-open', '--base-url', 'http://127.0.0.1:9', '--api-key-env', 'OTHER', '--port', '4567'], { loadRuntime: async () => runtime, startLogin: login.startLogin })
    expect(second.code).toBe(0)
    expect(login.seen[1]).toMatchObject({ origin: 'http://127.0.0.1:9', port: 4567 })
    expect(store.set).toHaveBeenLastCalledWith('OTHER', KEY)
  })

  it('--no-open does not start a browser', async () => {
    const { store } = fakeStore()
    const openBrowser = vi.fn(async () => true)
    await run(['login', '--no-open'], { loadRuntime: async () => fakeRuntime(store), startLogin: fakeLogin({ key: KEY }).startLogin, openBrowser })
    expect(openBrowser).not.toHaveBeenCalled()
  })

  it('prints the SSH forwarding hint inside an SSH session', async () => {
    const { store } = fakeStore()
    const result = await run(['login', '--no-open'], { loadRuntime: async () => fakeRuntime(store), startLogin: fakeLogin({ key: KEY }).startLogin }, { SSH_CONNECTION: '1.2.3.4 5 6.7.8.9 22' })
    expect(result.stdout).toContain('ssh -L 50000:127.0.0.1:50000')
  })

  it('stores nothing and exits 1 when the browser denies', async () => {
    const { store } = fakeStore()
    const result = await run(['login', '--no-open'], { loadRuntime: async () => fakeRuntime(store), startLogin: fakeLogin(new TakoLoginError('denied', 'authorization was denied in the browser')).startLogin })
    expect(result.code).toBe(1)
    expect(store.set).not.toHaveBeenCalled()
    expect(result.stderr).toContain('authorization was denied')
    expect(store.close).toHaveBeenCalled()
  })

  it('explains a timeout', async () => {
    const { store } = fakeStore()
    const result = await run(['login', '--no-open'], { loadRuntime: async () => fakeRuntime(store), startLogin: fakeLogin(new TakoLoginError('timeout', 'no authorization arrived within 300s')).startLogin })
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('expires after 5 minutes')
  })

  it('rejects bad flags before touching the store', async () => {
    const loadRuntime = vi.fn()
    expect((await run(['login', '--port', '80'], { loadRuntime })).code).toBe(2)
    expect((await run(['login', '--bogus'], { loadRuntime })).code).toBe(2)
    expect((await run(['frobnicate'], { loadRuntime })).code).toBe(2)
    expect(loadRuntime).not.toHaveBeenCalled()
    const { store } = fakeStore()
    expect((await run(['login', '--api-key-env', 'not-valid'], { loadRuntime: async () => fakeRuntime(store) })).code).toBe(2)
    expect((await run(['login', '--base-url', 'ftp://x'], { loadRuntime: async () => fakeRuntime(store) })).code).toBe(2)
    expect((await run(['--help'], {})).stdout).toContain('dsh-tako <command>')
  })

  it('reports a missing dsh installation', async () => {
    const result = await run(['login'], { loadRuntime: async () => { throw new Error('could not find the dsh installation') } })
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('could not find the dsh installation')
  })
})

describe('dsh-tako logout / whoami', () => {
  const okFetch = (seen: string[] = []) => vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    seen.push(`${init?.method ?? 'GET'} ${String(input)} ${new Headers(init?.headers).get('authorization')}`)
    if (String(input).endsWith('/me')) return Response.json({ success: true, data: { user: { id: '7', name: 'alice' }, plan: { name: 'Pro' }, token: { id: 1, name: 'tako-connect@x' } } })
    return Response.json({ success: true, data: { revoked: true } })
  }) as unknown as typeof fetch

  it('logout revokes the stored key, then removes it', async () => {
    const { store, values } = fakeStore({ TAKO_API_KEY: { value: KEY, source: 'file' } })
    const seen: string[] = []
    const result = await run(['logout'], { loadRuntime: async () => fakeRuntime(store), fetch: okFetch(seen) })
    expect(result.code).toBe(0)
    expect(seen).toEqual([`POST https://tako.shiroha.tech/api/desktop/revoke Bearer ${KEY}`])
    expect(store.unset).toHaveBeenCalledWith('TAKO_API_KEY')
    expect(values.has('TAKO_API_KEY')).toBe(false)
    expect(result.stdout).toContain('Revoked cr_****WXYZ')
    expect(result.stdout).not.toContain(KEY)
  })

  it('logout still removes the key locally when revoke fails, exiting 1', async () => {
    const { store } = fakeStore({ TAKO_API_KEY: { value: KEY, source: 'file' } })
    const failing = vi.fn(async () => Response.json({ success: false, error: 'invalid_token' }, { status: 401 })) as unknown as typeof fetch
    const result = await run(['logout'], { loadRuntime: async () => fakeRuntime(store), fetch: failing })
    expect(result.code).toBe(1)
    expect(store.unset).toHaveBeenCalledWith('TAKO_API_KEY')
    expect(result.stderr).toContain('could not revoke cr_****WXYZ')
  })

  it('logout leaves an environment-supplied key alone', async () => {
    const { store } = fakeStore({ TAKO_API_KEY: { value: KEY, source: 'env' } })
    const fetchImpl = okFetch()
    const result = await run(['logout'], { loadRuntime: async () => fakeRuntime(store), fetch: fetchImpl })
    expect(result.code).toBe(0)
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(store.unset).not.toHaveBeenCalled()
    expect(result.stdout).toContain('environment variable')
  })

  it('whoami shows the account behind the key', async () => {
    const { store } = fakeStore({ TAKO_API_KEY: { value: KEY, source: 'file' } })
    const seen: string[] = []
    const result = await run(['whoami'], { loadRuntime: async () => fakeRuntime(store), fetch: okFetch(seen) })
    expect(result.code).toBe(0)
    expect(seen).toEqual([`GET https://tako.shiroha.tech/api/desktop/me Bearer ${KEY}`])
    expect(result.stdout).toContain('User:     alice (id 7)')
    expect(result.stdout).toContain('cr_****WXYZ from the dsh credentials file')
    expect(result.stdout).not.toContain(KEY)
  })

  it('whoami without a key points at login', async () => {
    const { store } = fakeStore()
    const result = await run(['whoami', '--profile', 'acp'], { loadRuntime: async () => fakeRuntime(store), fetch: okFetch() })
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('dsh-tako login --profile acp')
  })
})

describe('profile config and dsh discovery', () => {
  it('reads the plugin row, including bundle-style insert lists', () => {
    expect(pluginConfigFromPatch(undefined)).toEqual({ baseURL: 'https://tako.shiroha.tech', apiKeyEnv: 'TAKO_API_KEY', fromProfile: false })
    expect(pluginConfigFromPatch([{ id: 'tako', config: { baseURL: 'https://a' } }])).toEqual({ baseURL: 'https://a', apiKeyEnv: 'TAKO_API_KEY', fromProfile: true })
    expect(pluginConfigFromPatch([{ insert: [{ id: 'tako', name: 'dsh-tako', config: { apiKeyEnv: 'K' } }] }])).toMatchObject({ apiKeyEnv: 'K', fromProfile: true })
    expect(pluginConfigFromPatch([{ id: 'other', config: { baseURL: 'https://b' } }])).toMatchObject({ baseURL: 'https://tako.shiroha.tech', fromProfile: false })
  })

  it('finds dsh from an explicit path, PATH symlink, or install dir', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-tako-locate-')))
    const pkg = join(root, 'node_modules/@deepseek-ai/dsh')
    mkdirSync(join(pkg, 'lib'), { recursive: true })
    writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '9.9.9' }))
    writeFileSync(join(pkg, 'lib/bin.js'), '')
    const bin = join(root, 'bin')
    mkdirSync(bin)
    symlinkSync(join(pkg, 'lib/bin.js'), join(bin, 'dsh'))
    expect(locateDsh(root, {})).toEqual({ packageJson: join(pkg, 'package.json'), version: '9.9.9' })
    expect(locateDsh(join(pkg, 'lib/bin.js'), {}).version).toBe('9.9.9')
    expect(locateDsh(undefined, { DSH_TAKO_DSH: pkg }).version).toBe('9.9.9')
    expect(locateDsh(undefined, { PATH: bin }).packageJson.endsWith('package.json')).toBe(true)
    expect(() => locateDsh(join(root, 'bin'), {})).toThrow('no @deepseek-ai/dsh package')
  })
})
