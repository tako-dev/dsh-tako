/**
 * Minimal stand-in for Tako: the public pricing directory and an
 * OpenAI-compatible chat endpoint returning a fixed reply.
 */
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'

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
  }
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
