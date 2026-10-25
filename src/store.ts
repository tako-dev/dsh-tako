/**
 * The installation's own credential store, opened outside a running dsh.
 *
 * `dsh` has no subcommand hook for plugins and no offline credential command,
 * so the CLI boots the smallest Cordis context that holds the official
 * `@deepseek-ai/dsh-credentials-local` provider — the same service the Models
 * page writes through (`ctx.credentials.set`) — loaded from the user's dsh
 * installation, so the file format, locking and permissions are exactly the
 * installed version's. Nothing here writes the credentials file by hand.
 * @module dsh-tako/store
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { delimiter, dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Environment variable naming the dsh installation (bin file, package dir, or a dir with `node_modules/@deepseek-ai/dsh`). */
export const DSH_PATH_ENV = 'DSH_TAKO_DSH'

/** A located `@deepseek-ai/dsh` package. */
export interface DshInstall {
  /** Absolute path of its `package.json`. */
  packageJson: string
  version: string
}

function readName(packageJson: string): { name?: string, version?: string } | undefined {
  try {
    return JSON.parse(readFileSync(packageJson, 'utf8')) as { name?: string, version?: string }
  } catch {
    return undefined
  }
}

/** Walk up from a path (file or dir) to the `@deepseek-ai/dsh` package root. */
function packageFrom(start: string): DshInstall | undefined {
  let current: string
  try {
    current = realpathSync(start)
    if (statSync(current).isDirectory()) {
      const nested = join(current, 'node_modules/@deepseek-ai/dsh/package.json')
      if (existsSync(nested)) current = realpathSync(nested)
    }
  } catch {
    return undefined
  }
  if (current.endsWith('package.json')) current = dirname(current)
  else if (!statSync(current).isDirectory()) current = dirname(current)
  for (;;) {
    const candidate = join(current, 'package.json')
    const manifest = existsSync(candidate) ? readName(candidate) : undefined
    if (manifest?.name === '@deepseek-ai/dsh') return { packageJson: candidate, version: manifest.version ?? 'unknown' }
    const parent = dirname(current)
    if (parent === current) return undefined
    current = parent
  }
}

function onPath(command: string, env: NodeJS.ProcessEnv): string[] {
  const names = process.platform === 'win32' ? [`${command}.cmd`, `${command}.exe`, command] : [command]
  const found: string[] = []
  for (const dir of (env.PATH ?? env.Path ?? '').split(delimiter)) {
    if (dir === '') continue
    for (const name of names) {
      const file = join(dir, name)
      if (existsSync(file)) found.push(file)
    }
  }
  return found
}

/**
 * Find the dsh installation: `--dsh` / `$DSH_TAKO_DSH`, then `dsh` on `PATH`
 * (following its symlink), then the global npm root.
 */
export function locateDsh(explicit?: string, env: NodeJS.ProcessEnv = process.env): DshInstall {
  const given = explicit ?? env[DSH_PATH_ENV]
  if (given !== undefined && given !== '') {
    const found = packageFrom(resolve(given))
    if (found === undefined) throw new Error(`no @deepseek-ai/dsh package found at ${given}`)
    return found
  }
  for (const bin of onPath('dsh', env)) {
    const found = packageFrom(bin)
    if (found !== undefined) return found
  }
  const npmRoot = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['root', '-g'], { encoding: 'utf8', env, shell: process.platform === 'win32' })
  const root = npmRoot.status === 0 ? npmRoot.stdout.trim() : ''
  if (root !== '') {
    const found = packageFrom(join(root, '@deepseek-ai/dsh'))
    if (found !== undefined) return found
  }
  throw new Error(`could not find the dsh installation (@deepseek-ai/dsh). Install it with "npm i -g @deepseek-ai/dsh", or point ${DSH_PATH_ENV} / --dsh at it.`)
}

/** Minimal views of the official modules, typed locally so the CLI carries no hard dependency on them. */
interface CordisModule {
  Context: new () => {
    plugin: (plugin: unknown, config?: unknown) => PromiseLike<unknown> & { dispose: () => Promise<void> }
    inject: (deps: string[], callback: (ctx: { credentials: CredentialService }) => void) => void
  }
}
interface CredentialService {
  resolve: (ref: string) => Promise<{ value: string, source: string } | undefined>
  describe: (ref: string) => Promise<{ configured: boolean, source?: string, writable: boolean }>
  set: (ref: string, value: string) => Promise<void>
  unset: (ref: string) => Promise<void>
}
interface HomePathsModule {
  resolveDshHome: (configured?: string, env?: NodeJS.ProcessEnv) => string
}
interface YamlModule {
  parse: (text: string) => unknown
}

/** What the CLI needs from the installation. */
export interface DshRuntime {
  install: DshInstall
  dshHome: string
  parseYaml: (text: string) => unknown
  /** Validate a reference name with the official brand function. */
  credentialRef: (name: string) => string
  /** Open the official credential store for `dshHome`. */
  openStore: () => Promise<CredentialStore>
}

/** The official `ctx.credentials` service, scoped to one CLI run. */
export interface CredentialStore {
  /** `$DSH_HOME/.credentials.yaml` as the provider resolves it. */
  file: string
  resolve: (name: string) => Promise<{ value: string, source: string } | undefined>
  describe: (name: string) => Promise<{ configured: boolean, source?: string, writable: boolean }>
  set: (name: string, value: string) => Promise<void>
  unset: (name: string) => Promise<void>
  close: () => Promise<void>
}

async function importFrom<T>(require: NodeJS.Require, specifier: string): Promise<{ module: T, path: string }> {
  const path = require.resolve(specifier)
  return { module: await import(pathToFileURL(path).href) as T, path }
}

/** Load the official modules from a dsh installation. */
export async function loadDshRuntime(install: DshInstall, env: NodeJS.ProcessEnv = process.env): Promise<DshRuntime> {
  const fromDsh = createRequire(install.packageJson)
  const cordis = await importFrom<CordisModule>(fromDsh, '@deepseek-ai/cordis')
  const local = await importFrom<{ default: unknown }>(fromDsh, '@deepseek-ai/dsh-credentials-local')
  const homePaths = await importFrom<HomePathsModule>(fromDsh, '@deepseek-ai/dsh-home-paths')
  // Peers of the credentials provider resolve from its own location.
  const fromLocal = createRequire(local.path)
  const seam = await importFrom<{ credentialRef: (value: string) => string }>(fromLocal, '@deepseek-ai/dsh-credentials')
  const yaml = await importFrom<YamlModule>(fromLocal, 'yaml')
  const dshHome = homePaths.module.resolveDshHome(undefined, env)
  const file = join(dshHome, '.credentials.yaml')
  return {
    install,
    dshHome,
    parseYaml: text => yaml.module.parse(text),
    credentialRef: name => seam.module.credentialRef(name),
    openStore: async () => {
      const ctx = new cordis.module.Context()
      // `path` pins the file to this DSH_HOME; no watcher for a one-shot run.
      const fiber = ctx.plugin(local.module.default, { path: file, dshHome, watch: false })
      await fiber
      const service = await new Promise<CredentialService>((resolveService, reject) => {
        const timer = setTimeout(() => reject(new Error('the credentials service did not start')), 10_000)
        ctx.inject(['credentials'], inner => { clearTimeout(timer); resolveService(inner.credentials) })
      })
      const ref = (name: string) => seam.module.credentialRef(name)
      return {
        file,
        resolve: name => service.resolve(ref(name)),
        describe: name => service.describe(ref(name)),
        set: (name, value) => service.set(ref(name), value),
        unset: name => service.unset(ref(name)),
        close: () => fiber.dispose(),
      }
    },
  }
}
