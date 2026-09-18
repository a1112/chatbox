import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { createPlaygroundServer } from './server.mjs'

test('loopback gateway: authentication, arbitrary API prefixes, streaming, HTTP errors and cancellation', async () => {
  let cancelled
  const disconnected = new Promise(resolve => { cancelled = resolve })
  const upstream = http.createServer(async (req, res) => {
    if (req.url === '/slow') { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write('data: {}\n\n'); res.once('close', cancelled); return }
    if (req.url === '/redirect') { res.writeHead(302, { location: '/forbidden' }); res.end(); return }
    if (req.url === '/error') { res.writeHead(429); res.end('rate limited'); return }
    if (req.url === '/unauthorized') { res.writeHead(401); res.end('unauthorized'); return }
    if (req.url === '/missing-models') { res.writeHead(404); res.end('not implemented'); return }
    if (req.url === '/timeout') return
    let body = ''; for await (const chunk of req) body += chunk
    assert.equal(req.url, '/gateway/custom/v1/messages')
    assert.equal(req.headers['x-api-key'], 'test-secret')
    assert.equal(JSON.parse(body).model, 'test')
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.write('data: {"text":"'); setTimeout(() => { res.end('你好"}\n\n') }, 15)
  })
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve))
  const gateway = await createPlaygroundServer({ port: 0 })
  const base = `http://127.0.0.1:${gateway.server.address().port}`
  const target = `http://127.0.0.1:${upstream.address().port}`
  try {
    assert.equal((await fetch(base + '/playground-api/session', { headers: { origin: 'https://evil.example' } })).status, 403)
    const invalidHostStatus = await new Promise(resolve => { http.get(base + '/playground-api/session', { headers: { host: 'evil.example' } }, response => { response.resume(); resolve(response.statusCode) }) })
    assert.equal(invalidHostStatus, 403)
    const { token } = await (await fetch(base + '/playground-api/session')).json()
    const request = (url, overrides = {}, options = {}) => fetch(base + '/playground-api/request', { method: 'POST', headers: { 'content-type': 'application/json', 'x-playground-token': token }, body: JSON.stringify({ url, method: 'POST', headers: { 'x-api-key': 'test-secret' }, body: '{"model":"test"}', ...overrides }), ...options })
    assert.equal((await fetch(base + '/playground-api/request', { method: 'POST' })).status, 403)
    assert.equal((await request('file:///etc/passwd')).status, 400)
    const response = await request(target + '/gateway/custom/v1/messages')
    assert.equal(response.status, 200); assert.equal(await response.text(), 'data: {"text":"你好"}\n\n')
    assert.equal((await request(target + '/error')).status, 429)
    assert.equal((await request(target + '/unauthorized')).status, 401)
    assert.equal((await request(target + '/missing-models', { method: 'GET', body: undefined })).status, 404)
    assert.equal((await request(target + '/timeout', { timeoutMs: 1000 })).status, 502)
    assert.equal((await request(target + '/redirect')).status, 302)
    const controller = new AbortController()
    const stream = await request(target + '/slow', {}, { signal: controller.signal })
    await stream.body.getReader().read(); controller.abort()
    await Promise.race([disconnected, new Promise((_, reject) => setTimeout(() => reject(new Error('Upstream was not cancelled')), 3000))])
    const health = await fetch(base + '/playground-api/health', { headers: { origin: 'http://127.0.0.1:5173' } })
    assert.equal(health.headers.get('access-control-allow-origin'), 'http://127.0.0.1:5173')
  } finally { await gateway.close(); upstream.closeAllConnections(); await new Promise(resolve => upstream.close(resolve)) }
})
