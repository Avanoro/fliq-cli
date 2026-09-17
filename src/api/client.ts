import type {
  Account,
  BankSession,
  PaymentOrdersResponse,
  TransactionPage,
  TransactionQuery,
  User,
} from './types.js'

/**
 * What the CLI and the MCP server program against. Two implementations:
 * `DemoClient` (static fixtures, no network, no login) and `HttpClient` (the
 * real gateway with the user's own session). Both return the same shapes, so
 * everything above this line is mode-agnostic.
 */
export interface FliqClient {
  readonly mode: 'demo' | 'live'
  /** Human-readable description of what this client talks to. */
  readonly label: string
  getMe(): Promise<User>
  listAccounts(): Promise<Account[]>
  listSessions(): Promise<BankSession[]>
  listPaymentOrders(): Promise<PaymentOrdersResponse>
  listTransactions(accountId: string, query?: TransactionQuery): Promise<TransactionPage>
}

export class FliqApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message)
    this.name = 'FliqApiError'
  }
}
