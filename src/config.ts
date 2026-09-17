import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Session } from './api/http.js'

export const DEFAULT_API_BASE = 'https://api.fliqpayments.com'
export const DEFAULT_API_PATH = 'v2'

/**
 * Where the session lives: `$FLIQ_CONFIG_DIR`, else `%APPDATA%\fliq` on
 * Windows, else `$XDG_CONFIG_HOME/fliq` or `~/.config/fliq`. Only the WorkOS
 * session tokens are stored (0600 on POSIX). Nothing bank-related ever is.
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

export async function loadSession(): Promise<Session | null> {
  try {
    const raw = await readFile(credentialsPath(), 'utf8')
    const data = JSON.parse(raw) as Partial<Session>
    if (!data.accessToken || !data.refreshToken) return null
    return {
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

export async function saveSession(session: Session): Promise<void> {
  await mkdir(configDir(), { recursive: true })
  const path = credentialsPath()
  await writeFile(path, JSON.stringify({ ...session, savedAt: new Date().toISOString() }, null, 2), {
    mode: 0o600,
  })
  if (process.platform !== 'win32') await chmod(path, 0o600).catch(() => undefined)
}

export async function clearSession(): Promise<boolean> {
  try {
    await rm(credentialsPath())
    return true
  } catch {
    return false
  }
}
