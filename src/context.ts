import type { FliqClient } from './api/client.js'
import { DemoClient } from './api/demo.js'
import { HttpClient } from './api/http.js'
import { DEFAULT_API_BASE, loadSession, saveSession } from './config.js'

export interface ContextOptions {
  /** Force demo mode even when a session is stored. */
  demo?: boolean
  /** Override the API base (e.g. a local `wrangler dev`). */
  apiBase?: string
  /** Override the version path (`v2`, `dev`, …). */
  apiPath?: string
}

/**
 * Pick the client: demo unless the user has logged in (or `--demo` forces it).
 * Both the CLI and the MCP server resolve their client here, so they always
 * agree on what "the current account" means.
 */
export async function resolveClient(options: ContextOptions = {}): Promise<FliqClient> {
  if (options.demo || process.env.FLIQ_DEMO === '1') return new DemoClient()
  const session = await loadSession()
  if (!session) return new DemoClient()
  const patched = {
    ...session,
    apiBase: options.apiBase ?? process.env.FLIQ_API_BASE ?? session.apiBase ?? DEFAULT_API_BASE,
    apiPath: options.apiPath ?? process.env.FLIQ_API_PATH ?? session.apiPath,
  }
  return new HttpClient({ session: patched, onRefresh: saveSession })
}
