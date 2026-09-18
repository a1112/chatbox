import { keys } from './runtime'

// Secrets remain in memory in the Web host. The desktop host resolves keys via
// Windows Credential Manager; persisted settings never contain the key itself.
export async function saveKey(id: string, value: string, remember: boolean) {
  keys.set(id, value)
  if (window.electronAPI) await window.electronAPI.invoke('playground:credential', { operation: remember && value ? 'write' : 'delete', id, value: remember ? value : '' })
}
export async function readKey(id: string): Promise<string> {
  if (keys.has(id)) return keys.get(id) || ''
  const key = window.electronAPI && id.startsWith('playground-') ? await window.electronAPI.invoke('playground:credential', { operation: 'read', id }) : ''
  keys.set(id, key || '')
  return key || ''
}
export function stripSettings(value: any): any {
  if (Array.isArray(value)) return value.map(stripSettings)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, /^(apiKey|accessToken|refreshToken|secretKey|accessKey|sessionToken)$/.test(key) ? '' : stripSettings(entry)]))
}
export async function restoreSettings(value: any): Promise<any> {
  if (!value || typeof value !== 'object') return value
  const clean = stripSettings(value)
  const state = clean.state || clean
  for (const [id, provider] of Object.entries(state.providers || {})) (provider as any).apiKey = await readKey(id)
  return clean
}
