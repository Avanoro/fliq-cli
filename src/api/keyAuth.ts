import { FliqApiError } from './client.js'
import type { Session } from './http.js'

/**
 * API-key sign-in.
 *
 * A key (`fliq_ais_…`, minted on fliqpayments.com/ais) is not a credential the
 * API gateway knows about. It is traded at the site for a normal, short-lived
 * session for its owner, and everything after that is the ordinary authenticated
 * path — the same one the web page and `fliq login` use. So the key is the
 * durable thing to store, sessions are disposable, and revoking the key on the
 * site stops this client dead.
 *
 * Nothing is cached to disk but the key itself: a session that expires is
 * replaced by exchanging again, which costs one request.
 */

export const DEFAULT_TOKEN_URL = 'https://fliqpayments.com/api/ais/token'

/** `fliq_ais_…`. Anything else is a typo, not a key, and is worth saying so early. */
export const API_KEY_PREFIX = 'fliq_ais_'

export function looksLikeApiKey(value: string | undefined | null): boolean {
  return typeof value === 'string' && value.trim().startsWith(API_KEY_PREFIX)
}

export interface ExchangeOptions {
  tokenUrl?: string
  fetchImpl?: typeof fetch
}

interface TokenResponse {
  accessToken: string
  expiresIn?: number
  apiBase?: string
  apiPath?: string
  user?: { email?: string | null }
}

/**
 * Trade a key for a session. The site decides which API the session is for
 * (`apiBase` / `apiPath`), so a key issued against a sandbox keeps working
 * there without the client being told separately.
 */
export async function exchangeApiKey(key: string, options: ExchangeOptions = {}): Promise<Session> {
  const trimmed = String(key || '').trim()
  if (!looksLikeApiKey(trimmed)) {
    throw new FliqApiError(
      `That does not look like a Fliq API key (they start with ${API_KEY_PREFIX}). Create one under "Anslut dina verktyg" on fliqpayments.com/ais.`,
      400,
      'INVALID_KEY_FORMAT',
    )
  }
  const fetchImpl = options.fetchImpl ?? fetch.bind(globalThis)
  const url = options.tokenUrl ?? process.env.FLIQ_TOKEN_URL ?? DEFAULT_TOKEN_URL

  let response: Response
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ key: trimmed }),
    })
  } catch (err) {
    throw new FliqApiError(`Could not reach ${url}: ${(err as Error)?.message ?? err}`, 503, 'TOKEN_URL_UNREACHABLE')
  }

  if (response.status === 401) {
    throw new FliqApiError(
      'That key is not valid any more. It may have been revoked or expired; create a new one on fliqpayments.com/ais.',
      401,
      'INVALID_KEY',
    )
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string; code?: string }
    throw new FliqApiError(body.error ?? `Key exchange failed (HTTP ${response.status})`, response.status, body.code)
  }

  const data = (await response.json()) as TokenResponse
  if (!data.accessToken) {
    throw new FliqApiError('Key exchange returned no session', 502, 'NO_SESSION')
  }
  return {
    accessToken: data.accessToken,
    apiBase: data.apiBase ?? 'https://api.fliqpayments.com',
    apiPath: (data.apiPath ?? 'v2').replace(/^\/+|\/+$/g, ''),
    email: data.user?.email ?? undefined,
  }
}
