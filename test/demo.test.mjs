import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import {
  DEMO_SESSION_ID,
  demoAccounts,
  demoIban,
  demoPaymentOrders,
  demoSessions,
  demoTransactionPage,
  demoTransactions,
  demoUser,
} from '../dist/fixtures/demo.js'
import { DemoClient } from '../dist/api/demo.js'

const bin = fileURLToPath(new URL('../bin/fliq.js', import.meta.url))
const run = (...args) =>
  JSON.parse(execFileSync(process.execPath, [bin, '--json', '--demo', ...args], { encoding: 'utf8', env: { ...process.env, FLIQ_CONFIG_DIR: 'test/.no-config' } }))

test('IBANs follow account-worker demo_iban (SE93 + 20 digits, unique per index)', () => {
  const a = demoIban(DEMO_SESSION_ID, 1)
  const b = demoIban(DEMO_SESSION_ID, 2)
  assert.equal(a.length, 24)
  assert.match(a, /^SE93\d{20}$/)
  assert.notEqual(a, b)
})

test('three accounts with the review-account balances, camelCase keys', () => {
  const accounts = demoAccounts()
  assert.equal(accounts.length, 3)
  assert.deepEqual(
    accounts.map((a) => a.balances[0].valueMinor),
    [4_523_000, 12_850_000, 875_000],
  )
  for (const a of accounts) {
    assert.equal(a.name, 'Anna Andersson')
    assert.equal(a.psuType, 'personal')
    assert.equal(a.balances[0].balanceType, 'ITAV')
    assert.ok('accountId' in a && !('account_id' in a))
  }
})

test('one active Swedbank session with a 90-day consent window', () => {
  const [s] = demoSessions()
  assert.equal(s.status, 'active')
  assert.equal(s.aspsp.name, 'Swedbank')
  const days = (new Date(s.validUntil) - new Date(s.authorizedAt)) / 86_400_000
  assert.equal(Math.round(days), 90)
})

test('user document points its default account at the salary account', () => {
  const me = demoUser()
  assert.equal(me.app.demo, true)
  assert.equal(me.app.defaultAccountId, me.accounts[0].accountId)
  assert.equal(me.sessions[0].sessionId, me.accounts[0].sessionId)
})

test('transactions: newest first, SEK, salary on the 25th, consistent sign fields', () => {
  const [salary] = demoAccounts()
  const rows = demoTransactions(salary.accountId)
  assert.ok(rows.length > 40, `expected a rich history, got ${rows.length}`)
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i - 1].date >= rows[i].date, 'sorted desc')
  for (const t of rows) {
    assert.equal(t.currency, 'SEK')
    assert.equal(t.creditDebitIndicator, t.amountMinor > 0 ? 'CRDT' : 'DBIT')
    assert.equal(t.status, t.settled ? 'BOOK' : 'PDNG')
    assert.equal(typeof t.transactionId, 'string')
  }
  const salaries = rows.filter((t) => t.remittanceInformation?.[0] === 'Lön')
  assert.ok(salaries.length >= 2)
  assert.ok(salaries.every((t) => t.date.endsWith('-25') && t.amountMinor === 3_845_000))
})

test('transaction paging and filters behave like the worker query', () => {
  const [salary] = demoAccounts()
  const first = demoTransactionPage(salary.accountId, { limit: 10 })
  assert.equal(first.transactions.length, 10)
  assert.equal(first.nextCursor, '10')
  const second = demoTransactionPage(salary.accountId, { limit: 10, cursor: first.nextCursor })
  assert.notEqual(first.transactions[0].transactionId, second.transactions[0].transactionId)
  const pending = demoTransactionPage(salary.accountId, { status: 'pending' })
  assert.ok(pending.transactions.length >= 1, 'today always has a pending card purchase')
  assert.ok(pending.transactions.every((t) => !t.settled && t.status === 'PDNG' && !t.bookingDate))
  const ranged = demoTransactionPage(salary.accountId, { from: '2000-01-01', to: '2000-01-31' })
  assert.equal(ranged.transactions.length, 0)
})

test('payment orders carry ISO 20022 statuses and final flags', () => {
  const { paymentOrders } = demoPaymentOrders()
  assert.equal(paymentOrders.sent.length, 3)
  assert.equal(paymentOrders.received.length, 2)
  const pending = paymentOrders.received.find((o) => o.status === 'PDNG')
  assert.equal(pending.finalStatus, false)
  assert.ok(paymentOrders.sent.every((o) => o.finalStatus))
})

test('DemoClient rejects an unknown account id', async () => {
  const client = new DemoClient()
  await assert.rejects(client.listTransactions('nope'), /Unknown account/)
})

test('CLI: --json output for accounts, balances and transactions', () => {
  const accounts = run('accounts')
  assert.equal(accounts.length, 3)
  const balances = run('balances')
  assert.equal(balances.totals.SEK, 4_523_000 + 12_850_000 + 875_000)
  const tx = run('transactions', 'Lönekonto', '-n', '5')
  assert.equal(tx.transactions.length, 5)
  assert.equal(tx.account, accounts[0].accountId)
  const who = run('whoami')
  assert.equal(who.mode, 'demo')
})
