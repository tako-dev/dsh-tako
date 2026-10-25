/**
 * Constants and helpers shared by the Cordis plugin and the `dsh-tako` CLI.
 * Free of runtime imports so the CLI loads without the plugin's peers.
 * @module dsh-tako/shared
 */

/** Id of the plugin row the bundle patch inserts (`- id: tako`). */
export const PLUGIN_ROW_ID = 'tako'
export const DEFAULT_BASE_URL = 'https://tako.shiroha.tech'
export const DEFAULT_API_KEY_ENV = 'TAKO_API_KEY'
/** The profile the README installs into. */
export const DEFAULT_PROFILE = 'web'

/** Strip trailing slashes and one `/v1` so both spellings of the origin work. */
export function normalizeOrigin(baseURL: string): string {
  const trimmed = baseURL.trim().replace(/\/+$/, '')
  return trimmed.endsWith('/v1') ? trimmed.slice(0, -3) : trimmed
}

/** The plugin settings the CLI reads from a profile. */
export interface ProfilePluginConfig {
  baseURL: string
  apiKeyEnv: string
  /** Whether the profile's patch has a `- id: tako` row with a `config`. */
  fromProfile: boolean
}

type Entry = { id?: unknown, config?: unknown, insert?: unknown }

function* entries(value: unknown): Generator<Entry> {
  if (!Array.isArray(value)) return
  for (const item of value as unknown[]) {
    if (item === null || typeof item !== 'object') continue
    const entry = item as Entry
    yield entry
    // Bundle-style patches nest rows under `insert:`.
    if (Array.isArray(entry.insert)) yield* entries(entry.insert)
  }
}

/**
 * The plugin's `baseURL` / `apiKeyEnv` from a parsed profile patch
 * (`$DSH_HOME/profiles/<name>/cordis.patch.yml`), with the plugin defaults
 * for anything the patch does not set.
 */
export function pluginConfigFromPatch(patch: unknown): ProfilePluginConfig {
  let found: Record<string, unknown> | undefined
  for (const entry of entries(patch)) {
    if (entry.id !== PLUGIN_ROW_ID) continue
    if (entry.config !== null && typeof entry.config === 'object') found = { ...found, ...entry.config as Record<string, unknown> }
    else found ??= {}
  }
  const baseURL = typeof found?.baseURL === 'string' && found.baseURL.trim() !== '' ? found.baseURL : DEFAULT_BASE_URL
  const apiKeyEnv = typeof found?.apiKeyEnv === 'string' && found.apiKeyEnv.trim() !== '' ? found.apiKeyEnv.trim() : DEFAULT_API_KEY_ENV
  return { baseURL, apiKeyEnv, fromProfile: found !== undefined }
}
