import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Session } from './api/http.js'

export const DEFAULT_API_BASE = 'https://api.fliqpayments.com'
export const DEFAULT_API_PATH = 'v2'

/**
 * What is kept on disk between runs. Exactly one of the two credentials:
 *
 * - `apiKey` — a key from fliqpayments.com/ais. The durable one: sessions are
 *   minted from it on demand, so nothing else needs storing and revoking the
 *   key on the site is enough to cut this machine off.
 * - `accessToken` + `refreshToken` — an email sign-in, rotated in place.
 */
export interface StoredAuth {
  apiKey?: string
  accessToken?: string
  refreshToken?: string
  apiPath: string
  apiBase: string
  email?: string
}

/**
 * Where it lives: `$FLIQ_CONFIG_DIR`, else `%APPDATA%\fliq` on Windows, else
 * `$XDG_CONFIG_HOME/fliq` or `~/.config/fliq`. Written 0600 on POSIX. Only the
 * credential above is stored — never anything bank-related.
 */
export function configDir(): string {
  if (process.env.FLIQ_CONFIG_DIR) return process.env.FLIQ_CONFIG_DIR
  if (process.platform === 'win32' && process.env.APPDATA) return join(process.env.APPDATA, 'fliq')
  const xdg = process.env.XDG_CONFIG_HOME
  return join(xdg || join(homedir(), '.config'), 'fliq')
}

function credentialsPath(): string {
  return join(configDir(), 'credentials.json')
}

export async function loadAuth(): Promise<StoredAuth | null> {
  try {
    const raw = await readFile(credentialsPath(), 'utf8')
    const data = JSON.parse(raw) as Partial<StoredAuth>
    const hasKey = Boolean(data.apiKey)
    const hasSession = Boolean(data.accessToken && data.refreshToken)
    if (!hasKey && !hasSession) return null
    return {
      apiKey: data.apiKey,
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      apiPath: data.apiPath || DEFAULT_API_PATH,
      apiBase: data.apiBase || DEFAULT_API_BASE,
      email: data.email,
    }
  } catch {
    return null
  }
}

async function write(auth: StoredAuth): Promise<void> {
  await mkdir(configDir(), { recursive: true })
  const path = credentialsPath()
  await writeFile(path, JSON.stringify({ ...auth, savedAt: new Date().toISOString() }, null, 2), {
    mode: 0o600,
  })
  if (process.platform !== 'win32') await chmod(path, 0o600).catch(() => undefined)
}

/** Store an email sign-in. */
export async function saveSession(session: Session): Promise<void> {
  await write({
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    apiPath: session.apiPath,
    apiBase: session.apiBase,
    email: session.email,
  })
}

/** Store an API key. The session it mints is deliberately not written down. */
export async function saveApiKey(apiKey: string, session: Session): Promise<void> {
  await write({
    apiKey,
    apiPath: session.apiPath,
    apiBase: session.apiBase,
    email: session.email,
  })
}

export async function clearAuth(): Promise<boolean> {
  try {
    await rm(credentialsPath())
    return true
  } catch {
    return false
  }
}
