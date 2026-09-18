import { expect, it, vi } from 'vitest'
const { handlers } = vi.hoisted(() => ({ handlers: new Map<string, (...args: any[]) => Promise<string>>() }))
vi.mock('electron', () => ({ ipcMain: { handle: (name: string, handler: any) => handlers.set(name, handler) } }))
import './playground-credentials'
it.skipIf(process.platform !== 'win32')('round-trips only its own temporary Windows credential and deletes it', async () => {
  const id = `playground-test-${Date.now()}`
  const frame = {}; const event = { senderFrame: frame, sender: { mainFrame: frame } }
  const handler = handlers.get('playground:credential')!
  try {
    await handler(event, { operation: 'write', id, value: 'test-only-key-123' })
    expect(await handler(event, { operation: 'read', id })).toBe('test-only-key-123')
  } finally { await handler(event, { operation: 'delete', id }) }
  expect(await handler(event, { operation: 'read', id })).toBe('')
}, 60000)
it('rejects malformed credential IDs before spawning a process', async () => {
  const frame = {}; const event = { senderFrame: frame, sender: { mainFrame: frame } }
  await expect(handlers.get('playground:credential')!(event, { operation: 'read', id: '../another-app' })).rejects.toThrow('Invalid credential request')
})
