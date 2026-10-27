/**
 * Minimal stand-in for Tako: the public pricing directory, an
 * OpenAI-compatible chat endpoint returning a fixed reply, and the desktop
 * sign-in contract (`/app/authorize` acting as a user who already confirmed,
 * `/api/desktop/token|me|revoke`) with the server's PKCE and redirect checks.
 */
import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'

const LOOPBACK_CALLBACK = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):(\d{4,5})\/tako\/callback$/
const CLIENT_IDS = new Set(['dsh-desktop', 'tako-connect'])

export const REPLY = 'TAKO_E2E_FIXED_REPLY_42'

/**
 * @param {{ pricingFile: string }} options
 */
export async function startMockTako({ pricingFile }) {
  const state = {
    pricingStatus: 200,
    pricingBody: readFileSync(pricingFile, 'utf8'),
    /** @type {{ method: string, url: string, authorization?: string, model?: string, stream?: boolean, at: number }[]} */
    requests: [],
    /** `approve` redirects with a code; `deny` redirects with error=access_denied. */
    authorizeMode: 'approve',
    /** Force the token endpoint to answer `{ success: false, error }`. */
    tokenError: undefined,
    /** @type {Map<string, { challenge: string, redirectUri: string, clientId: string, deviceName: string, expires: number }>} */
    codes: new Map(),
    /** Keys issued by the token endpoint and not revoked. */
    keys: new Map(),
    /** @type {{ url: string, params: Record<string, string> }[]} */
    authorizations: [],
    /** @type {{ ok: boolean, reason?: string, key?: string, body: Record<string, unknown> }[]} */
    tokenExchanges: [],
    revoked: [],
  }
  const fail = (res, error, message = error) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ success: false, error, message }))
  const bearer = req => (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '')
  const server = createServer((req, res) => {
    const chunks = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      let body
      try { body = raw.length > 0 ? JSON.parse(raw) : undefined } catch { body = undefined }
      const url = new URL(req.url ?? '/', 'http://mock')
      state.requests.push({
        method: req.method ?? 'GET',
        url: url.pathname,
        authorization: req.headers.authorization,
        model: body?.model,
        stream: body?.stream,
        at: Date.now(),
      })
      if (req.method === 'GET' && url.pathname === '/api/pricing') {
        if (state.pricingStatus !== 200) {
          res.writeHead(state.pricingStatus, { 'content-type': 'text/plain' }).end('mock failure')
          return
        }
        res.writeHead(200, { 'content-type': 'application/json' }).end(state.pricingBody)
        return
      }
      if (req.method === 'GET' && url.pathname === '/app/authorize') {
        const params = Object.fromEntries(url.searchParams)
        state.authorizations.push({ url: url.href, params })
        const redirect = params.redirect_uri ?? ''
        const valid = LOOPBACK_CALLBACK.test(redirect) && Number(LOOPBACK_CALLBACK.exec(redirect)[2]) >= 1024
          && CLIENT_IDS.has(params.client_id) && params.response_type === 'code'
          && params.code_challenge_method === 'S256' && /^[A-Za-z0-9_-]{43,128}$/.test(params.code_challenge ?? '')
        if (!valid) {
          res.writeHead(400, { 'content-type': 'text/plain' }).end('mock: invalid authorize request')
          return
        }
        const target = new URL(redirect)
        if (state.authorizeMode === 'deny') {
          target.searchParams.set('error', 'access_denied')
        } else {
          const code = randomBytes(16).toString('hex')
          state.codes.set(code, { challenge: params.code_challenge, redirectUri: redirect, clientId: params.client_id, deviceName: params.device_name ?? '', expires: Date.now() + 5 * 60_000 })
          target.searchParams.set('code', code)
        }
        if (params.state !== undefined) target.searchParams.set('state', params.state)
        res.writeHead(302, { location: target.href }).end()
        return
      }
      if (req.method === 'POST' && url.pathname === '/api/desktop/token') {
        const record = reason => { state.tokenExchanges.push({ ok: reason === undefined, reason, body: { ...body, code_verifier: body?.code_verifier ? '<redacted>' : undefined } }) }
        if (state.tokenError !== undefined) { record(state.tokenError); fail(res, state.tokenError); return }
        if (body?.grant_type !== 'authorization_code') { record('unsupported_grant_type'); fail(res, 'unsupported_grant_type'); return }
        const entry = state.codes.get(body.code)
        state.codes.delete(body.code) // one-time, like the server
        if (entry === undefined || entry.expires < Date.now()) { record('invalid_grant: unknown code'); fail(res, 'invalid_grant'); return }
        if (entry.redirectUri !== body.redirect_uri || entry.clientId !== body.client_id) { record('invalid_grant: redirect/client mismatch'); fail(res, 'invalid_grant'); return }
        const verifier = String(body.code_verifier ?? '')
        if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier) || createHash('sha256').update(verifier).digest('base64url') !== entry.challenge) {
          record('invalid_grant: PKCE verifier does not match the challenge'); fail(res, 'invalid_grant'); return
        }
        const key = `cr_e2e${randomBytes(18).toString('hex')}`
        const name = `${entry.clientId}@${entry.deviceName}`.slice(0, 50)
        state.keys.set(key, { name, id: state.keys.size + 1 })
        state.tokenExchanges.push({ ok: true, key, body: { ...body, code_verifier: '<redacted>' } })
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ success: true, data: { key, token_id: state.keys.get(key).id, name, user: { name: 'e2e-user' }, plan: { name: 'E2E Plan' } } }))
        return
      }
      if (req.method === 'POST' && url.pathname === '/apiStats/api/get-key-id') {
        const key = String(body?.apiKey ?? '')
        const token = state.keys.get(key)
        if (token === undefined) {
          res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ success: false, error: 'Invalid key' }))
          return
        }
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ success: true, data: { id: '7' } }))
        return
      }
      if (req.method === 'POST' && url.pathname === '/apiStats/api/user-quota') {
        if (String(body?.apiId ?? '') !== '7') {
          res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'apiId required' }))
          return
        }
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
          plan: { window_cost_limit: 200, window_minutes: 300, weekly_cost_limit: 930 },
          usage: { windowCost: 12, weeklyCost: 80 },
        }))
        return
      }
      if (req.method === 'GET' && url.pathname === '/api/desktop/me') {
        const token = state.keys.get(bearer(req))
        if (token === undefined) { res.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ success: false, error: 'invalid_token', message: 'invalid token' })); return }
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ success: true, data: { user: { id: '7', name: 'e2e-user' }, plan: { name: 'E2E Plan' }, token: { id: token.id, name: token.name }, quota: { remain: 1_000_000, used: 250_000 } } }))
        return
      }
      if (req.method === 'POST' && url.pathname === '/api/desktop/revoke') {
        const key = bearer(req)
        const token = state.keys.get(key)
        if (token === undefined) { res.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ success: false, error: 'invalid_token', message: 'invalid token' })); return }
        state.keys.delete(key)
        state.revoked.push(key)
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ success: true, data: { revoked: true, token_id: token.id } }))
        return
      }
      if (req.method === 'GET' && url.pathname === '/v1/models') {
        const data = JSON.parse(state.pricingBody).data.map(card => ({ id: card.model_name, object: 'model', owned_by: 'tako' }))
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ object: 'list', data }))
        return
      }
      if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
        const model = body?.model ?? 'unknown'
        const id = `chatcmpl-e2e-${state.requests.length}`
        const created = Math.floor(Date.now() / 1000)
        const usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
        if (body?.stream) {
          res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
          const send = obj => res.write(`data: ${JSON.stringify(obj)}\n\n`)
          send({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] })
          send({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: { content: REPLY }, finish_reason: null }] })
          send({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })
          send({ id, object: 'chat.completion.chunk', created, model, choices: [], usage })
          res.end('data: [DONE]\n\n')
          return
        }
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
          id, object: 'chat.completion', created, model,
          choices: [{ index: 0, message: { role: 'assistant', content: REPLY }, finish_reason: 'stop' }],
          usage,
        }))
        return
      }
      res.writeHead(404, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { message: `mock: no route ${req.method} ${url.pathname}` } }))
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = /** @type {import('node:net').AddressInfo} */ (server.address())
  return {
    origin: `http://127.0.0.1:${port}`,
    state,
    chatRequests: () => state.requests.filter(request => request.url === '/v1/chat/completions'),
    pricingRequests: () => state.requests.filter(request => request.url === '/api/pricing'),
    close: () => new Promise(resolve => { server.closeAllConnections?.(); server.close(() => resolve(undefined)) }),
  }
}
