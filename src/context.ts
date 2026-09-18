import type { FliqClient } from './api/client.js'
import { DemoClient } from './api/demo.js'
import { HttpClient } from './api/http.js'
import { exchangeApiKey } from './api/keyAuth.js'
import { DEFAULT_API_BASE, loadAuth, saveSession } from './config.js'

export interface ContextOptions {
  /** Force demo mode even when a credential is stored. */
  demo?: boolean
  /** Override the API base (e.g. a local `wrangler dev`). */
  apiBase?: string
  /** Override the version path (`v2`, `dev`, …). */
  apiPath?: string
  /** An API key from the caller — the MCP server passes the one its client sent. */
  apiKey?: string
}

/**
 * Pick the client, in this order:
 *
 *   1. `--demo` / `FLIQ_DEMO=1`      → the built-in example account
 *   2. an API key, from the caller, `FLIQ_API_KEY`, or the stored credential
 *   3. a stored email sign-in
 *   4. nothing signed in            → the example account again
 *
 * Both the CLI and the MCP server resolve here, so they always agree on what
 * "the current account" means.
 */
export async function resolveClient(options: ContextOptions = {}): Promise<FliqClient> {
  if (options.demo || process.env.FLIQ_DEMO === '1') return new DemoClient()

  const stored = await loadAuth()
  const key = options.apiKey ?? process.env.FLIQ_API_KEY ?? stored?.apiKey

  if (key) {
    // The key is the credential; the session is minted now and re-minted
    // whenever it expires, so nothing about it needs to survive this process.
    const mint = () => exchangeApiKey(key)
    const session = await mint()
    return new HttpClient({
      session: {
        ...session,
        apiBase: options.apiBase ?? process.env.FLIQ_API_BASE ?? session.apiBase,
        apiPath: options.apiPath ?? process.env.FLIQ_API_PATH ?? session.apiPath,
      },
      reauth: mint,
    })
  }

  if (!stored?.accessToken || !stored.refreshToken) return new DemoClient()
  return new HttpClient({
    session: {
      accessToken: stored.accessToken,
      refreshToken: stored.refreshToken,
      apiBase: options.apiBase ?? process.env.FLIQ_API_BASE ?? stored.apiBase ?? DEFAULT_API_BASE,
      apiPath: options.apiPath ?? process.env.FLIQ_API_PATH ?? stored.apiPath,
      email: stored.email,
    },
    onRefresh: saveSession,
  })
}
