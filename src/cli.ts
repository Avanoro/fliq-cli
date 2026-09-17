import { Command, Option } from 'commander'
import { FliqApiError } from './api/client.js'
import type { FliqClient } from './api/client.js'
import type { Account, TransactionQuery } from './api/types.js'
import { login } from './auth.js'
import { clearSession, configDir, DEFAULT_API_BASE, DEFAULT_API_PATH, loadSession, saveSession } from './config.js'
import { resolveClient } from './context.js'
import {
  accountsTable,
  availableBalance,
  money,
  paymentOrdersTable,
  sessionsTable,
  table,
  transactionsTable,
} from './format.js'
import { startMcpServer } from './mcp.js'

const VERSION = '0.1.0'

type GlobalOptions = { json?: boolean; demo?: boolean; api?: string; path?: string }

const program = new Command()
  .name('fliq')
  .description('Fliq Payments from the terminal: accounts, balances, transactions and payment history.')
  .version(VERSION)
  .option('--json', 'machine-readable output')
  .option('--demo', 'use the built-in example account even if you are logged in')
  .addOption(new Option('--api <base>', 'API base URL').env('FLIQ_API_BASE').hideHelp())
  .addOption(new Option('--path <apiPath>', 'API version path (v2, dev)').env('FLIQ_API_PATH').hideHelp())
  .showHelpAfterError()

function globals(cmd: Command): GlobalOptions {
  return cmd.optsWithGlobals<GlobalOptions>()
}

async function client(cmd: Command): Promise<FliqClient> {
  const g = globals(cmd)
  const c = await resolveClient({ demo: g.demo, apiBase: g.api, apiPath: g.path })
  if (c.mode === 'demo' && !g.json && process.stderr.isTTY) {
    process.stderr.write('demo mode: example data for “Anna Andersson”. Run `fliq login` to see your own accounts.\n\n')
  }
  return c
}

function out(cmd: Command, data: unknown, human: () => string): void {
  if (globals(cmd).json) process.stdout.write(JSON.stringify(data, null, 2) + '\n')
  else process.stdout.write(human() + '\n')
}

async function pickAccount(c: FliqClient, accountId?: string): Promise<Account> {
  const accounts = await c.listAccounts()
  if (accounts.length === 0) throw new FliqApiError('No bank accounts connected yet.', 404, 'NO_ACCOUNTS')
  if (!accountId) {
    const me = await c.getMe().catch(() => null)
    return accounts.find((a) => a.accountId === me?.app.defaultAccountId) ?? accounts[0]
  }
  const hit =
    accounts.find((a) => a.accountId === accountId) ??
    accounts.find((a) => a.iban?.replace(/\s/g, '') === accountId.replace(/\s/g, '').toUpperCase()) ??
    accounts.find((a) => (a.details ?? '').toLowerCase() === accountId.toLowerCase()) ??
    accounts.find((a) => (a.product ?? '').toLowerCase() === accountId.toLowerCase())
  if (!hit) throw new FliqApiError(`No account matches “${accountId}”. Run \`fliq accounts\` to list them.`, 404, 'ACCOUNT_NOT_FOUND')
  return hit
}

program
  .command('whoami')
  .description('who you are logged in as, and which API this talks to')
  .action(async (_opts, cmd: Command) => {
    const c = await client(cmd)
    const me = await c.getMe()
    out(cmd, { mode: c.mode, target: c.label, user: me }, () =>
      [
        `${me.profile.name ?? '–'} <${me.profile.email ?? '–'}>`,
        `mode:     ${c.mode}`,
        `target:   ${c.label}`,
        `banks:    ${me.sessions.length}   accounts: ${me.accounts.length}`,
      ].join('\n'),
    )
  })

program
  .command('accounts')
  .description('connected bank accounts with available balance')
  .action(async (_opts, cmd: Command) => {
    const c = await client(cmd)
    const accounts = await c.listAccounts()
    out(cmd, accounts, () => accountsTable(accounts))
  })

program
  .command('balances')
  .description('balance per account and in total')
  .action(async (_opts, cmd: Command) => {
    const c = await client(cmd)
    const accounts = await c.listAccounts()
    const rows = accounts.map((a) => ({
      accountId: a.accountId,
      name: a.details ?? a.product ?? a.accountId,
      currency: a.currency ?? 'SEK',
      availableMinor: availableBalance(a)?.valueMinor ?? 0,
      asOf: availableBalance(a)?.asOf ?? null,
    }))
    const totals = rows.reduce<Record<string, number>>((acc, r) => {
      acc[r.currency] = (acc[r.currency] ?? 0) + r.availableMinor
      return acc
    }, {})
    out(cmd, { accounts: rows, totals }, () =>
      [
        table(rows, [
          { header: 'Konto', value: (r) => r.name },
          { header: 'Tillgängligt', value: (r) => money(r.availableMinor, r.currency), align: 'right' },
        ]),
        '',
        ...Object.entries(totals).map(([cur, minor]) => `Totalt ${cur}: ${money(minor, cur)}`),
      ].join('\n'),
    )
  })

program
  .command('sessions')
  .alias('banks')
  .description('connected banks and how long each PSD2 consent is valid')
  .action(async (_opts, cmd: Command) => {
    const c = await client(cmd)
    const sessions = await c.listSessions()
    out(cmd, sessions, () => (sessions.length ? sessionsTable(sessions) : 'No banks connected.'))
  })

program
  .command('transactions [account]')
  .alias('tx')
  .description('transactions for one account (default: your main account). Account = id, IBAN or name.')
  .option('--from <yyyy-mm-dd>', 'earliest date, inclusive')
  .option('--to <yyyy-mm-dd>', 'latest date, inclusive')
  .option('--pending', 'only pending (unsettled) rows')
  .option('--settled', 'only booked rows')
  .option('-n, --limit <n>', 'max rows', '50')
  .option('--cursor <cursor>', 'continue from a previous page')
  .action(async (account: string | undefined, opts, cmd: Command) => {
    const c = await client(cmd)
    const acct = await pickAccount(c, account)
    const query: TransactionQuery = {
      from: opts.from,
      to: opts.to,
      status: opts.pending ? 'pending' : opts.settled ? 'settled' : undefined,
      limit: Number.parseInt(opts.limit, 10) || 50,
      cursor: opts.cursor,
    }
    const page = await c.listTransactions(acct.accountId, query)
    out(cmd, { account: acct.accountId, ...page }, () => {
      const lines = [`${acct.details ?? acct.product} · ${acct.iban ?? acct.accountId}`, '', transactionsTable(page.transactions)]
      if (page.nextCursor) lines.push('', `more: fliq transactions ${acct.accountId} --cursor ${page.nextCursor}`)
      return lines.join('\n')
    })
  })

program
  .command('payments')
  .alias('payment-orders')
  .description('Fliq payment orders you have sent and received')
  .action(async (_opts, cmd: Command) => {
    const c = await client(cmd)
    const data = await c.listPaymentOrders()
    out(cmd, data, () =>
      [
        'Skickade',
        paymentOrdersTable(data.paymentOrders.sent, 'sent'),
        '',
        'Mottagna',
        paymentOrdersTable(data.paymentOrders.received, 'received'),
      ].join('\n'),
    )
  })

program
  .command('login [email]')
  .description('sign in with your email and a one-time code (no password)')
  .option('--code <code>', 'one-time code, for non-interactive use')
  .action(async (email: string | undefined, opts, cmd: Command) => {
    const g = globals(cmd)
    if (!email) {
      const { createInterface } = await import('node:readline/promises')
      const rl = createInterface({ input: process.stdin, output: process.stdout })
      try {
        email = (await rl.question('Email: ')).trim()
      } finally {
        rl.close()
      }
    }
    if (!email) throw new FliqApiError('An email address is required.', 400, 'NO_EMAIL')
    const session = await login({
      email,
      code: opts.code,
      apiBase: g.api ?? DEFAULT_API_BASE,
      apiPath: g.path ?? DEFAULT_API_PATH,
    })
    await saveSession(session)
    out(cmd, { status: 'logged_in', email: session.email, apiPath: session.apiPath }, () =>
      `Logged in as ${session.email} (API path /${session.apiPath}). Session stored in ${configDir()}.`,
    )
  })

program
  .command('logout')
  .description('forget the stored session and go back to demo mode')
  .action(async (_opts, cmd: Command) => {
    const had = await clearSession()
    out(cmd, { status: had ? 'logged_out' : 'not_logged_in' }, () => (had ? 'Logged out. Back in demo mode.' : 'Not logged in.'))
  })

program
  .command('status')
  .description('is a session stored, and where')
  .action(async (_opts, cmd: Command) => {
    const session = await loadSession()
    out(cmd, { loggedIn: Boolean(session), email: session?.email ?? null, apiPath: session?.apiPath ?? null, configDir: configDir() }, () =>
      session ? `Logged in as ${session.email} on /${session.apiPath} (${configDir()})` : `Not logged in — demo mode. Config dir: ${configDir()}`,
    )
  })

program
  .command('mcp')
  .description('run as an MCP server over stdio (for Claude, Cursor, ChatGPT and other MCP clients)')
  .action(async (_opts, cmd: Command) => {
    const g = globals(cmd)
    await startMcpServer({ demo: g.demo, apiBase: g.api, apiPath: g.path })
  })

program.parseAsync(process.argv).catch((err: unknown) => {
  const message = err instanceof FliqApiError ? `${err.message}${err.code ? ` [${err.code}]` : ''}` : (err as Error)?.message ?? String(err)
  process.stderr.write(`fliq: ${message}\n`)
  process.exitCode = 1
})
