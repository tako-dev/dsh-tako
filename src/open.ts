/**
 * Open a URL in the user's default browser with the platform's own opener.
 * dsh 0.2.1-rc.2 ships no opener service a standalone process could call, so
 * this mirrors what such openers do: `open`, `xdg-open`, or the Windows URL
 * protocol handler.
 * @module dsh-tako/open
 */

import { spawn } from 'node:child_process'

/** The opener command for a platform. */
export function openerCommand(url: string, platform: NodeJS.Platform = process.platform): { command: string, args: string[] } {
  if (platform === 'darwin') return { command: 'open', args: [url] }
  // `start` would split the URL at `&`; the protocol handler takes it verbatim.
  if (platform === 'win32') return { command: 'rundll32', args: ['url.dll,FileProtocolHandler', url] }
  return { command: 'xdg-open', args: [url] }
}

/** Try to open the URL; resolves `false` when no opener could be started. */
export function openBrowser(url: string, platform: NodeJS.Platform = process.platform): Promise<boolean> {
  const { command, args } = openerCommand(url, platform)
  return new Promise(resolve => {
    let child
    try {
      child = spawn(command, args, { stdio: 'ignore', detached: platform !== 'win32' })
    } catch {
      resolve(false)
      return
    }
    child.once('error', () => resolve(false))
    child.once('spawn', () => { child.unref(); resolve(true) })
  })
}
