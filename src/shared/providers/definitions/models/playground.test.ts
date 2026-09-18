import http from 'node:http'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { ModelDependencies } from '../../../types/adapters'
import CustomOpenAI from './custom-openai'
import CustomOpenAIResponses from './custom-openai-responses'
import CustomClaude from './custom-claude'

const usage = { input_tokens: 8, output_tokens: 2 }
const responseObject = { id: 'resp_test', object: 'response', created_at: 1, model: 'mock-model', status: 'completed', output: [{ id: 'msg_test', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: '你好', annotations: [] }] }], usage: { ...usage, total_tokens: 10 }, error: null, incomplete_details: null }
const claudeObject = { id: 'msg_test', type: 'message', role: 'assistant', model: 'mock-model', content: [{ type: 'text', text: '你好' }], stop_reason: 'end_turn', stop_sequence: null, usage }
let base = ''; let captured: { url: string; body: any; headers: http.IncomingHttpHeaders }[] = []
const server = http.createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk
  const body = JSON.parse(raw); captured.push({ url: req.url!, body, headers: req.headers })
  if (body.model === 'rate-limited') { res.writeHead(429, { 'content-type': 'application/json' }); res.end('{"error":{"message":"rate limited","type":"rate_limit_error"}}'); return }
  const protocol = req.url!.endsWith('/messages') ? 'claude' : req.url!.endsWith('/responses') ? 'responses' : 'chat'
  if (!body.stream) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(protocol === 'claude' ? claudeObject : protocol === 'responses' ? responseObject : { id: 'chat_test', object: 'chat.completion', created: 1, model: 'mock-model', choices: [{ index: 0, message: { role: 'assistant', content: '你好' }, finish_reason: 'stop' }], usage: { prompt_tokens: 8, completion_tokens: 2, total_tokens: 10 } })); return }
  res.setHeader('content-type', 'text/event-stream')
  const event = (value: any) => res.write(`data: ${JSON.stringify(value)}\n\n`)
  if (protocol === 'claude') {
    event({ type: 'message_start', message: { ...claudeObject, content: [], stop_reason: null } }); event({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }); event({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '你好' } }); event({ type: 'content_block_stop', index: 0 }); event({ type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 2 } }); event({ type: 'message_stop' })
  } else if (protocol === 'responses') {
    event({ type: 'response.created', response: { ...responseObject, status: 'in_progress', output: [] } }); event({ type: 'response.output_item.added', output_index: 0, item: { id: 'msg_test', type: 'message', role: 'assistant', content: [], status: 'in_progress' } }); event({ type: 'response.content_part.added', item_id: 'msg_test', output_index: 0, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } }); event({ type: 'response.output_text.delta', item_id: 'msg_test', output_index: 0, content_index: 0, delta: '你好' }); event({ type: 'response.output_text.done', item_id: 'msg_test', output_index: 0, content_index: 0, text: '你好' }); event({ type: 'response.output_item.done', output_index: 0, item: responseObject.output[0] }); event({ type: 'response.completed', response: responseObject })
  } else { event({ id: 'chat_test', object: 'chat.completion.chunk', created: 1, model: 'mock-model', choices: [{ index: 0, delta: { role: 'assistant', content: '你好' }, finish_reason: null }] }); event({ id: 'chat_test', object: 'chat.completion.chunk', created: 1, model: 'mock-model', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 8, completion_tokens: 2, total_tokens: 10 } }); res.write('data: [DONE]\n\n') }
  res.end()
})
beforeAll(async () => { await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); base = `http://127.0.0.1:${(server.address() as any).port}/gateway/custom` })
afterAll(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) })

describe('fixed upstream adapters against local protocol server', () => {
  for (const [name, Constructor, apiPath] of [['Chat Completions', CustomOpenAI, '/chat/completions'], ['Responses', CustomOpenAIResponses, '/responses'], ['Claude Messages', CustomClaude, '/messages']] as const) {
    it(`${name}: a rate-limited generation is never retried`, async () => {
      const dependencies: ModelDependencies = { request: { apiRequest: async options => fetch(options.url, { method: options.method, headers: options.headers, body: options.body, signal: options.signal }), fetchWithOptions: fetch }, storage: { saveImage: vi.fn(), getImage: vi.fn() }, sentry: { captureException: vi.fn(), withScope: vi.fn() }, getRemoteConfig: () => ({}), platformType: 'web' }
      for (const stream of [false, true]) {
        const before = captured.length
        const model = new Constructor({ apiKey: '', apiHost: base, apiPath, model: { modelId: 'rate-limited' }, stream, maxOutputTokens: 16 }, dependencies)
        await expect(model.chat([{ role: 'user', content: 'Hi' }], {})).rejects.toThrow()
        expect(captured.length - before).toBe(1)
      }
    })
    for (const stream of [false, true]) it(`${name}: ${stream ? 'SSE' : 'JSON'} + custom prefix + images + history`, async () => {
      const dependencies: ModelDependencies = { request: { apiRequest: async options => fetch(options.url, { method: options.method, headers: options.headers, body: options.body, signal: options.signal }), fetchWithOptions: fetch }, storage: { saveImage: vi.fn(), getImage: vi.fn() }, sentry: { captureException: vi.fn(), withScope: vi.fn() }, getRemoteConfig: () => ({}), platformType: 'web' }
      const model = new Constructor({ apiKey: stream ? '' : 'test-key', apiHost: base, apiPath, model: { modelId: 'mock-model', capabilities: ['vision'] }, stream, maxOutputTokens: 32 }, dependencies)
      const messages: any = [{ role: 'system', content: 'Answer briefly' }, { role: 'user', content: 'Hi' }, { role: 'assistant', content: 'Hello' }, { role: 'user', content: [{ type: 'text', text: 'Describe this' }, { type: 'image', image: new Uint8Array([137, 80, 78, 71]), mediaType: 'image/png' }] }]
      const result = await model.chat(messages, {})
      expect(JSON.stringify(result)).toContain('你好')
      const last = captured.at(-1)!
      expect(last.url).toBe('/gateway/custom' + apiPath)
      expect(last.body.model).toBe('mock-model')
      expect(JSON.stringify(last.body)).toContain('Describe this')
      expect(JSON.stringify(last.body)).toContain('image')
      if (name === 'Claude Messages') { if (!stream) expect(last.headers['x-api-key']).toBe('test-key'); expect(last.body.system).toBeTruthy() } else if (!stream) expect(last.headers.authorization).toBe('Bearer test-key')
    })
  }
})
