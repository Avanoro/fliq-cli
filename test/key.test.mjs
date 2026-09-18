import assert from 'node:assert/strict'
import { test } from 'node:test'
import { exchangeApiKey, looksLikeApiKey, API_KEY_PREFIX } from '../dist/api/keyAuth.js'
import { HttpClient } from '../dist/api/http.js'

const KEY = `${API_KEY_PREFIX}AAAABBBBCCCCDDDD`
const TOKEN_URL = 'https://example.test/api/ais/token'

const ok = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
const err = (status, body = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

test('a key that is not one is refused before anything is sent', async () => {
  assert.equal(looksLikeApiKey('nope'), false)
  assert.equal(looksLikeApiKey(KEY), true)
  let called = false
  await assert.rejects(
    exchangeApiKey('nope', { tokenUrl: TOKEN_URL, fetchImpl: async () => { called = true; return ok({}) } }),
    /does not look like a Fliq API key/,
  )
  assert.equal(called, false, 'no request for something that cannot be a key')
})

test('a successful exchange returns the session the site chose', async () => {
  const session = await exchangeApiKey(KEY, {
    tokenUrl: TOKEN_URL,
    fetchImpl: async (url, init) => {
      assert.equal(url, TOKEN_URL)
      assert.deepEqual(JSON.parse(init.body), { key: KEY })
      return ok({ accessToken: 'at_1', apiBase: 'https://api.example.test', apiPath: 'dev', user: { email: 'a@b.se' } })
    },
  })
  assert.deepEqual(session, {
    accessToken: 'at_1',
    apiBase: 'https://api.example.test',
    apiPath: 'dev',
    email: 'a@b.se',
  })
  assert.equal('refreshToken' in session, false, 'key mode stores no refresh token')
})

test('a revoked key says so, and does not read like a network fault', async () => {
  await assert.rejects(
    exchangeApiKey(KEY, { tokenUrl: TOKEN_URL, fetchImpl: async () => err(401, { code: 'INVALID_KEY' }) }),
    (e) => e.status === 401 && /revoked or expired/.test(e.message),
  )
})

test('an unreachable site is reported as such', async () => {
  await assert.rejects(
    exchangeApiKey(KEY, { tokenUrl: TOKEN_URL, fetchImpl: async () => { throw new Error('ECONNREFUSED') } }),
    (e) => e.code === 'TOKEN_URL_UNREACHABLE' && /ECONNREFUSED/.test(e.message),
  )
})

test('an expired session is re-minted from the key and the read is retried', async () => {
  let minted = 0
  let reads = 0
  const client = new HttpClient({
    session: { accessToken: 'stale', apiBase: 'https://api.example.test', apiPath: 'v2' },
    reauth: async () => {
      minted++
      return { accessToken: 'fresh', apiBase: 'https://api.example.test', apiPath: 'v2' }
    },
    fetchImpl: async (url, init) => {
      reads++
      const bearer = init.headers.authorization
      if (bearer === 'Bearer stale') return err(401, { error: 'expired' })
      assert.equal(bearer, 'Bearer fresh')
      return ok([{ accountId: 'a1', balances: [] }])
    },
  })
  const accounts = await client.listAccounts()
  assert.equal(accounts.length, 1)
  assert.equal(minted, 1, 'exchanged the key exactly once')
  assert.equal(reads, 2, 'one rejected read, one retry')
})

test('a key that stops working mid-session surfaces, it does not loop', async () => {
  let minted = 0
  const client = new HttpClient({
    session: { accessToken: 'stale', apiBase: 'https://api.example.test', apiPath: 'v2' },
    reauth: async () => {
      minted++
      return { accessToken: 'also-stale', apiBase: 'https://api.example.test', apiPath: 'v2' }
    },
    fetchImpl: async () => err(401, { error: 'expired' }),
  })
  await assert.rejects(client.listAccounts(), (e) => e.status === 401)
  assert.equal(minted, 1, 'renewed once, then gave up')
})

test('without a refresh token and without reauth, the advice is to sign in again', async () => {
  const client = new HttpClient({
    session: { accessToken: 'stale', apiBase: 'https://api.example.test', apiPath: 'v2' },
    fetchImpl: async () => err(401, { error: 'expired' }),
  })
  await assert.rejects(client.listAccounts(), /fliq login/)
})
