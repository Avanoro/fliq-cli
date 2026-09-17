import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { ContextOptions } from './context.js'
import { resolveClient } from './context.js'
import { buildMcpServer } from './mcp/server.js'

export { buildMcpServer } from './mcp/server.js'

/** `fliq mcp`: the tool surface over stdio, for local MCP clients. */
export async function startMcpServer(options: ContextOptions = {}): Promise<void> {
  const client = await resolveClient(options)
  const server = buildMcpServer(client)
  const transport = new StdioServerTransport()
  await server.connect(transport)
  // stdout is the protocol channel; anything for humans goes to stderr.
  process.stderr.write(`fliq mcp: ready (${client.mode})\n`)
}
