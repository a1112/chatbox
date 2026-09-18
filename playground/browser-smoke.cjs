// Optional UI verification: npm install playwright in a separate test directory,
// then set PLAYWRIGHT_MODULE to that directory's node_modules/playwright.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const assert = require('node:assert/strict')
const http = require('node:http')
const path = require('node:path')
const fs = require('node:fs/promises')

;(async () => {
  const requests = []
  let cancelled = false
  const upstream = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk
    requests.push({ url: req.url, headers: req.headers, body: raw && JSON.parse(raw) })
    res.setHeader('content-type', 'application/json')
    if (req.url.endsWith('/models')) return res.end(JSON.stringify({ data: [{ id: 'mock-model' }] }))
    const body = JSON.parse(raw)
    const result = { id: 'mock', object: 'chat.completion', created: 1, model: 'mock-model', choices: [{ index: 0, message: { role: 'assistant', content: '浏览器验证成功' }, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 6, total_tokens: 11 } }
    if (!body.stream) return res.end(JSON.stringify(result))
    res.setHeader('content-type', 'text/event-stream')
    if (JSON.stringify(body.messages).includes('取消验证')) {
      res.write(`data: ${JSON.stringify({ ...result, object: 'chat.completion.chunk', usage: undefined, choices: [{ index: 0, delta: { content: '可保留的部分回答' }, finish_reason: null }] })}\n\n`)
      res.once('close', () => { cancelled = true })
      return
    }
    res.write(`data: ${JSON.stringify({ ...result, object: 'chat.completion.chunk', usage: undefined, choices: [{ index: 0, delta: { content: '浏览器验证成功' }, finish_reason: null }] })}\n\n`)
    setTimeout(() => res.end(`data: ${JSON.stringify({ ...result, object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`), 30)
  })
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve))
  const browser = process.env.PLAYGROUND_CDP ? await chromium.connectOverCDP(process.env.PLAYGROUND_CDP) : await chromium.launch({ headless: true, executablePath: process.env.PLAYGROUND_BROWSER || path.join(process.env['ProgramFiles(x86)'], 'Microsoft/Edge/Application/msedge.exe') })
  try {
    const page = process.env.PLAYGROUND_CDP ? browser.contexts()[0].pages()[0] : await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    const errors = []; page.on('pageerror', error => errors.push(error.message))
    if (!process.env.PLAYGROUND_CDP) await page.goto(process.env.PLAYGROUND_TEST_URL || 'http://127.0.0.1:5174')
    await page.getByRole('dialog', { name: '模型操练场', exact: true }).waitFor({ timeout: 60000 })
    const connection = { version: 1, name: 'UI 模拟连接', protocol: 'openai', baseUrl: `http://127.0.0.1:${upstream.address().port}/custom/v1`, modelId: 'mock-model' }
    await page.getByLabel('导入 ModelBase 连接').setInputFiles({ name: 'connection.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(connection)) })
    await page.getByRole('status').filter({ hasText: '已读取连接' }).waitFor()
    await page.getByLabel('API Key（本机无认证服务可留空）').fill('browser-secret-test')
    await page.getByRole('button', { name: '获取模型', exact: true }).click()
    await page.getByRole('status').filter({ hasText: '模型列表已获取' }).waitFor()
    const exported = page.waitForEvent('download')
    await page.getByRole('button', { name: '导出连接', exact: true }).click()
    const data = JSON.parse(await fs.readFile(await (await exported).path(), 'utf8'))
    assert.equal(data.baseUrl, connection.baseUrl); assert.equal(data.modelId, 'mock-model'); assert.ok(!JSON.stringify(data).includes('browser-secret-test'))
    await page.screenshot({ path: path.join(__dirname, 'connection-ui.png'), fullPage: true })
    await page.getByRole('button', { name: '保存并新建对话' }).click()
    await page.waitForURL(/session\//)
    await page.getByTestId('session-settings-trigger').waitFor()
    await page.evaluate(() => document.querySelector('div.fixed.right-4.bottom-4 button')?.click())
    await page.getByTestId('attachment-file-input').setInputFiles({ name: 'too-large.png', mimeType: 'image/png', buffer: Buffer.alloc(5 * 1024 * 1024 + 1) })
    await page.getByText('图片仅支持 JPEG、PNG、WebP，每张不超过 5 MiB。', { exact: true }).waitFor()
    const pixels = await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 32; canvas.getContext('2d').fillRect(0, 0, 32, 32); return ['image/png', 'image/jpeg', 'image/webp', 'image/png', 'image/png'].map(type => ({ type, data: canvas.toDataURL(type).split(',')[1] })) })
    await page.getByTestId('attachment-file-input').setInputFiles(pixels.map((pixel, i) => ({ name: `pixel-${i}.${pixel.type.split('/')[1]}`, mimeType: pixel.type, buffer: Buffer.from(pixel.data, 'base64') })))
    await page.waitForFunction(() => document.querySelectorAll('[class*="group/image-mini-card"] img').length === 4)
    await page.locator('textarea').first().fill('描述图片')
    await page.locator('textarea').first().press('Enter')
    await page.getByText('浏览器验证成功', { exact: true }).first().waitFor({ timeout: 15000 })
    assert.ok(requests.some(r => (JSON.stringify(r.body).match(/"type":"image_url"/g) || []).length === 4))
    await page.reload()
    await page.getByText('浏览器验证成功', { exact: true }).first().waitFor({ timeout: 15000 })
    await page.getByRole('button', { name: '模型操练场 · 连接 / 调试' }).click()
    await page.getByRole('button', { name: /UI 模拟连接/ }).click()
    assert.equal(await page.getByLabel('API Key（本机无认证服务可留空）').inputValue(), '')
    const persisted = await page.evaluate(async () => {
      const values = []
      for (const info of await indexedDB.databases()) {
        const db = await new Promise((resolve, reject) => { const r = indexedDB.open(info.name); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
        for (const name of db.objectStoreNames) values.push(await new Promise((resolve, reject) => { const r = db.transaction(name).objectStore(name).getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) }))
        db.close()
      }
      return JSON.stringify(values)
    })
    assert.ok(!persisted.includes('browser-secret-test'), 'credentials leaked to IndexedDB')
    assert.ok(persisted.includes('mock-model'), 'model settings not persisted')
    const previousUrl = page.url()
    await page.getByRole('button', { name: '保存并新建对话' }).click()
    await page.waitForURL(url => url.toString() !== previousUrl)
    await page.getByTestId('session-settings-trigger').waitFor()
    const before = requests.length
    await page.locator('textarea').first().fill('无 Key 再测试'); await page.locator('textarea').first().press('Enter')
    await page.getByText('浏览器验证成功', { exact: true }).last().waitFor({ timeout: 15000 })
    await page.waitForFunction(() => !document.querySelector('textarea')?.value)
    for (let attempt = 0; attempt < 100 && !requests.slice(before).some(r => r.body?.stream); attempt++) await new Promise(resolve => setTimeout(resolve, 100))
    assert.ok(requests.slice(before).some(r => r.body?.stream && !r.headers.authorization), 'blank-key generation failed')
    await page.getByTestId('message-stop').waitFor({ state: 'hidden' })
    await page.locator('textarea').first().fill('取消验证'); await page.locator('textarea').first().press('Enter')
    await page.getByText('可保留的部分回答', { exact: true }).waitFor({ timeout: 15000 })
    await page.evaluate(() => document.querySelector('div.fixed.right-4.bottom-4 button')?.click())
    await page.getByTestId('message-stop').click()
    for (let attempt = 0; attempt < 50 && !cancelled; attempt++) await new Promise(resolve => setTimeout(resolve, 100))
    assert.ok(cancelled, 'stop did not disconnect the upstream stream')
    assert.ok((await page.locator('body').innerText()).includes('可保留的部分回答'))
    assert.deepEqual(errors, [])
    console.log('PASS: import/export, model list, image limits and history, key-free IndexedDB, blank-key generation, upstream cancellation and partial answer')
  } finally { await browser.close(); upstream.closeAllConnections(); await new Promise(resolve => upstream.close(resolve)) }
})().catch(error => { console.error(error); process.exitCode = 1 })
