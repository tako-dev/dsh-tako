/**
 * `dsh-tako` command line: `login`, `logout`, `whoami`.
 *
 * dsh dispatches its first argument as a profile name (or `plugin`), so a
 * plugin cannot add `dsh tako ...`; this is a separate bin that opens the
 * installation's own credential store (see `store.ts`).
 * @module dsh-tako/cli
 */

import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import type { BrowserLoginHandle, BrowserLoginOptions } from './login.ts'
import { defaultDeviceName, fetchMe, maskKey, revokeKey, sanitizeDeviceName, startBrowserLogin, TakoLoginError } from './login.ts'
import { openBrowser } from './open.ts'
import { DEFAULT_PROFILE, normalizeOrigin, pluginConfigFromPatch } from './shared.ts'
import type { DshRuntime } from './store.ts'
import { loadDshRuntime, locateDsh } from './store.ts'

export const USAGE = `Usage: dsh-tako <command> [options]

Commands:
  login     Sign in to Tako in the browser and save the API key to dsh's credentials
  logout    Revoke the saved key on Tako and remove it from dsh's credentials
  whoami    Show the Tako account behind the configured key

Options:
  --profile <name>      dsh profile whose dsh-tako config to read (default: ${DEFAULT_PROFILE})
  --base-url <url>      Tako origin (default: the profile's baseURL, else https://tako.shiroha.tech)
  --api-key-env <name>  credential name (default: the profile's apiKeyEnv, else TAKO_API_KEY)
  --dsh <path>          dsh installation to use (default: \`dsh\` on PATH, then the global npm root; env DSH_TAKO_DSH)
  -h, --help            show this help

login options:
  --no-open             print the sign-in URL instead of opening a browser
  --port <port>         fixed loopback callback port (1024-65535), e.g. for \`ssh -L <port>:127.0.0.1:<port>\`
  --device-name <name>  label shown on the Tako authorization page (default: dsh-tako@<hostname>)

The key is stored in $DSH_HOME/.credentials.yaml under the credential name, through
dsh's own credential provider. Running dsh processes pick it up on the next request.
`

export interface CliIo {
  stdout: (text: string) => void
  stderr: (text: string) => void
  env: NodeJS.ProcessEnv
}

/** Seams for tests. */
export interface CliDeps {
  loadRuntime?: (dshPath: string | undefined, env: NodeJS.ProcessEnv) => Promise<DshRuntime>
  openBrowser?: (url: string) => Promise<boolean>
  fetch?: typeof fetch
  startLogin?: (options: BrowserLoginOptions) => Promise<BrowserLoginHandle>
  /** Login wait in ms; production uses the 5-minute code lifetime. */
  loginTimeoutMs?: number
  /** Register a Ctrl-C handler; returns the unregister function. */
  onInterrupt?: (handler: () => void) => () => void
}

const defaultLoadRuntime = async (dshPath: string | undefined, env: NodeJS.ProcessEnv): Promise<DshRuntime> => loadDshRuntime(locateDsh(dshPath, env), env)

const defaultOnInterrupt = (handler: () => void): (() => void) => {
  process.once('SIGINT', handler)
  return () => { process.off('SIGINT', handler) }
}

class UsageError extends Error {}

interface Resolved {
  runtime: DshRuntime
  profile: string
  origin: string
  apiKeyEnv: string
  fromProfile: boolean
}

async function resolveContext(values: Record<string, string | boolean | undefined>, io: CliIo, deps: CliDeps): Promise<Resolved> {
  const runtime = await (deps.loadRuntime ?? defaultLoadRuntime)(values.dsh as string | undefined, io.env)
  const profile = (values.profile as string | undefined) ?? DEFAULT_PROFILE
  if (!/^[A-Za-z0-9._-]+$/u.test(profile)) throw new UsageError(`invalid profile name ${JSON.stringify(profile)}`)
  const patchFile = join(runtime.dshHome, 'profiles', profile, 'cordis.patch.yml')
  let patch: unknown = []
  if (existsSync(patchFile)) {
    try {
      patch = runtime.parseYaml(readFileSync(patchFile, 'utf8'))
    } catch (error: unknown) {
      throw new Error(`could not read ${patchFile}: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
    }
  }
  const fromPatch = pluginConfigFromPatch(patch)
  const baseURL = (values['base-url'] as string | undefined) ?? fromPatch.baseURL
  const origin = normalizeOrigin(baseURL)
  try {
    const parsed = new URL(origin)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error('protocol')
  } catch {
    throw new UsageError(`invalid Tako URL ${JSON.stringify(baseURL)}`)
  }
  const apiKeyEnv = (values['api-key-env'] as string | undefined) ?? fromPatch.apiKeyEnv
  try {
    runtime.credentialRef(apiKeyEnv)
  } catch {
    throw new UsageError(`invalid credential name ${JSON.stringify(apiKeyEnv)} (must be a shell identifier such as TAKO_API_KEY)`)
  }
  return { runtime, profile, origin, apiKeyEnv, fromProfile: fromPatch.fromProfile }
}

const describeSource = (source: string | undefined): string => {
  switch (source) {
    case 'file': return 'dsh credentials file'
    case 'env': return 'environment variable'
    case 'project-env': return 'project .env'
    case 'user-env': return '$DSH_HOME/.env'
    default: return source ?? 'unknown'
  }
}

async function login(values: Record<string, string | boolean | undefined>, io: CliIo, deps: CliDeps): Promise<number> {
  let port: number | undefined
  if (values.port !== undefined) {
    port = Number(values.port)
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new UsageError(`--port must be an integer between 1024 and 65535, got ${String(values.port)}`)
  }
  const deviceName = sanitizeDeviceName((values['device-name'] as string | undefined) ?? defaultDeviceName())
  const context = await resolveContext(values, io, deps)
  const store = await context.runtime.openStore()
  try {
    const loginOptions: BrowserLoginOptions = {
      origin: context.origin,
      deviceName,
      onGrant: async grant => {
        await store.set(context.apiKeyEnv, grant.key)
      },
    }
    if (port !== undefined) loginOptions.port = port
    if (deps.loginTimeoutMs !== undefined) loginOptions.timeoutMs = deps.loginTimeoutMs
    if (deps.fetch !== undefined) loginOptions.fetch = deps.fetch
    const handle = await (deps.startLogin ?? startBrowserLogin)(loginOptions)
    const stopInterrupt = (deps.onInterrupt ?? defaultOnInterrupt)(() => handle.cancel())
    try {
      io.stdout(`Tako: ${context.origin}  (profile: ${context.profile}${context.fromProfile ? '' : ', plugin defaults'}; credential: ${context.apiKeyEnv})\n`)
      io.stdout(`Waiting for the browser on ${handle.redirectUri} (5 minutes; Ctrl-C to cancel)\n\n`)
      const remote = (io.env.SSH_CONNECTION ?? io.env.SSH_TTY ?? '') !== ''
      let opened = false
      if (values['no-open'] !== true) opened = await (deps.openBrowser ?? openBrowser)(handle.authorizeUrl)
      io.stdout(opened
        ? `Opened the sign-in page in your browser. If it did not appear, open this URL:\n${handle.authorizeUrl}\n`
        : `Open this URL in a browser to sign in:\n${handle.authorizeUrl}\n`)
      if (remote) {
        io.stdout(`\nThis looks like an SSH session: the browser must reach 127.0.0.1:${handle.port} on THIS machine.\n`
          + `Forward it first, e.g.  ssh -L ${handle.port}:127.0.0.1:${handle.port} <host>  (or rerun with --port <port> to pick one),\n`
          + `or paste a key in Settings -> Models -> Tako instead.\n`)
      }
      const grant = await handle.result
      const info = await store.describe(context.apiKeyEnv)
      io.stdout(`\nSigned in${grant.userName !== undefined ? ` as ${grant.userName}` : ''}${grant.planName !== undefined ? ` (${grant.planName})` : ''}.\n`)
      io.stdout(`Saved key ${maskKey(grant.key)} as ${context.apiKeyEnv} in ${store.file}${grant.name !== undefined ? ` (Tako token "${grant.name}")` : ''}.\n`)
      if (info.source !== 'file') io.stderr(`warning: ${context.apiKeyEnv} now resolves from ${describeSource(info.source)}, not the saved key\n`)
      io.stdout('Running dsh sessions use it from the next request; no restart needed.\n')
      return 0
    } finally {
      stopInterrupt()
      handle.cancel()
    }
  } finally {
    await store.close()
  }
}

async function logout(values: Record<string, string | boolean | undefined>, io: CliIo, deps: CliDeps): Promise<number> {
  const context = await resolveContext(values, io, deps)
  const store = await context.runtime.openStore()
  try {
    const current = await store.resolve(context.apiKeyEnv)
    if (current === undefined) {
      io.stdout(`No Tako key is configured as ${context.apiKeyEnv}; nothing to do.\n`)
      return 0
    }
    if (current.source !== 'file') {
      io.stdout(`${context.apiKeyEnv} comes from the ${describeSource(current.source)}, not from dsh's credentials file; nothing stored to remove.\n`)
      io.stdout('Unset it there to stop using it. The key was not revoked.\n')
      return 0
    }
    let revoked = false
    try {
      await revokeKey(context.origin, current.value, deps.fetch)
      revoked = true
    } catch (error: unknown) {
      io.stderr(`warning: could not revoke ${maskKey(current.value)} on Tako (${error instanceof Error ? error.message : String(error)}); removing it locally anyway.\n`)
      io.stderr('Delete the token in the Tako console if it is still listed there.\n')
    }
    await store.unset(context.apiKeyEnv)
    io.stdout(`${revoked ? `Revoked ${maskKey(current.value)} on Tako and removed` : `Removed ${maskKey(current.value)}`} ${context.apiKeyEnv} from ${store.file}.\n`)
    const after = await store.describe(context.apiKeyEnv)
    if (after.configured) io.stdout(`Note: ${context.apiKeyEnv} still resolves from the ${describeSource(after.source)}.\n`)
    return revoked ? 0 : 1
  } finally {
    await store.close()
  }
}

async function whoami(values: Record<string, string | boolean | undefined>, io: CliIo, deps: CliDeps): Promise<number> {
  const context = await resolveContext(values, io, deps)
  const store = await context.runtime.openStore()
  let current: { value: string, source: string } | undefined
  try {
    current = await store.resolve(context.apiKeyEnv)
  } finally {
    await store.close()
  }
  if (current === undefined) {
    io.stderr(`No Tako key is configured as ${context.apiKeyEnv}. Run: dsh-tako login${context.profile !== DEFAULT_PROFILE ? ` --profile ${context.profile}` : ''}\n`)
    return 1
  }
  const me = await fetchMe(context.origin, current.value, deps.fetch)
  io.stdout(`Tako:     ${context.origin}\n`)
  io.stdout(`User:     ${me.userName ?? '(unknown)'}${me.userId !== undefined ? ` (id ${me.userId})` : ''}\n`)
  if (me.planName !== undefined) io.stdout(`Plan:     ${me.planName}\n`)
  io.stdout(`Key:      ${maskKey(current.value)} from the ${describeSource(current.source)} (${context.apiKeyEnv})${me.tokenName !== undefined ? `, token "${me.tokenName}"` : ''}\n`)
  return 0
}

/** Run one CLI invocation; resolves with the exit code. */
export async function main(argv: readonly string[], io: CliIo, deps: CliDeps = {}): Promise<number> {
  let parsed
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      strict: true,
      options: {
        profile: { type: 'string' },
        'base-url': { type: 'string' },
        'api-key-env': { type: 'string' },
        dsh: { type: 'string' },
        'no-open': { type: 'boolean' },
        port: { type: 'string' },
        'device-name': { type: 'string' },
        help: { type: 'boolean', short: 'h' },
      },
    })
  } catch (error: unknown) {
    io.stderr(`dsh-tako: ${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`)
    return 2
  }
  const { values, positionals } = parsed
  const command = positionals[0]
  if (values.help === true || command === undefined || command === 'help') {
    io.stdout(USAGE)
    return command === undefined && values.help !== true ? 2 : 0
  }
  if (positionals.length > 1) {
    io.stderr(`dsh-tako: unexpected argument ${JSON.stringify(positionals[1])}\n`)
    return 2
  }
  try {
    switch (command) {
      case 'login': return await login(values, io, deps)
      case 'logout': return await logout(values, io, deps)
      case 'whoami': return await whoami(values, io, deps)
      default:
        io.stderr(`dsh-tako: unknown command ${JSON.stringify(command)}\n\n${USAGE}`)
        return 2
    }
  } catch (error: unknown) {
    if (error instanceof UsageError) {
      io.stderr(`dsh-tako: ${error.message}\n`)
      return 2
    }
    if (error instanceof TakoLoginError) {
      io.stderr(`dsh-tako ${command}: ${error.message}\n`)
      if (error.code === 'timeout') io.stderr('The sign-in link expires after 5 minutes; run the command again. On a remote machine see --port and SSH forwarding in --help.\n')
      return error.code === 'cancelled' ? 130 : 1
    }
    io.stderr(`dsh-tako ${command}: ${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }
}
