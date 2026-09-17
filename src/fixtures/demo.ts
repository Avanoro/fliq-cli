/**
 * Static demo data: the App Store review account ("Anna Andersson") as the
 * gateway would serve it, so the CLI and the MCP server work with no login.
 *
 * Shapes follow account-worker's `attach_demo_session` (three fake Swedbank
 * accounts: Lönekonto 45 230,00 · Sparande 128 500,00 · Buffert 8 750,00 SEK,
 * IBANs built the same way) and user-worker's document. Transactions and
 * payment orders are generated deterministically relative to today, so the
 * history always ends "now" and two runs on the same day give the same rows.
 *
 * Nothing here is real: no real person, bank, account or identifier.
 */

import type {
  Account,
  BankSession,
  PaymentOrdersResponse,
  Transaction,
  TransactionPage,
  TransactionQuery,
  User,
} from '../api/types.js'

export const DEMO_HOLDER = 'Anna Andersson'
export const DEMO_SESSION_ID = '3f9a1c2e7b4d'
export const DEMO_USER_ID = 'user_demo_anna_andersson'

/** Mirrors account-worker `demo_iban`: SE93 + (index, session digits) zero-padded to 20. */
export function demoIban(sessionId: string, index: number): string {
  const digits = sessionId.replace(/\D/g, '')
  let body = `${String(index).padStart(2, '0')}${digits}`.slice(0, 20)
  body = body.padEnd(20, '0')
  return `SE93${body}`
}

const PRODUCTS: ReadonlyArray<readonly [product: string, details: string, minor: number]> = [
  ['Personkonto', 'Lönekonto', 4_523_000],
  ['Sparkonto', 'Sparande', 12_850_000],
  ['Kapitalkonto', 'Buffert', 875_000],
]

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d)
  out.setUTCDate(out.getUTCDate() + n)
  return out
}

function startOfToday(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}

/** Small deterministic PRNG so amounts vary but never change between runs. */
function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0x100000000
  }
}

export function demoAccounts(now = new Date()): Account[] {
  const asOf = now.toISOString()
  return PRODUCTS.map(([product, details, minor], index) => {
    const iban = demoIban(DEMO_SESSION_ID, index + 1)
    return {
      accountId: `demo-${DEMO_SESSION_ID}-${index}`,
      ebAccountId: '',
      sessionId: DEMO_SESSION_ID,
      psuType: 'personal',
      iban,
      accountNumbers: [{ scheme: 'IBAN', value: iban }],
      clearingSystemMemberId: null,
      currency: 'SEK',
      name: DEMO_HOLDER,
      product,
      details,
      pushEnabled: false,
      transactionsEnabled: true,
      balances: [
        {
          valueMinor: minor,
          currency: 'SEK',
          balanceType: 'ITAV',
          name: 'Interim available',
          asOf,
        },
      ],
      upcomingPayments: [],
    }
  })
}

export function demoSessions(now = new Date()): BankSession[] {
  const authorized = addDays(now, -20)
  return [
    {
      sessionId: DEMO_SESSION_ID,
      aspsp: { name: 'Swedbank', country: 'SE', bic: 'SWEDSESS' },
      psuType: 'personal',
      sessionRef: 'demo-no-eb',
      status: 'active',
      authorizedAt: authorized.toISOString(),
      // A live PSD2 consent runs 90 days from authorization.
      validUntil: addDays(authorized, 90).toISOString(),
      lastRefreshAt: now.toISOString(),
    },
  ]
}

export function demoUser(now = new Date()): User {
  const accounts = demoAccounts(now)
  const created = addDays(now, -140)
  return {
    id: DEMO_USER_ID,
    schemaVersion: 4,
    createdAt: created.toISOString(),
    updatedAt: now.toISOString(),
    profile: {
      email: 'anna.andersson@example.se',
      name: DEMO_HOLDER,
      phoneNumber: '+46701234567',
      postalAddress: {
        streetName: 'Exempelgatan',
        buildingNumber: '12',
        postCode: '118 46',
        townName: 'Stockholm',
        country: 'SE',
      },
    },
    app: {
      locale: 'sv',
      theme: 'system',
      defaultAccountId: accounts[0].accountId,
      demo: true,
      fullTransactionHistory: false,
    },
    sessions: demoSessions(now),
    accounts,
  }
}

type Seed = {
  day: Date
  amountMinor: number
  counterpart: string
  text: string
  code: string
}

/** Recurring household pattern for the salary account, last 90 days. */
function salaryAccountSeeds(today: Date): Seed[] {
  const rand = rng(20260916)
  const seeds: Seed[] = []
  const from = addDays(today, -90)
  for (let d = new Date(from); d <= today; d = addDays(d, 1)) {
    const dom = d.getUTCDate()
    const dow = d.getUTCDay()
    const push = (amountMinor: number, counterpart: string, text: string, code: string) =>
      seeds.push({ day: new Date(d), amountMinor, counterpart, text, code })

    if (dom === 25) push(3_845_000, 'Nordlund Bygg AB', 'Lön', 'SALA')
    if (dom === 27) push(-985_000, 'Stockholmshem AB', 'Hyra', 'RENT')
    if (dom === 26) push(-200_000, 'Sparkonto', 'Överföring sparande', 'TRF')
    if (dom === 1) push(-44_900, 'SATS Sweden AB', 'Medlemskap', 'CARD')
    if (dom === 2) push(-64_000, 'Ellevio AB', 'Elnät', 'DD')
    if (dom === 3) push(-18_900, 'Folksam', 'Hemförsäkring', 'DD')
    if (dom === 12) push(-99_000, 'SL', 'Reskassa 30 dagar', 'CARD')
    if (dom === 15) push(-11_900, 'Spotify AB', 'Premium', 'CARD')
    if (dom === 20) push(-29_900, 'Tele2 Sverige AB', 'Mobilabonnemang', 'DD')
    if (dow === 6) push(-Math.round(65_000 + rand() * 75_000), 'ICA Maxi Lindhagen', 'Köp', 'CARD')
    if (dow === 3 && rand() < 0.7) push(-Math.round(12_000 + rand() * 30_000), 'Coop Hornstull', 'Köp', 'CARD')
    if (dow === 5 && rand() < 0.5) push(-Math.round(28_000 + rand() * 40_000), 'Systembolaget', 'Köp', 'CARD')
    if (rand() < 0.12) push(-Math.round(3_500 + rand() * 9_000), 'Pressbyrån', 'Köp', 'CARD')
    if (rand() < 0.08) push(-Math.round(15_000 + rand() * 40_000), 'Apotek Hjärtat', 'Köp', 'CARD')
    if (rand() < 0.1) {
      const friends = ['Erik Lund', 'Maria Berg', 'Sara Nilsson', 'Johan Ek']
      const who = friends[Math.floor(rand() * friends.length)]
      const incoming = rand() < 0.45
      const amount = Math.round(10_000 + rand() * 60_000)
      push(incoming ? amount : -amount, who, incoming ? 'Swish från' : 'Swish till', 'P2P')
    }
  }
  // Always one card purchase from today, so there is a pending (unsettled) row
  // to look at whatever weekday it is.
  seeds.push({ day: new Date(today), amountMinor: -31_200, counterpart: 'ICA Nära Hornstull', text: 'Köp', code: 'CARD' })
  return seeds
}

function savingsAccountSeeds(today: Date): Seed[] {
  const seeds: Seed[] = []
  const from = addDays(today, -90)
  for (let d = new Date(from); d <= today; d = addDays(d, 1)) {
    const dom = d.getUTCDate()
    if (dom === 26) seeds.push({ day: new Date(d), amountMinor: 200_000, counterpart: 'Personkonto', text: 'Överföring sparande', code: 'TRF' })
    if (dom === 30 && (d.getUTCMonth() % 3 === 2)) {
      seeds.push({ day: new Date(d), amountMinor: 41_200, counterpart: 'Swedbank', text: 'Ränta', code: 'INT' })
    }
  }
  return seeds
}

function bufferAccountSeeds(today: Date): Seed[] {
  return [
    { day: addDays(today, -63), amountMinor: -320_000, counterpart: 'Mekonomen Sundbyberg', text: 'Bilservice', code: 'CARD' },
    { day: addDays(today, -40), amountMinor: 150_000, counterpart: 'Personkonto', text: 'Påfyllning buffert', code: 'TRF' },
    { day: addDays(today, -8), amountMinor: -129_000, counterpart: 'Folktandvården', text: 'Tandläkare', code: 'CARD' },
  ]
}

function toTransaction(accountId: string, seed: Seed, order: number, settled: boolean, now: Date): Transaction {
  const day = isoDay(seed.day)
  const credit = seed.amountMinor > 0
  const seenAt = new Date(seed.day)
  seenAt.setUTCHours(6 + (order % 12), (order * 7) % 60, 0, 0)
  const amount = (Math.abs(seed.amountMinor) / 100).toFixed(2)
  const tx: Transaction = {
    transactionId: `tx-${accountId.slice(-1)}-${day.replace(/-/g, '')}-${String(order).padStart(2, '0')}`,
    date: day,
    settled,
    intradayOrder: order,
    amountMinor: seed.amountMinor,
    currency: 'SEK',
    firstSeenAt: seenAt.toISOString(),
    updatedAt: (settled ? seenAt : now).toISOString(),
    status: settled ? 'BOOK' : 'PDNG',
    creditDebitIndicator: credit ? 'CRDT' : 'DBIT',
    bookingDate: settled ? day : undefined,
    valueDate: day,
    transactionAmount: { amount, currency: 'SEK' },
    remittanceInformation: [seed.text === 'Swish från' || seed.text === 'Swish till' ? 'Swish' : seed.text],
    bankTransactionCode: { code: seed.code },
  }
  if (credit) tx.debtorName = seed.counterpart
  else tx.creditorName = seed.counterpart
  return tx
}

/** All demo transactions for one account, newest first. */
export function demoTransactions(accountId: string, now = new Date()): Transaction[] {
  const today = startOfToday(now)
  const accounts = demoAccounts(now)
  const index = accounts.findIndex((a) => a.accountId === accountId)
  if (index < 0) return []
  const seeds = index === 0 ? salaryAccountSeeds(today) : index === 1 ? savingsAccountSeeds(today) : bufferAccountSeeds(today)

  // Today's card purchases are still pending (unsettled), like a live feed.
  const rows: Transaction[] = []
  let currentDay = ''
  let order = 0
  for (const seed of seeds.sort((a, b) => a.day.getTime() - b.day.getTime())) {
    const day = isoDay(seed.day)
    if (day !== currentDay) {
      currentDay = day
      order = 0
    }
    order += 1
    const settled = !(day === isoDay(today) && seed.code === 'CARD')
    rows.push(toTransaction(accountId, seed, order, settled, now))
  }
  return rows.sort((a, b) => (a.date === b.date ? b.intradayOrder - a.intradayOrder : b.date.localeCompare(a.date)))
}

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 500

/** Filter and page like user-worker's `/transactions` query does. */
export function demoTransactionPage(accountId: string, query: TransactionQuery = {}, now = new Date()): TransactionPage {
  const all = demoTransactions(accountId, now)
  const filtered = all.filter((t) => {
    if (query.from && t.date < query.from) return false
    if (query.to && t.date > query.to) return false
    if (query.status === 'settled' && !t.settled) return false
    if (query.status === 'pending' && t.settled) return false
    return true
  })
  const limit = Math.min(Math.max(query.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT)
  const offset = query.cursor ? Number.parseInt(query.cursor, 10) || 0 : 0
  const page = filtered.slice(offset, offset + limit)
  const next = offset + limit < filtered.length ? String(offset + limit) : null
  const today = startOfToday(now)
  return {
    transactions: page,
    nextCursor: next,
    sync: {
      coveredFrom: isoDay(addDays(today, -90)),
      bookedThrough: isoDay(today),
      lastSyncAt: now.toISOString(),
      lastOutcome: 'ok',
    },
  }
}

export function demoPaymentOrders(now = new Date()): PaymentOrdersResponse {
  const today = startOfToday(now)
  const accounts = demoAccounts(now)
  const acct = accounts[0].accountId
  const at = (daysAgo: number, hour: number) => {
    const d = addDays(today, -daysAgo)
    d.setUTCHours(hour, 0, 0, 0)
    return d.toISOString()
  }
  return {
    paymentOrders: {
      sent: [
        {
          orderId: 'ord_7Q2mK9xVt3Pn8LwR1sYc',
          accountId: acct,
          amountMinor: 45_000,
          currency: 'SEK',
          status: 'ACSC',
          finalStatus: true,
          reference: 'Middag lördag',
          counterpart: 'Erik Lund',
          dueDate: null,
          createdAt: at(4, 20),
          updatedAt: at(4, 20),
        },
        {
          orderId: 'ord_3Hd8Fz2QbN6xTk4Vr9Ma',
          accountId: acct,
          amountMinor: 120_000,
          currency: 'SEK',
          status: 'ACSC',
          finalStatus: true,
          reference: 'Hyra sommarstugan, min del',
          counterpart: 'Sara Nilsson',
          dueDate: null,
          createdAt: at(19, 9),
          updatedAt: at(19, 9),
        },
        {
          orderId: 'ord_9Wc1Lp5RtY7uJq2Xz6Kb',
          accountId: acct,
          amountMinor: 32_000,
          currency: 'SEK',
          status: 'RJCT',
          finalStatus: true,
          reference: 'Biobiljetter',
          counterpart: 'Johan Ek',
          dueDate: null,
          createdAt: at(33, 18),
          updatedAt: at(33, 18),
        },
      ],
      received: [
        {
          orderId: 'ord_5Tn4Bv8KxQ2mZr7Lw3Yd',
          accountId: acct,
          amountMinor: 78_000,
          currency: 'SEK',
          status: 'PDNG',
          finalStatus: false,
          reference: 'Konsertbiljetter',
          counterpart: 'Maria Berg',
          dueDate: isoDay(addDays(today, 5)),
          createdAt: at(1, 12),
          updatedAt: at(1, 12),
        },
        {
          orderId: 'ord_2Rk6Xm3PdV9qL1sB8tHc',
          accountId: acct,
          amountMinor: 250_000,
          currency: 'SEK',
          status: 'ACSC',
          finalStatus: true,
          reference: 'Resa Göteborg',
          counterpart: 'Erik Lund',
          dueDate: null,
          createdAt: at(11, 15),
          updatedAt: at(10, 8),
        },
      ],
    },
  }
}
