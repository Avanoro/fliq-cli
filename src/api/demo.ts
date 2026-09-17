import type { FliqClient } from './client.js'
import { FliqApiError } from './client.js'
import type { TransactionQuery } from './types.js'
import {
  demoAccounts,
  demoPaymentOrders,
  demoSessions,
  demoTransactionPage,
  demoUser,
} from '../fixtures/demo.js'

/**
 * Static data, no network. This is the default when nobody has run
 * `fliq login`, so a fresh install (or an MCP client that has just added the
 * server) sees a complete, realistic account straight away.
 */
export class DemoClient implements FliqClient {
  readonly mode = 'demo' as const
  readonly label = 'demo mode — static example data (Anna Andersson), nothing is fetched'

  async getMe() {
    return demoUser()
  }

  async listAccounts() {
    return demoAccounts()
  }

  async listSessions() {
    return demoSessions()
  }

  async listPaymentOrders() {
    return demoPaymentOrders()
  }

  async listTransactions(accountId: string, query: TransactionQuery = {}) {
    if (!demoAccounts().some((a) => a.accountId === accountId)) {
      throw new FliqApiError(`Unknown account ${accountId}`, 404, 'ACCOUNT_NOT_FOUND')
    }
    return demoTransactionPage(accountId, query)
  }
}
