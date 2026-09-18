import localforage from 'localforage'
import type { ApiRequestOptions } from '@shared/types/adapters'

export type Protocol = 'openai' | 'openai-responses' | 'claude'
export interface Connection {
  version: 1; name: string; baseUrl: string; protocol: Protocol; modelId: string
  timeoutMs?: number; extra?: Record<string, unknown>; rememberKey?: boolean
}
export interface Trace {
  id: string; time: string; session: string; url: string; method: string; request: unknown
  headers: Record<string, string>; status?: number; events: unknown[]; truncated?: boolean
  firstTextMs?: number; durationMs?: number; inputTokens?: number; outputTokens?: number
  finishReason?: string; error?: string; model?: string; state: 'running' | 'complete' | 'error' | 'cancelled'
}
export const traceStore = localforage.createInstance({ name: 'model-playground', storeName: 'traces' })
export const configStore = localforage.createInstance({ name: 'model-playground', storeName: 'connections' })
const configs = new Map<string, Connection>()
const activeRequests = new Set<AbortController>()
export function cancelPlaygroundRequests() { for (const request of activeRequests) request.abort(new Error('切换连接或关闭页面')); activeRequests.clear() }
if (typeof window !== 'undefined') window.addEventListener('beforeunload', cancelPlaygroundRequests)
export const keys = new Map<string, string>()
const protectedFields = new Set(['model', 'messages', 'input', 'instructions', 'system', 'stream', 'tools', 'tool_choice'])
export function validateConnection(value: any): Connection {
  if (value?.version !== undefined && value.version !== 1) throw new Error('不支持的连接文件版本')
  if (!value || typeof value.name !== 'string' || !value.name.trim() || typeof value.modelId !== 'string') throw new Error('连接名称和模型 ID 格式不正确')
  if (!['openai', 'openai-responses', 'claude'].includes(value.protocol)) throw new Error('请选择支持的 API 协议')
  const url = new URL(value.baseUrl)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Base URL 必须是无凭据、查询参数或片段的 HTTP(S) 地址')
  const extra = value.extra || {}
  if (typeof extra !== 'object' || Array.isArray(extra) || Object.keys(extra).some(key => protectedFields.has(key) || /api.?key|secret|authorization|password|access.?token|refresh.?token/i.test(key))) throw new Error('高级参数不能覆盖模型、消息、流式开关或认证信息')
  return { version: 1, name: value.name.trim(), baseUrl: url.toString().replace(/\/$/, ''), protocol: value.protocol, modelId: value.modelId.trim(), timeoutMs: Math.min(Math.max(Number(value.timeoutMs) || 120000, 1000), 600000), extra, rememberKey: value.rememberKey === true }
}
export function endpoint(connection: Connection) {
  return connection.baseUrl + ({ openai: '/chat/completions', 'openai-responses': '/responses', claude: '/messages' }[connection.protocol])
}
export function registerConnection(id: string, connection: Connection) { configs.set(id, connection) }
export function unregisterConnection(id: string) { configs.delete(id) }
export function redact(value: any): any {
  if (typeof value === 'string') {
    let result = value
    for (const secret of keys.values()) if (secret) result = result.split(secret).join('[REDACTED]')
    return result
  }
  if (Array.isArray(value)) return value.map(redact)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, /authorization|api.?key|secret|cookie|password|access.?token|refresh.?token/i.test(k) ? '[REDACTED]' : redact(v)]))
  return value
}
function announce(trace: Trace) {
  const safe = redact(trace)
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('playground-trace', { detail: safe }))
}
export function consumeEvent(trace: Trace, event: any, elapsed: number) {
  const usage = event.usage || event.message?.usage || event.response?.usage
  if (usage) {
    const input = usage.prompt_tokens ?? usage.input_tokens
    const output = usage.completion_tokens ?? usage.output_tokens
    if (typeof input === 'number') trace.inputTokens = input
    if (typeof output === 'number') trace.outputTokens = output
  }
  const text = event.choices?.[0]?.delta?.content ?? event.choices?.[0]?.message?.content ?? event.content?.find?.((part: any) => part.type === 'text')?.text ?? event.output?.find?.((item: any) => item.type === 'message')?.content?.find?.((part: any) => part.type === 'output_text')?.text ?? (event.type === 'content_block_delta' ? event.delta?.text : undefined) ?? (event.type === 'response.output_text.delta' ? event.delta : undefined)
  if (typeof text === 'string' && text.length && trace.firstTextMs === undefined) trace.firstTextMs = elapsed
  trace.finishReason = event.choices?.[0]?.finish_reason || event.delta?.stop_reason || event.stop_reason || event.response?.status || trace.finishReason
  if (event.type === 'message_stop' || event.type === 'response.completed' || event.choices?.[0]?.finish_reason) trace.state = 'complete'
  if (event.error || event.type === 'error' || event.type === 'response.failed') { trace.state = 'error'; trace.error = JSON.stringify(event.error || event.response?.error || event) }
  if (event.type === 'response.incomplete') { trace.state = 'error'; trace.error = '响应不完整'; trace.finishReason = JSON.stringify(event.response?.incomplete_details) }
  if (!trace.truncated) { trace.events.push(redact(event)); if (JSON.stringify(trace.events).length > 1024 * 1024) trace.truncated = true }
}

let sessionToken: Promise<string> | undefined
export async function playgroundRequest(options: ApiRequestOptions, native: (options: ApiRequestOptions) => Promise<Response>): Promise<Response> {
  if (!/\/(chat\/completions|responses|messages|models)\/?(?:\?.*)?$/.test(options.url)) return native(options)
  let body = typeof options.body === 'string' ? JSON.parse(options.body) : undefined
  const config = [...configs.values()].find(c => options.url.startsWith(c.baseUrl + '/') && (!body?.model || c.modelId === body.model) && (!body || options.url === endpoint(c)))
  if (body && config?.extra) body = { ...body, ...config.extra }
  const headers: Record<string, string> = {}
  new Headers(options.headers).forEach((value, key) => { headers[key] = value })
  for (const [header, value] of Object.entries(headers)) if (/authorization|api.?key/i.test(header) && value) keys.set(`request-${header}`, value.replace(/^Bearer\s+/i, ''))
  for (const [key, value] of Object.entries(headers)) if (!value || /^Bearer(?:\s+(?:undefined|null))?$/i.test(value)) delete headers[key]
  const begin = performance.now()
  const trace: Trace = { id: crypto.randomUUID(), time: new Date().toISOString(), session: typeof location === 'undefined' ? '' : location.pathname + location.hash, url: options.url, method: options.method || 'GET', headers: redact(headers), request: redact(body), events: [], state: 'running', model: body?.model }
  announce(trace)
  const controller = new AbortController()
  activeRequests.add(controller)
  const abort = () => controller.abort(options.signal?.reason)
  options.signal?.addEventListener('abort', abort, { once: true })
  if (options.signal?.aborted) abort()
  const timer = setTimeout(() => controller.abort(new Error('请求超时')), config?.timeoutMs || 120000)
  let finished = false
  async function finish(error?: unknown) {
    if (finished) return
    finished = true; activeRequests.delete(controller); clearTimeout(timer); options.signal?.removeEventListener('abort', abort)
    trace.durationMs = performance.now() - begin
    if (error) { trace.state = options.signal?.aborted ? 'cancelled' : 'error'; trace.error = String(error) }
    else if (trace.state === 'running') trace.state = 'complete'
    const safe = redact(trace)
    await traceStore.setItem(trace.id, safe).catch(() => {})
    announce(trace)
  }
  try {
    const next = { ...options, body: body ? JSON.stringify(body) : options.body, headers, signal: controller.signal, retry: 0, useProxy: false }
    let response: Response
    if (typeof window !== 'undefined' && !window.electronAPI) {
      sessionToken ??= fetch('/playground-api/session').then(async r => { if (!r.ok) throw new Error('本地转发服务未启动'); return (await r.json()).token }).catch(e => { sessionToken = undefined; throw e })
      response = await fetch('/playground-api/request', { method: 'POST', headers: { 'content-type': 'application/json', 'x-playground-token': await sessionToken }, body: JSON.stringify({ ...next, timeoutMs: config?.timeoutMs }), signal: controller.signal })
    } else response = await native(next)
    trace.status = response.status
    if (!response.ok) trace.state = 'error'
    const reader = response.body?.getReader()
    if (!reader) { await finish(); return response }
    const decoder = new TextDecoder(); let buffer = ''; let jsonBody = ''; const streaming = response.headers.get('content-type')?.includes('text/event-stream')
    const stream = new ReadableStream<Uint8Array>({
      async pull(out) {
        try {
          const { done, value } = await reader.read()
          if (done) {
            buffer += decoder.decode()
            if (!streaming) { try { consumeEvent(trace, JSON.parse(jsonBody + buffer), performance.now() - begin) } catch { trace.events.push(redact(jsonBody + buffer)) } }
            else if (trace.state === 'running') { trace.state = 'error'; trace.error = '流在完成事件之前断开' }
            await finish(); out.close(); return
          }
          const text = decoder.decode(value, { stream: true })
          if (streaming) {
            buffer += text
            let match: RegExpExecArray | null
            while ((match = /\r?\n\r?\n/.exec(buffer))) {
              const block = buffer.slice(0, match.index); buffer = buffer.slice(match.index + match[0].length)
              const data = block.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n')
              if (data === '[DONE]') trace.state = trace.state === 'error' ? 'error' : 'complete'
              else if (data) { try { consumeEvent(trace, { ...JSON.parse(data), _raw: block }, performance.now() - begin) } catch { trace.events.push(redact({ raw: block })) } }
            }
          } else jsonBody += text
          announce(trace); out.enqueue(value)
        } catch (error) { await finish(error); out.error(error) }
      },
      async cancel(reason) { controller.abort(); await reader.cancel(reason); if (trace.state === 'running') trace.state = 'cancelled'; await finish() },
    })
    return new Response(stream, { status: response.status, statusText: response.statusText, headers: response.headers })
  } catch (error) { await finish(error); throw error }
}
