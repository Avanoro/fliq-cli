import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import type { Session } from './api/http.js'
import { FliqApiError } from './api/client.js'

export interface LoginOptions {
  email: string
  apiBase: string
  apiPath: string
  /** Pre-supplied one-time code (non-interactive). Prompted for when omitted. */
  code?: string
  lang?: 'sv' | 'en'
  fetchImpl?: typeof fetch
}

interface SessionResponse {
  user?: { id?: string; email?: string }
  accessToken: string
  refreshToken: string
  /** Present when the account should run a non-default version path (e.g. `/dev`). */
  apiPath?: string
}

/**
 * Email + one-time code, the same Magic Auth flow the mobile app uses:
 * `POST /app/auth/magic/send` mails a code, `POST /app/auth/magic/verify`
 * exchanges it for a WorkOS session. No password, nothing to store but the
 * resulting tokens. BankID is never involved here; that is the bank's own
 * consent flow and always happens in a browser.
 */
export async function login(options: LoginOptions): Promise<Session> {
  const fetchImpl = options.fetchImpl ?? fetch.bind(globalThis)
  const base = `${options.apiBase.replace(/\/$/, '')}/${options.apiPath.replace(/^\/+|\/+$/g, '')}/app/auth`
  const email = options.email.trim().toLowerCase()

  const sent = await fetchImpl(`${base}/magic/send`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, lang: options.lang ?? 'sv' }),
  })
  if (!sent.ok) {
    const body = (await sent.json().catch(() => ({}))) as { error?: string; code?: string }
    throw new FliqApiError(body.error ?? `Could not send code (HTTP ${sent.status})`, sent.status, body.code)
  }

  let code = options.code?.trim()
  if (!code) {
    const rl = createInterface({ input: stdin, output: stdout })
    try {
      code = (await rl.question(`Code sent to ${email}. Enter it: `)).trim()
    } finally {
      rl.close()
    }
  }
  if (!code) throw new FliqApiError('No code entered', 400, 'NO_CODE')

  const verified = await fetchImpl(`${base}/magic/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, code }),
  })
  if (!verified.ok) {
    const body = (await verified.json().catch(() => ({}))) as { error?: string; code?: string }
    throw new FliqApiError(body.error ?? `Login failed (HTTP ${verified.status})`, verified.status, body.code)
  }
  const data = (await verified.json()) as SessionResponse
  return {
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
    apiBase: options.apiBase,
    apiPath: (data.apiPath ?? options.apiPath).replace(/^\/+/, ''),
    email: data.user?.email ?? email,
  }
}
