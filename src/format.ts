import type { Account, Balance, BankSession, PaymentOrder, Transaction } from './api/types.js'

const sek = new Intl.NumberFormat('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** `4523000` → `45 230,00 kr`; other currencies get their ISO code. */
export function money(minor: number, currency = 'SEK'): string {
  const value = sek.format(minor / 100)
  return currency === 'SEK' ? `${value} kr` : `${value} ${currency}`
}

export function signedMoney(minor: number, currency = 'SEK'): string {
  const abs = money(Math.abs(minor), currency)
  return minor < 0 ? `−${abs}` : `+${abs}`
}

/** IBAN in groups of four for humans. */
export function iban(value: string | null | undefined): string {
  if (!value) return '–'
  return value.replace(/(.{4})/g, '$1 ').trim()
}

export function availableBalance(account: Account): Balance | undefined {
  return account.balances.find((b) => b.balanceType === 'ITAV') ?? account.balances[0]
}

export function daysUntil(iso: string, now = new Date()): number {
  return Math.ceil((new Date(iso).getTime() - now.getTime()) / 86_400_000)
}

export function counterparty(tx: Transaction): string {
  return tx.creditorName ?? tx.debtorName ?? tx.remittanceInformation?.[0] ?? '–'
}

export function description(tx: Transaction): string {
  const text = tx.remittanceInformation?.join(' ') ?? ''
  const who = tx.creditorName ?? tx.debtorName
  return who && text && text !== who ? `${text} · ${who}` : text || who || '–'
}

type Column<T> = { header: string; value: (row: T) => string; align?: 'left' | 'right' }

/** Plain padded columns; wide enough for any terminal that shows 80 columns. */
export function table<T>(rows: T[], columns: Column<T>[]): string {
  const cells = rows.map((row) => columns.map((c) => c.value(row)))
  const widths = columns.map((c, i) => Math.max(c.header.length, ...cells.map((r) => [...r[i]].length)))
  const fmt = (values: string[]) =>
    values
      .map((v, i) => {
        const pad = widths[i] - [...v].length
        return columns[i].align === 'right' ? ' '.repeat(pad) + v : v + ' '.repeat(pad)
      })
      .join('  ')
      .trimEnd()
  return [fmt(columns.map((c) => c.header)), fmt(widths.map((w) => '─'.repeat(w))), ...cells.map(fmt)].join('\n')
}

export function accountsTable(accounts: Account[]): string {
  return table(accounts, [
    { header: 'Konto', value: (a) => a.details ?? a.product ?? a.accountId },
    { header: 'Produkt', value: (a) => a.product ?? '–' },
    { header: 'IBAN', value: (a) => iban(a.iban) },
    { header: 'Saldo', value: (a) => (availableBalance(a) ? money(availableBalance(a)!.valueMinor, a.currency ?? 'SEK') : '–'), align: 'right' },
    { header: 'Id', value: (a) => a.accountId },
  ])
}

export function sessionsTable(sessions: BankSession[], now = new Date()): string {
  return table(sessions, [
    { header: 'Bank', value: (s) => s.aspsp.name },
    { header: 'Land', value: (s) => s.aspsp.country },
    { header: 'Typ', value: (s) => (s.psuType === 'business' ? 'företag' : 'privat') },
    { header: 'Status', value: (s) => s.status },
    { header: 'Samtycke t.o.m.', value: (s) => s.validUntil.slice(0, 10) },
    { header: 'Dagar kvar', value: (s) => String(Math.max(0, daysUntil(s.validUntil, now))), align: 'right' },
  ])
}

export function transactionsTable(rows: Transaction[]): string {
  return table(rows, [
    { header: 'Datum', value: (t) => t.date },
    { header: 'Beskrivning', value: (t) => description(t) },
    { header: 'Belopp', value: (t) => signedMoney(t.amountMinor, t.currency), align: 'right' },
    { header: 'Status', value: (t) => (t.settled ? 'bokförd' : 'pågående') },
  ])
}

export function paymentOrdersTable(rows: PaymentOrder[], direction: 'sent' | 'received'): string {
  return table(rows, [
    { header: 'Datum', value: (o) => o.createdAt.slice(0, 10) },
    { header: direction === 'sent' ? 'Till' : 'Från', value: (o) => o.counterpart ?? '–' },
    { header: 'Referens', value: (o) => o.reference },
    { header: 'Belopp', value: (o) => money(o.amountMinor, o.currency), align: 'right' },
    { header: 'Status', value: (o) => paymentStatus(o.status) },
  ])
}

export function paymentStatus(code: string): string {
  switch (code) {
    case 'ACSC':
    case 'ACCC':
      return 'genomförd'
    case 'PDNG':
    case 'ACTC':
    case 'ACCP':
      return 'pågående'
    case 'RJCT':
      return 'avvisad'
    case 'CANC':
      return 'avbruten'
    default:
      return code
  }
}
