/**
 * Wire types for the consumer `/app/me/*` API served by fliq-public-api-v2.
 *
 * These mirror the Rust structs in user-worker (`src/domain.rs`,
 * `src/transactions.rs`) and account-worker, which serialise with
 * `rename_all = "camelCase"` — except the two enums below, which are
 * `snake_case`. Keep this file boring: it is the contract the demo fixtures
 * and the live client both have to satisfy.
 */

export type PsuType = 'personal' | 'business'

export type SessionStatus = 'active' | 'expired' | 'revoked' | 'reconnect_required'

export interface Balance {
  valueMinor: number
  currency: string
  /** ISO 20022 balance type, e.g. `ITAV` (interim available), `CLBD` (closing booked). */
  balanceType: string
  name: string
  asOf: string
}

export interface AccountNumber {
  scheme: string
  value: string
}

export interface ClearingSystemMemberId {
  clearingSystemId?: string | null
  memberId?: string | null
}

export interface UpcomingPayment {
  paymentId: string
  amountMinor: number
  currency: string
  dueDate: string
  merchantName?: string | null
  status?: string | null
}

export interface Account {
  accountId: string
  ebAccountId: string
  sessionId: string
  psuType: PsuType
  iban?: string | null
  accountNumbers: AccountNumber[]
  clearingSystemMemberId?: ClearingSystemMemberId | null
  currency?: string | null
  /** Account holder name as the bank reports it. */
  name?: string | null
  product?: string | null
  details?: string | null
  pushEnabled: boolean
  transactionsEnabled?: boolean
  balances: Balance[]
  upcomingPayments: UpcomingPayment[]
}

export interface Aspsp {
  name: string
  country: string
  bic?: string
}

export interface BankSession {
  sessionId: string
  aspsp: Aspsp
  psuType: PsuType
  /** Opaque reference into account-worker's encrypted session store. Never a credential. */
  sessionRef: string
  status: SessionStatus
  authorizedAt: string
  /** PSD2 consent expiry (90 days from authorization for a live bank). */
  validUntil: string
  lastRefreshAt?: string
}

export interface PostalAddress {
  streetName?: string | null
  buildingNumber?: string | null
  postCode?: string | null
  townName?: string | null
  country?: string | null
}

export interface Profile {
  email?: string | null
  name?: string | null
  phoneNumber?: string | null
  postalAddress?: PostalAddress | null
}

export interface AppSettings {
  locale?: 'sv' | 'en' | null
  theme?: 'light' | 'dark' | 'system' | null
  defaultAccountId?: string | null
  /** App Store review rail: fake bank sessions, no Enable Banking. */
  demo?: boolean
  fullTransactionHistory?: boolean
}

export interface User {
  id: string
  schemaVersion: number
  createdAt: string
  updatedAt: string
  profile: Profile
  app: AppSettings
  sessions: BankSession[]
  accounts: Account[]
}

/** One Fliq payment order (P2P request or send) as the user document records it. */
export interface PaymentOrder {
  orderId: string
  accountId: string
  amountMinor: number
  currency: string
  /** ISO 20022 payment status code, e.g. `ACSC`, `PDNG`, `RJCT`. */
  status: string
  finalStatus: boolean
  reference: string
  counterpart?: string | null
  dueDate?: string | null
  updatedAt: string
  createdAt: string
}

export interface PaymentOrdersResponse {
  paymentOrders: {
    sent: PaymentOrder[]
    received: PaymentOrder[]
  }
}

/**
 * One bank transaction. The first eight fields are what user-worker indexes;
 * everything else is passed through from the bank (Enable Banking shape).
 */
export interface Transaction {
  transactionId: string
  /** `yyyy-mm-dd` sort date. */
  date: string
  /** `true` once booked. Pending rows are volatile and may change or vanish. */
  settled: boolean
  intradayOrder: number
  amountMinor: number
  currency: string
  firstSeenAt: string
  updatedAt: string
  status?: 'BOOK' | 'PDNG'
  creditDebitIndicator?: 'CRDT' | 'DBIT'
  bookingDate?: string
  valueDate?: string
  creditorName?: string
  debtorName?: string
  remittanceInformation?: string[]
  bankTransactionCode?: { description?: string; code?: string }
  [extra: string]: unknown
}

export interface TransactionSyncState {
  coveredFrom?: string | null
  bookedThrough?: string | null
  lastSyncAt?: string | null
  lastOutcome?: string | null
}

export interface TransactionPage {
  transactions: Transaction[]
  nextCursor?: string | null
  sync: TransactionSyncState
}

export interface TransactionQuery {
  /** Inclusive `yyyy-mm-dd`. */
  from?: string
  /** Inclusive `yyyy-mm-dd`. */
  to?: string
  status?: 'settled' | 'pending'
  limit?: number
  cursor?: string
}
