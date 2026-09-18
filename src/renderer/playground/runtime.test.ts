import { describe, expect, it, vi } from 'vitest'
vi.mock('localforage', () => ({ default: { createInstance: () => ({ setItem: vi.fn().mockResolvedValue(undefined) }) } }))
import { consumeEvent, endpoint, keys, playgroundRequest, redact, traceStore, validateConnection, type Trace } from './runtime'
import { stripSettings } from './credentials'

const trace = (): Trace => ({ id: 't', time: '', session: '', url: '', method: 'POST', headers: {}, request: {}, events: [], state: 'running' })
describe('playground protocol diagnostics', () => {
  it('does not retry authentication errors and omits blank bearer credentials', async () => {
    const native = vi.fn(async (_options: unknown) => new Response('{"error":{"message":"invalid key"}}', { status: 401 }))
    const response = await playgroundRequest({ url: 'http://localhost/v1/messages', method: 'POST', headers: { authorization: 'Bearer ' }, body: '{"model":"test"}' }, native)
    await response.text()
    expect(native).toHaveBeenCalledTimes(1)
    expect(native.mock.calls[0][0]).toMatchObject({ headers: {}, retry: 0 })
    expect(vi.mocked(traceStore.setItem).mock.calls.at(-1)?.[1]).toMatchObject({ state: 'error', status: 401 })
  })
  it('retains partial events and reports a stream ending before completion', async () => {
    const native = async () => new Response('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n', { headers: { 'content-type': 'text/event-stream' } })
    const response = await playgroundRequest({ url: 'http://localhost/v1/chat/completions', method: 'POST', body: '{"model":"test"}' }, native)
    expect(await response.text()).toContain('partial')
    expect(vi.mocked(traceStore.setItem).mock.calls.at(-1)?.[1]).toMatchObject({ state: 'error', error: '流在完成事件之前断开' })
  })
  it('preserves gateway prefixes and rejects protected overrides', () => {
    const c = validateConnection({ name: 'test', modelId: 'm', protocol: 'openai-responses', baseUrl: 'http://localhost:9999/gateway/v2/', extra: { max_output_tokens: 32 } })
    expect(endpoint(c)).toBe('http://localhost:9999/gateway/v2/responses')
    expect(() => validateConnection({ ...c, extra: { messages: [] } })).toThrow()
    expect(() => validateConnection({ ...c, baseUrl: 'file:///etc/passwd' })).toThrow()
  })
  it('uses cumulative Claude usage without summing and excludes non-text events from first token', () => {
    const t = trace()
    consumeEvent(t, { type: 'message_start', message: { usage: { input_tokens: 8, output_tokens: 1 } } }, 1)
    expect(t.firstTextMs).toBeUndefined()
    consumeEvent(t, { type: 'content_block_delta', delta: { type: 'text_delta', text: '你好' } }, 30)
    consumeEvent(t, { type: 'message_delta', usage: { output_tokens: 5 }, delta: { stop_reason: 'end_turn' } }, 40)
    consumeEvent(t, { type: 'message_stop' }, 45)
    expect(t).toMatchObject({ inputTokens: 8, outputTokens: 5, firstTextMs: 30, state: 'complete' })
  })
  it('handles Responses events and leaves missing usage unknown', () => {
    const t = trace(); consumeEvent(t, { type: 'response.output_text.delta', delta: 'OK' }, 7)
    expect(t.outputTokens).toBeUndefined()
    consumeEvent(t, { type: 'response.completed', response: { status: 'completed', usage: { input_tokens: 4, output_tokens: 2 } } }, 20)
    expect(t).toMatchObject({ outputTokens: 2, firstTextMs: 7, state: 'complete' })
  })
  it('redacts auth headers, nested secrets and echoed credentials before persistence', () => {
    keys.set('test', 'secret-for-test')
    expect(redact({ Authorization: 'Bearer secret-for-test', nested: { api_key: 'abc' }, error: 'echo secret-for-test' })).toEqual({ Authorization: '[REDACTED]', nested: { api_key: '[REDACTED]' }, error: 'echo [REDACTED]' })
    expect(stripSettings({ state: { providers: { x: { apiKey: 'secret', apiHost: 'http://localhost' } } } })).toEqual({ state: { providers: { x: { apiKey: '', apiHost: 'http://localhost' } } } })
  })
  it('forwards UTF-8 split streams without buffering and disables generation retry', async () => {
    const data = new TextEncoder().encode('data: {"choices":[{"delta":{"content":"你好"}}]}\r\n\r\ndata: [DONE]\r\n\r\n')
    const native = vi.fn(async (_options: unknown) => new Response(new ReadableStream({ start(c) { for (const byte of data) c.enqueue(Uint8Array.of(byte)); c.close() } }), { headers: { 'content-type': 'text/event-stream' } }))
    const response = await playgroundRequest({ url: 'http://localhost/v1/chat/completions', method: 'POST', body: '{"model":"test","messages":[]}' }, native)
    expect(await response.text()).toContain('你好')
    expect(native.mock.calls[0][0]).toMatchObject({ retry: 0, useProxy: false })
  })
})
