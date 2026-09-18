# fliq

Fliq Payments from the terminal, and as an MCP server for Claude, Cursor,
ChatGPT and any other MCP client. Connected bank accounts, balances,
transactions and Fliq payment history.

Works out of the box in **demo mode**: no sign-in, no network, a complete
example account ("Anna Andersson", three Swedbank accounts, 90 days of
transactions, a few Fliq payments). An **API key** switches it to your own
company — create one under "Anslut dina verktyg" on
[fliqpayments.com/ais](https://fliqpayments.com/ais).

```
$ npx @fliqpayments/cli accounts
demo mode: example data for “Anna Andersson”. Run `fliq login` to see your own accounts.

Konto      Produkt       IBAN                           Saldo         Id
─────      ───────       ────                           ─────         ──
Lönekonto  Personkonto   SE93 0139 1274 0000 0000 0000  45 230,00 kr  demo-3f9a1c2e7b4d-0
Sparande   Sparkonto     SE93 0239 1274 0000 0000 0000  128 500,00 kr demo-3f9a1c2e7b4d-1
Buffert    Kapitalkonto  SE93 0339 1274 0000 0000 0000  8 750,00 kr   demo-3f9a1c2e7b4d-2
```

## Install

```sh
npm install -g @fliqpayments/cli        # or: npx @fliqpayments/cli <command>
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
| `fliq login --key fliq_ais_…` | sign in with an API key from fliqpayments.com/ais |
| `fliq login [email]` | sign in with email + one-time code instead |
| `fliq logout` | forget the session, back to demo mode |
| `fliq mcp` | run as an MCP server over stdio |

Every command takes `--json` for machine-readable output and `--demo` to force
the example account.

## Use it from an AI assistant (MCP)

```sh
# Claude Code
claude mcp add fliq --env FLIQ_API_KEY=fliq_ais_… -- npx -y @fliqpayments/cli mcp

# Claude Desktop, Cursor, Windsurf … (JSON config)
{
  "mcpServers": {
    "fliq": {
      "command": "npx",
      "args": ["-y", "@fliqpayments/cli", "mcp"],
      "env": { "FLIQ_API_KEY": "fliq_ais_…" }
    }
  }
}
```

Leave `FLIQ_API_KEY` out and the assistant gets the example account instead.

Tools: `fliq_whoami`, `fliq_list_accounts`, `fliq_balance_summary`,
`fliq_list_sessions`, `fliq_list_transactions`, `fliq_list_payment_orders`.
All read-only. There is deliberately no tool for connecting a bank, renewing a
consent or sending money; those happen in the Fliq app, with BankID, in your
own hands.

### Remote MCP server (no install)

The same tools are also served over Streamable HTTP from a Cloudflare Worker
(`src/worker.ts`, deployed as `fliq-mcp`), for clients that take a URL rather
than a command: Cursor, VS Code, Claude Code.

```
https://mcp.fliqpayments.com/mcp        # MCP endpoint (POST JSON-RPC)
https://mcp.fliqpayments.com/health     # liveness + version
```

Which account it serves is decided **per request** by the `Authorization`
header:

```
Authorization: Bearer fliq_ais_…    → your own accounts
(no header)                          → the example account
```

A key that is present but rejected is an error, never a quiet fall back to the
example data — being shown fixtures under your own name would be worse than
being shown nothing.

The Worker keeps nothing between requests: no key, no session, no data. It
trades the key for a short-lived session at the site and then reads the API
gateway like any other client.

OAuth is the next step, and is what hosted clients such as Claude.ai need,
since they cannot send a custom header.

## Demo vs. your own data

| | demo (default) | live |
|---|---|---|
| How | nothing configured | `fliq login --key …`, `FLIQ_API_KEY`, or `fliq login <email>` |
| Data | static fixtures in `src/fixtures/demo.ts`, shaped exactly like the gateway's responses | `GET https://api.fliqpayments.com/v2/app/me/*` with a real session |
| Network | none | fliqpayments.com to exchange the key, then the API gateway |
| Secrets | none | the key (or session tokens) in `~/.config/fliq/credentials.json`, 0600; `%APPDATA%\fliq` on Windows |

A key is worth the same read access you have on the web page. Revoke it there
and every tool using it stops at once.

The CLI and MCP server are thin clients of the public API gateway. All
authentication, tenancy, rate limiting and audit logging stay in the gateway;
nothing here talks to a bank or holds a bank credential.

`fliq transactions` in live mode reads
`/me/accounts/{id}/transactions`. That endpoint takes `status=booked|pending|all`
and a `limit` up to 200 — this client still sends `settled|pending` and allows
up to 500, which is a mismatch to fix.

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

Deploys: the Worker goes out with `npx wrangler deploy` (live at
`mcp.fliqpayments.com`); Workers Builds is not wired to this repo. The
CLI is published to npm by hand for now.

Environment overrides: `FLIQ_API_KEY`, `FLIQ_DEMO=1`, `FLIQ_API_BASE`,
`FLIQ_API_PATH` (`v2`, `dev`), `FLIQ_TOKEN_URL`, `FLIQ_CONFIG_DIR`.
