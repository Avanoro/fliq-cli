import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import type { FliqClient } from './api/client.js'
import { FliqApiError } from './api/client.js'
import { DemoClient } from './api/demo.js'
import { HttpClient } from './api/http.js'
import { exchangeApiKey, looksLikeApiKey } from './api/keyAuth.js'
import { buildMcpServer, MCP_SERVER_VERSION } from './mcp/server.js'

/**
 * Remote MCP server (Cloudflare Worker): the same tools as `fliq mcp`, served
 * over Streamable HTTP at `/mcp` so hosted clients (Claude.ai, ChatGPT, Claude
 * Desktop connectors) can add it by URL.
 *
 * Two modes, decided per request by the `Authorization` header:
 *
 * - **A Fliq API key** (`Bearer fliq_ais_…`, minted on fliqpayments.com/ais) is
 *   traded at the site for a short-lived session, and the tools then read that
 *   person's real accounts through the API gateway. The Worker keeps nothing:
 *   no key, no session, no data, between requests.
 * - **No header** → the static demo account, so the server is useful to try
 *   without an account at all.
 *
 * A key that is present but rejected is an error, never a quiet fall back to
 * demo data: someone who supplied a credential must not be shown fixtures and
 * left to believe they are their own figures.
 *
 * OAuth (protected-resource metadata → the AIS environment) is the next step,
 * and is what hosted clients like Claude.ai need; it slots in beside this
 * without changing the tools. Either way the Worker stays a client of
 * fliq-public-api-v2, never a door into it.
 */

export interface Env {
  /** Optional: what `/` and `/health` report as the public endpoint. */
  PUBLIC_MCP_URL?: string
  /** Where an API key is exchanged for a session; defaults to the live site. */
  FLIQ_TOKEN_URL?: string
}

const MCP_PATH = '/mcp'

function cors(headers: Headers = new Headers()): Headers {
  headers.set('access-control-allow-origin', '*')
  headers.set('access-control-allow-methods', 'GET, POST, DELETE, OPTIONS')
  headers.set('access-control-allow-headers', 'content-type, accept, authorization, mcp-session-id, mcp-protocol-version, last-event-id')
  headers.set('access-control-expose-headers', 'mcp-session-id, mcp-protocol-version')
  headers.set('access-control-max-age', '86400')
  return headers
}

function withCors(response: Response): Response {
  const headers = cors(new Headers(response.headers))
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

function json(data: unknown, status = 200): Response {
  return withCors(new Response(JSON.stringify(data, null, 2), { status, headers: { 'content-type': 'application/json' } }))
}

/** The Fliq API key on this request, if the caller sent one. */
function presentedKey(request: Request): string | null {
  const header = request.headers.get('authorization') ?? ''
  const value = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : header.trim()
  return looksLikeApiKey(value) ? value : null
}

async function clientFor(request: Request, env: Env): Promise<FliqClient> {
  const key = presentedKey(request)
  if (!key) return new DemoClient()
  const mint = () => exchangeApiKey(key, { tokenUrl: env.FLIQ_TOKEN_URL })
  const session = await mint()
  return new HttpClient({ session, reauth: mint })
}

async function handleMcp(request: Request, env: Env): Promise<Response> {
  let client: FliqClient
  try {
    client = await clientFor(request, env)
  } catch (err) {
    // A supplied key that does not work is said out loud. Falling back to demo
    // here would hand someone fixtures under their own name.
    const status = err instanceof FliqApiError ? err.status : 401
    return json({ error: (err as Error)?.message ?? 'Key exchange failed', code: 'INVALID_KEY' }, status === 401 ? 401 : 502)
  }

  // Stateless: no session id, one server per request, nothing retained. Plain
  // JSON responses rather than SSE — every tool answers in one shot, and a
  // buffered body is the friendliest thing for proxies and edge runtimes.
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })
  const server = buildMcpServer(client)
  await server.connect(transport)
  return withCors(await transport.handleRequest(request))
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const publicUrl = env.PUBLIC_MCP_URL ?? `${url.origin}${MCP_PATH}`

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors() })
    }

    if (url.pathname === MCP_PATH || url.pathname === `${MCP_PATH}/`) {
      return handleMcp(request, env)
    }

    if (url.pathname === '/health') {
      // No mode here: it is decided per request by the Authorization header.
      return json({ status: 'ok', version: MCP_SERVER_VERSION, mcp: publicUrl })
    }

    if (url.pathname === '/') {
      return json({
        name: 'fliq MCP server',
        version: MCP_SERVER_VERSION,
        note: 'Read-only. Send a Fliq API key as `Authorization: Bearer fliq_ais_…` for your own accounts; without one you get static example data for a fictional person.',
        key: 'Create one under “Anslut dina verktyg” on https://fliqpayments.com/ais',
        mcp: publicUrl,
        tools: [
          'fliq_whoami',
          'fliq_list_accounts',
          'fliq_balance_summary',
          'fliq_list_sessions',
          'fliq_list_transactions',
          'fliq_list_payment_orders',
        ],
        cli: 'npx @fliqpayments/cli',
      })
    }

    return json({ error: 'Not found', mcp: publicUrl }, 404)
  },
}
