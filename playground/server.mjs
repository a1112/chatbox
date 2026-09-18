import http from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export async function createPlaygroundServer({ port = 5174, dev = false, assets = process.env.PLAYGROUND_ASSETS || path.join(root, 'release/playground-web/public') } = {}) {
  const token = randomBytes(32).toString('hex')
  const vite = dev ? await (await import('vite')).createServer({ configFile: path.join(root, 'vite.config.web.ts'), server: { middlewareMode: true }, appType: 'spa' }) : null
  const server = http.createServer(async (req, res) => {
    const localPort = server.address().port
    const hosts = new Set([`127.0.0.1:${localPort}`, `localhost:${localPort}`, `[::1]:${localPort}`])
    const origins = new Set([...hosts].map(host => `http://${host}`))
    const json = (status, value) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)) }
    try {
      if (!hosts.has(req.headers.host)) return json(403, { error: 'Invalid host' })
      if (req.url === '/playground-api/health' && req.method === 'GET') {
        if (['http://127.0.0.1:5173', 'http://localhost:5173', 'tauri://localhost', 'http://tauri.localhost'].includes(req.headers.origin)) res.setHeader('access-control-allow-origin', req.headers.origin)
        return json(200, { service: 'model-playground', status: 'ok' })
      }
      if (req.headers.origin && !origins.has(req.headers.origin)) return json(403, { error: 'Invalid origin' })
      if (req.headers['sec-fetch-site'] === 'cross-site') return json(403, { error: 'Cross-site request rejected' })
      if (req.url === '/playground-api/session' && req.method === 'GET') return json(200, { token })
      if (req.url === '/playground-api/request' && req.method === 'POST') {
        const provided = Buffer.from(String(req.headers['x-playground-token'] || ''))
        if (provided.length !== token.length || !timingSafeEqual(provided, Buffer.from(token))) return json(403, { error: 'Invalid session token' })
        let size = 0; const chunks = []
        for await (const chunk of req) { size += chunk.length; if (size > 32 * 1024 * 1024) return json(413, { error: 'Request exceeds 32 MiB' }); chunks.push(chunk) }
        const input = JSON.parse(Buffer.concat(chunks).toString())
        const url = new URL(input.url)
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return json(400, { error: 'Only HTTP(S) URLs without embedded credentials are supported' })
        if (!['GET', 'POST'].includes(input.method)) return json(400, { error: 'Unsupported method' })
        const headers = new Headers()
        for (const [key, value] of Object.entries(input.headers || {})) {
          if (!/^(host|connection|content-length|cookie|origin|referer|proxy-.*|sec-.*|transfer-encoding)$/i.test(key)) headers.set(key, String(value))
        }
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(new Error('Request timeout')), Math.min(Math.max(Number(input.timeoutMs) || 120000, 1000), 600000))
        res.on('close', () => { if (!res.writableEnded) controller.abort() })
        try {
          const upstream = await fetch(url, { method: input.method, headers, body: input.method === 'POST' ? input.body : undefined, signal: controller.signal, redirect: 'manual' })
          res.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') || 'application/json', 'cache-control': 'no-store', 'x-accel-buffering': 'no' })
          if (upstream.body) await pipeline(Readable.fromWeb(upstream.body), res)
          else res.end()
        } finally { clearTimeout(timeout) }
        return
      }
      if (req.url?.startsWith('/playground-api/')) return json(404, { error: 'Not found' })
      if (vite) return vite.middlewares(req, res, () => json(404, { error: 'Not found' }))
      if (!['GET', 'HEAD'].includes(req.method)) return json(405, { error: 'Method not allowed' })
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
      let file = path.resolve(assets, `.${pathname}`)
      if (!file.startsWith(path.resolve(assets) + path.sep) && file !== path.resolve(assets)) return json(403, { error: 'Invalid path' })
      if (!path.extname(file) || (await stat(file).catch(() => null))?.isDirectory()) file = path.join(assets, 'index.html')
      const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm', '.woff2': 'font/woff2' }
      const content = await readFile(file).catch(() => null)
      if (!content) return json(404, { error: 'Asset not found. Run the Web build first.' })
      res.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream' }); res.end(req.method === 'HEAD' ? undefined : content)
    } catch (error) {
      if (res.headersSent) res.destroy()
      else json(error instanceof SyntaxError || error instanceof TypeError ? 400 : 502, { error: 'Upstream request failed or timed out' })
    }
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve) })
  return { server, close: async () => { await vite?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) } }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const instance = await createPlaygroundServer({ port: Number(process.env.PLAYGROUND_PORT) || 5174, dev: process.argv.includes('--dev') })
  console.log(`模型操练场 http://127.0.0.1:${instance.server.address().port}`)
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await instance.close(); process.exit(0) })
}
