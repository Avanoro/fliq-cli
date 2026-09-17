# fliq

Fliq Payments from the terminal, and as an MCP server for Claude, Cursor,
ChatGPT and any other MCP client. Connected bank accounts, balances,
transactions and Fliq payment history.

Works out of the box in **demo mode**: no login, no network, a complete
example account ("Anna Andersson", three Swedbank accounts, 90 days of
transactions, a few Fliq payments). `fliq login` switches to your own account.

```
$ npx @fliq/cli accounts
demo mode: example data for “Anna Andersson”. Run `fliq login` to see your own accounts.

Konto      Produkt       IBAN                           Saldo         Id
─────      ───────       ────                           ─────         ──
Lönekonto  Personkonto   SE93 0139 1274 0000 0000 0000  45 230,00 kr  demo-3f9a1c2e7b4d-0
Sparande   Sparkonto     SE93 0239 1274 0000 0000 0000  128 500,00 kr demo-3f9a1c2e7b4d-1
Buffert    Kapitalkonto  SE93 0339 1274 0000 0000 0000  8 750,00 kr   demo-3f9a1c2e7b4d-2
```

## Install

```sh
npm install -g @fliq/cli        # or: npx @fliq/cli <command>
```

Requires Node 20 or later.

## Commands

| Command | What it shows |
|---|---|
| `fliq whoami` | who you are, demo or live, banks and accounts |
| `fliq accounts` | connected accounts with available balance |
| `fliq balances` | balance per account and totals |
| `fliq sessions` | connected banks and days left on each PSD2 consent |
| `fliq transactions [account]` | transactions for one account (id, IBAN or name). `--from`, `--to`, `--pending`, `-n`, `--cursor` |
| `fliq payments` | Fliq payment orders sent and received |
| `fliq login [email]` | sign in with email + one-time code |
| `fliq logout` | forget the session, back to demo mode |
| `fliq mcp` | run as an MCP server over stdio |

Every command takes `--json` for machine-readable output and `--demo` to force
the example account.

## Use it from an AI assistant (MCP)

```sh
# Claude Code
claude mcp add fliq -- npx -y @fliq/cli mcp

# Claude Desktop, Cursor, Windsurf … (JSON config)
{
  "mcpServers": {
    "fliq": { "command": "npx", "args": ["-y", "@fliq/cli", "mcp"] }
  }
}
```

Tools: `fliq_whoami`, `fliq_list_accounts`, `fliq_balance_summary`,
`fliq_list_sessions`, `fliq_list_transactions`, `fliq_list_payment_orders`.
All read-only. There is deliberately no tool for connecting a bank, renewing a
consent or sending money; those happen in the Fliq app, with BankID, in your
own hands.

### Remote MCP server (no install)

The same tools are also served over Streamable HTTP from a Cloudflare Worker
(`src/worker.ts`, deployed as `fliq-mcp`), for clients that take a URL rather
than a command: Claude.ai and Claude Desktop connectors, ChatGPT, Cursor.

```
https://<worker-url>/mcp        # MCP endpoint (POST JSON-RPC)
https://<worker-url>/health     # liveness + version
```

The remote server is **demo mode only** for now: no login, stateless, nothing
stored, nothing fetched upstream. Live mode will arrive as OAuth (protected
resource metadata pointing at Fliq's identity provider) whose bearer the Worker
forwards unchanged to the API gateway. The Worker stays a client of the
gateway, never a door into it.

## Demo vs. live

| | demo (default) | live (after `fliq login`) |
|---|---|---|
| Data | static fixtures in `src/fixtures/demo.ts`, shaped exactly like the gateway's responses | `GET https://api.fliqpayments.com/v2/app/me/*` with your WorkOS session |
| Network | none | the Fliq API gateway only |
| Secrets | none | your session tokens in `~/.config/fliq/credentials.json` (0600); `%APPDATA%\fliq` on Windows |

The CLI and MCP server are thin clients of the public API gateway. All
authentication, tenancy, rate limiting and audit logging stay in the gateway;
nothing here talks to a bank or holds a bank credential.

`fliq transactions` in live mode needs the transactions endpoint
(`/me/accounts/{id}/transactions`), which is on account-worker's
`feat/transactions` branch and not deployed everywhere yet. The CLI says so
instead of failing silently.

## Develop

```sh
npm install
npm run build
npm test                    # builds, then node --test
npm run typecheck           # Node build + Worker entry
node bin/fliq.js accounts
node bin/fliq.js mcp        # speaks MCP on stdin/stdout
npm run worker:dev          # remote MCP server on http://127.0.0.1:8787/mcp
```

Deploys: the Worker is deployed by Cloudflare Workers Builds from this repo
(push to `main`), using `wrangler.jsonc`. The CLI is published to npm by hand
for now.

Environment overrides: `FLIQ_DEMO=1`, `FLIQ_API_BASE`, `FLIQ_API_PATH` (`v2`,
`dev`), `FLIQ_CONFIG_DIR`.
