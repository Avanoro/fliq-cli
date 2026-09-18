import type { FliqClient } from './client.js'
import { FliqApiError } from './client.js'
import type {
  Account,
  BankSession,
  PaymentOrdersResponse,
  TransactionPage,
  TransactionQuery,
  User,
} from './types.js'

export interface Session {
  accessToken: string
  /**
   * Absent in API-key mode: there is no refresh token to rotate, a fresh
   * session is minted by exchanging the key again (see `reauth`).
   */
  refreshToken?: string
  /** Version path the account runs, e.g. `v2` or `dev`. */
  apiPath: string
  apiBase: string
  email?: string
}

export interface HttpClientOptions {
  session: Session
  /** Called with the new session whenever one is minted. */
  onRefresh?: (session: Session) => Promise<void> | void
  /**
   * Mints a fresh session when the current one expires, instead of rotating a
   * refresh token. This is how API-key mode renews: the key is the durable
   * credential and the session is disposable.
   */
  reauth?: () => Promise<Session>
  fetchImpl?: typeof fetch
}

/**
 * The real thing: `GET {apiBase}/{apiPath}/app/me/*` on fliq-public-api-v2 with
 * the user's WorkOS session as a bearer. The gateway verifies the token and
 * forwards the identity to the workers; this client holds no other secret.
 *
 * A 401 triggers one renewal and one retry; a second 401 surfaces as an error
 * telling the user how to sign in again.
 */
export class HttpClient implements FliqClient {
  readonly mode = 'live' as const
  private session: Session
  private readonly onRefresh?: HttpClientOptions['onRefresh']
  private readonly reauth?: HttpClientOptions['reauth']
  /**
   * Bound to the global on purpose. `fetch` is a native function whose receiver
   * must be the global object: stored on an instance and called as
   * `this.fetchImpl(...)` it arrives with that instance as `this`, and workerd
   * answers "Illegal invocation". Node's fetch does not check, which is why this
   * ran for months in the CLI and failed the moment the same code served a
   * tools/call on the Worker.
   */
  private readonly fetchImpl: typeof fetch

  constructor(options: HttpClientOptions) {
    this.session = options.session
    this.onRefresh = options.onRefresh
    this.reauth = options.reauth
    this.fetchImpl = options.fetchImpl ?? fetch.bind(globalThis)
  }

  get label() {
    const who = this.session.email ? ` as ${this.session.email}` : ''
    return `${this.session.apiBase}/${this.session.apiPath}${who}`
  }

  getMe() {
    return this.get<User>('/app/me')
  }

  listAccounts() {
    return this.get<Account[]>('/app/me/accounts')
  }

  listSessions() {
    return this.get<BankSession[]>('/app/me/sessions')
  }

  listPaymentOrders() {
    return this.get<PaymentOrdersResponse>('/app/me/payment-orders')
  }

  listTransactions(accountId: string, query: TransactionQuery = {}) {
    const params = new URLSearchParams()
    if (query.from) params.set('from', query.from)
    if (query.to) params.set('to', query.to)
    if (query.status) params.set('status', query.status)
    if (query.limit) params.set('limit', String(query.limit))
    if (query.cursor) params.set('cursor', query.cursor)
    const qs = params.size ? `?${params}` : ''
    return this.get<TransactionPage>(`/app/me/accounts/${encodeURIComponent(accountId)}/transactions${qs}`)
  }

  private url(path: string): string {
    return `${this.session.apiBase.replace(/\/$/, '')}/${this.session.apiPath.replace(/^\/+|\/+$/g, '')}${path}`
  }

  private async get<T>(path: string, retried = false): Promise<T> {
    const response = await this.fetchImpl(this.url(path), {
      headers: {
        authorization: `Bearer ${this.session.accessToken}`,
        accept: 'application/json',
        'user-agent': 'fliq-cli',
      },
    })
    if (response.status === 401 && !retried) {
      await this.refresh()
      return this.get<T>(path, true)
    }
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string; code?: string }
      if (response.status === 404 && path.includes('/transactions')) {
        throw new FliqApiError(
          'Transactions are not served by this API path yet (account-worker feat/transactions is not deployed here).',
          404,
          body.code ?? 'TRANSACTIONS_UNAVAILABLE',
        )
      }
      throw new FliqApiError(body.error ?? `HTTP ${response.status}`, response.status, body.code)
    }
    return (await response.json()) as T
  }

  private async refresh(): Promise<void> {
    // API-key mode: mint a new session from the key rather than rotate a token.
    if (this.reauth) {
      this.session = await this.reauth()
      await this.onRefresh?.(this.session)
      return
    }
    if (!this.session.refreshToken) {
      throw new FliqApiError('Session expired. Run `fliq login` again.', 401, 'SESSION_EXPIRED')
    }
    const response = await this.fetchImpl(this.url('/app/auth/refresh'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ refreshToken: this.session.refreshToken }),
    })
    if (!response.ok) {
      throw new FliqApiError('Session expired. Run `fliq login` again.', 401, 'SESSION_EXPIRED')
    }
    const data = (await response.json()) as {
      accessToken: string
      refreshToken: string
      apiPath?: string
      user?: { email?: string }
    }
    this.session = {
      ...this.session,
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      apiPath: data.apiPath ? data.apiPath.replace(/^\/+/, '') : this.session.apiPath,
      email: data.user?.email ?? this.session.email,
    }
    await this.onRefresh?.(this.session)
  }
}
