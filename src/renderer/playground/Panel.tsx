import { useEffect, useState } from 'react'
import { ModelProviderType } from '@shared/types'
import { createModelDependencies } from '@/adapters/RendererModelDependencies'
import { initSettingsStore, settingsStore } from '@/stores/settingsStore'
import { createEmpty } from '@/stores/session/crud'
import i18n from '@/i18n'
import { saveKey, readKey } from './credentials'
import { cancelPlaygroundRequests, configStore, endpoint, redact, registerConnection, unregisterConnection, traceStore, validateConnection, type Connection, type Trace } from './runtime'
import './panel.css'

const initial: Connection = { version: 1, name: 'ModelBase 本机', protocol: 'openai', baseUrl: 'http://127.0.0.1:11434/v1', modelId: '', timeoutMs: 120000, extra: {} }
function download(name: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(redact(value), null, 2)], { type: 'application/json' }))
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export default function PlaygroundPanel() {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState('connections')
  const [connections, setConnections] = useState<Record<string, Connection>>({})
  const [id, setId] = useState('playground-local')
  const [form, setForm] = useState<Connection>(initial)
  const [key, setKey] = useState('')
  const [extra, setExtra] = useState('{}')
  const [models, setModels] = useState<string[]>([])
  const [traces, setTraces] = useState<Trace[]>([])
  const [selected, setSelected] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let alive = true
    void (async () => {
      const saved = await configStore.getItem<Record<string, Connection>>('profiles') || {}
      if (!await configStore.getItem('initialized')) {
        await initSettingsStore()
        settingsStore.getState().setSettings({ language: 'zh-Hans' })
        await i18n.changeLanguage('zh-Hans')
        await configStore.setItem('initialized', true)
      }
      for (const [profileId, config] of Object.entries(saved)) { registerConnection(profileId, config); await readKey(profileId) }
      const records: Trace[] = []; await traceStore.iterate<Trace, void>(record => { records.push(record) })
      if (alive) { setConnections(saved); setTraces(records.sort((a, b) => b.time.localeCompare(a.time))); if (!Object.keys(saved).length) setOpen(true) }
    })().catch(e => setMessage(String(e)))
    const onTrace = (event: Event) => { const trace = (event as CustomEvent<Trace>).detail; setTraces(current => [trace, ...current.filter(t => t.id !== trace.id)].sort((a, b) => b.time.localeCompare(a.time))) }
    const onOpen = () => { setOpen(true); setTab('traces') }
    window.addEventListener('playground-trace', onTrace); window.addEventListener('playground-open', onOpen)
    return () => { alive = false; window.removeEventListener('playground-trace', onTrace); window.removeEventListener('playground-open', onOpen) }
  }, [])
  async function run(action: () => Promise<void>) { setBusy(true); setMessage(''); try { await action() } catch (e) { setMessage(String(e)) } finally { setBusy(false) } }
  async function save(value = form, profileId = id, apiKey = key) {
    cancelPlaygroundRequests()
    const config = validateConnection({ ...value, extra: JSON.parse(extra) })
    await saveKey(profileId, apiKey, config.rememberKey === true)
    registerConnection(profileId, config)
    const next = { ...connections, [profileId]: config }; await configStore.setItem('profiles', next); setConnections(next)
    await initSettingsStore()
    const state = settingsStore.getState()
    settingsStore.getState().setSettings({
      customProviders: [...(state.customProviders || []).filter(p => p.id !== profileId), { id: profileId, name: config.name, type: config.protocol as ModelProviderType, isCustom: true }],
      providers: { ...state.providers, [profileId]: { apiKey, apiHost: config.baseUrl, apiPath: config.protocol === 'openai' ? '/chat/completions' : config.protocol === 'openai-responses' ? '/responses' : '/messages', models: config.modelId ? [{ modelId: config.modelId, capabilities: ['vision'] }] : [], useProxy: false } },
      ...(config.modelId ? { defaultChatModel: { provider: profileId, model: config.modelId } } : {}),
    })
    setMessage('连接已保存。新对话默认使用此模型；参数和系统提示词可在 Chatbox 会话设置中调整。')
    return config
  }
  async function request(test: boolean) {
    const config = await save()
    if (test && !config.modelId) throw new Error('测试调用前请填写模型 ID')
    const body = config.protocol === 'claude' ? { model: config.modelId, max_tokens: 16, messages: [{ role: 'user', content: 'Reply OK' }], stream: false } : config.protocol === 'openai-responses' ? { model: config.modelId, input: 'Reply OK', max_output_tokens: 32, store: false, stream: false } : { model: config.modelId, messages: [{ role: 'user', content: 'Reply OK' }], max_tokens: 16, stream: false }
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (config.protocol === 'claude') { headers['anthropic-version'] = '2023-06-01'; if (key) headers['x-api-key'] = key } else if (key) headers.authorization = `Bearer ${key}`
    const response = await (await createModelDependencies()).request.apiRequest({ url: test ? endpoint(config) : config.baseUrl + '/models', method: test ? 'POST' : 'GET', headers, body: test ? JSON.stringify(body) : undefined })
    const text = await response.text()
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${redact(text).slice(0, 1000)}`)
    if (!test) { const data = JSON.parse(text); setModels((data.data || []).map((m: any) => m.id).filter((v: unknown) => typeof v === 'string')); setMessage('模型列表已获取，也可以手动填写模型 ID。') }
    else setMessage(`调用成功 · HTTP ${response.status}。请求与响应已记录到调试面板。`)
  }
  const active = traces.find(t => t.id === selected) || traces[0]
  return <>
    <button className="pg-launch" onClick={() => setOpen(true)}>模型操练场 · 连接 / 调试</button>
    {open && <div className="pg-backdrop"><section className="pg-panel" role="dialog" aria-modal="true" aria-label="模型操练场">
      <header><div><h2>模型操练场</h2><small>基于 Chatbox Community Edition · GPLv3 · 本机 / 外部 API</small></div><button aria-label="关闭操练场配置" onClick={() => setOpen(false)}>关闭</button></header>
      <nav><button onClick={() => setTab('connections')}>连接配置</button><button onClick={() => setTab('traces')}>请求调试 ({traces.length})</button></nav>
      {message && <p role="status" className="pg-status">{message}</p>}
      {tab === 'connections' ? <div className="pg-grid">
        <aside>{Object.entries(connections).map(([profileId, config]) => <button key={profileId} onClick={() => void run(async () => { setId(profileId); setForm(config); setExtra(JSON.stringify(config.extra || {}, null, 2)); setKey(await readKey(profileId)) })}>{config.name}<small>{config.protocol}</small></button>)}<button onClick={() => { setId('playground-' + crypto.randomUUID()); setForm(initial); setKey(''); setExtra('{}') }}>＋ 新连接</button>
          <label>导入 ModelBase 连接<input type="file" accept="application/json,.json" onChange={e => { const file = e.target.files?.[0]; if (file) void run(async () => { if (file.size > 65536) throw new Error('连接文件过大'); const config = validateConnection(JSON.parse(await file.text())); setForm(config); setExtra(JSON.stringify(config.extra || {}, null, 2)); setId('playground-' + crypto.randomUUID()); setKey(''); setMessage('已读取连接，请保存。') }); e.target.value = '' }} /></label>
        </aside>
        <div className="pg-fields">
          <label>连接名称<input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label>
          <label>API 接入模式<select value={form.protocol} onChange={e => setForm({ ...form, protocol: e.target.value as Connection['protocol'] })}><option value="openai">OpenAI · Chat Completions</option><option value="openai-responses">OpenAI · Responses</option><option value="claude">Claude · Messages</option></select></label>
          <label>Base URL（API 根路径）<input value={form.baseUrl} onChange={e => setForm({ ...form, baseUrl: e.target.value })} /></label>
          <small>请求地址：{form.baseUrl.replace(/\/$/, '') + (form.protocol === 'claude' ? '/messages' : form.protocol === 'openai-responses' ? '/responses' : '/chat/completions')}</small>
          <label>模型 ID<input list="pg-models" value={form.modelId} onChange={e => setForm({ ...form, modelId: e.target.value })} placeholder="可手动输入，不要求模型列表接口可用" /></label><datalist id="pg-models">{models.map(model => <option key={model} value={model} />)}</datalist>
          <label>API Key（本机无认证服务可留空）<input type="password" autoComplete="off" value={key} onChange={e => setKey(e.target.value)} /></label>
          {window.electronAPI ? <label><input type="checkbox" checked={form.rememberKey || false} onChange={e => setForm({ ...form, rememberKey: e.target.checked })} /> 记住 Key · Windows 凭据库</label> : <small>Web Key 仅保留在内存，刷新页面后重新输入。</small>}
          <label>超时（秒）<input type="number" min="1" max="600" value={(form.timeoutMs || 120000) / 1000} onChange={e => setForm({ ...form, timeoutMs: Number(e.target.value) * 1000 })} /></label>
          <label>高级参数 JSON<textarea rows={4} value={extra} onChange={e => setExtra(e.target.value)} placeholder='{"temperature":0.7,"top_p":0.9}' /></label>
          <small>Temperature、Top P、最大输出 Token 和系统提示词也可在原有会话设置中调整；这里的高级参数优先。图片最多 4 张，每张 5 MiB。</small>
          <div className="pg-actions"><button disabled={busy} onClick={() => void run(async () => { await save(); await createEmpty('chat'); setOpen(false) })}>保存并新建对话</button><button disabled={busy} onClick={() => void run(() => request(false))}>获取模型</button><button disabled={busy} onClick={() => void run(() => request(true))}>测试调用（少量 Token）</button><button onClick={() => void run(async () => download('model-connection.json', validateConnection({ ...form, extra: JSON.parse(extra) })))}>导出连接</button><button disabled={busy || !connections[id]} onClick={() => void run(async () => { await saveKey(id, '', false); unregisterConnection(id); const next = { ...connections }; delete next[id]; await configStore.setItem('profiles', next); setConnections(next); const state = settingsStore.getState(); const providers = { ...state.providers }; delete providers[id]; settingsStore.getState().setSettings({ providers, customProviders: state.customProviders?.filter(p => p.id !== id) }); setKey(''); setMessage('连接已删除') })}>删除连接</button></div>
        </div>
      </div> : <div className="pg-grid">
        <aside><button onClick={() => download('playground-traces.json', traces)}>导出全部脱敏记录</button><button onClick={() => void run(async () => { await traceStore.clear(); setTraces([]); setSelected('') })}>清空记录</button><label>导入记录<input type="file" accept=".json" onChange={e => { const file = e.target.files?.[0]; if (file) void run(async () => { if (file.size > 25 * 1024 * 1024) throw new Error('记录文件超过 25 MiB'); const records = JSON.parse(await file.text()); if (!Array.isArray(records) || records.some(r => typeof r.id !== 'string' || typeof r.time !== 'string' || !Array.isArray(r.events))) throw new Error('记录格式错误'); for (const record of records) await traceStore.setItem(record.id, redact(record)); setTraces(records.map(redact)) }); e.target.value = '' }} /></label>{traces.map(trace => <button key={trace.id} onClick={() => setSelected(trace.id)}>{trace.model || trace.method} · {trace.status || '…'}<small>{new Date(trace.time).toLocaleString()} · {trace.state}</small></button>)}</aside>
        <div>{!active ? <p>发送一条消息后，在这里查看实际请求、响应和指标。</p> : <><div className="pg-metrics"><span>首字 {active.firstTextMs === undefined ? '未提供' : (active.firstTextMs / 1000).toFixed(2) + 's'}</span><span>总耗时 {active.durationMs === undefined ? '进行中' : (active.durationMs / 1000).toFixed(2) + 's'}</span><span>输入 {active.inputTokens ?? '未提供'}</span><span>输出 {active.outputTokens ?? '未提供'}</span><span>平均速度 {active.outputTokens !== undefined && active.durationMs ? (active.outputTokens / (active.durationMs / 1000)).toFixed(1) + ' token/s' : '未提供'}</span></div><small>平均速度 = 输出 Token ÷ 总耗时；Token 来自接口 usage。{active.truncated && ' 原始事件超过 1 MiB，记录已截断；聊天输出不受影响。'}</small><button onClick={() => download(`trace-${active.id}.json`, active)}>导出此请求</button><pre>{JSON.stringify(active, null, 2)}</pre></>}</div>
      </div>}
    </section></div>}
  </>
}
