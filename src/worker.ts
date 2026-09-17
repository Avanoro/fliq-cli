import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { DemoClient } from './api/demo.js'
import { buildMcpServer, MCP_SERVER_VERSION } from './mcp/server.js'

/**
 * Remote MCP server (Cloudflare Worker): the same tools as `fliq mcp`, served
 * over Streamable HTTP at `/mcp` so hosted clients (Claude.ai, ChatGPT, Claude
 * Desktop connectors) can add it by URL.
 *
 * v1 is demo mode only and therefore needs no auth: every request gets a fresh,
 * stateless server over the static fixtures. Nothing is stored between
 * requests and no upstream is called. When live mode arrives it slots in here
 * as OAuth (protected-resource metadata → WorkOS AuthKit) whose bearer is
 * forwarded unchanged to the API gateway — the Worker stays a client of
 * fliq-public-api-v2, never a door into it.
 */

export interface Env {
  /** Optional: what `/` and `/health` report as the public endpoint. */
  PUBLIC_MCP_URL?: string
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

async function handleMcp(request: Request): Promise<Response> {
  // Stateless: no session id, one server per request, nothing retained. Plain
  // JSON responses rather than SSE — every tool answers in one shot, and a
  // buffered body is the friendliest thing for proxies and edge runtimes.
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })
  const server = buildMcpServer(new DemoClient())
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
      return handleMcp(request)
    }

    if (url.pathname === '/health') {
      return json({ status: 'ok', version: MCP_SERVER_VERSION, mode: 'demo', mcp: publicUrl })
    }

    if (url.pathname === '/') {
      return json({
        name: 'fliq MCP server',
        version: MCP_SERVER_VERSION,
        mode: 'demo',
        note: 'Static example data for a fictional person (Anna Andersson). Read-only. Add the URL below to your MCP client.',
        mcp: publicUrl,
        tools: [
          'fliq_whoami',
          'fliq_list_accounts',
          'fliq_balance_summary',
          'fliq_list_sessions',
          'fliq_list_transactions',
          'fliq_list_payment_orders',
        ],
        cli: 'npx @fliq/cli',
      })
    }

    return json({ error: 'Not found', mcp: publicUrl }, 404)
  },
}
