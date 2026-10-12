import { describe, expect, it, vi } from 'vitest'
import type { AutoLaunchState } from '../shared/auto-launch'
import { createLoginItemManager, macLoginItemState } from './login-item'

const off: AutoLaunchState = { enabled: false, status: 'disabled' }
const on: AutoLaunchState = { enabled: true, status: 'enabled' }

describe('macOS native login-item state', () => {
  it.each([
    ['enabled', true, 'enabled'],
    ['not-registered', false, 'disabled'],
    ['requires-approval', false, 'requires-approval'],
    ['not-found', false, 'not-found'],
    ['future-state', null, 'unknown'],
  ] as const)('maps %s without assuming a successful request', (status, enabled, expected) => {
    expect(macLoginItemState({ status, openAtLogin: true })).toEqual({ enabled, status: expected })
  })

  it('supports legacy native login-item state without AppleScript', () => {
    expect(macLoginItemState({ openAtLogin: true })).toEqual(on)
    expect(macLoginItemState({ openAtLogin: false, status: '' })).toEqual(off)
  })

  it('verifies the actual result after a void setter', async () => {
    const read = vi.fn().mockResolvedValueOnce(off).mockResolvedValueOnce(on)
    const write = vi.fn().mockResolvedValue(undefined)
    expect(await createLoginItemManager({ read, write }).ensure(true)).toEqual(on)
    expect(write).toHaveBeenCalledExactlyOnceWith(true)
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('does not report enabled when the OS did not apply the request', async () => {
    const manager = createLoginItemManager({ read: vi.fn().mockResolvedValue(off), write: vi.fn() })
    expect(await manager.ensure(true)).toEqual({ ...off, failure: 'not-applied' })
  })

  it('does not override user-disabled or policy-controlled macOS login items', async () => {
    const approval: AutoLaunchState = { enabled: false, status: 'requires-approval' }
    const write = vi.fn()
    const read = vi.fn().mockResolvedValue(approval)
    const manager = createLoginItemManager({ read, write })
    expect(await manager.read()).toEqual(approval)
    expect(await manager.ensure(true)).toEqual(approval)
    expect(await manager.ensure(true)).toEqual(approval)
    expect(write).not.toHaveBeenCalled()
    read.mockResolvedValue(on)
    expect(await manager.read()).toEqual(on)
    expect(write).not.toHaveBeenCalled()
  })

  it('reports newly required approval without claiming the requested enable succeeded', async () => {
    const approval: AutoLaunchState = { enabled: false, status: 'requires-approval' }
    const read = vi.fn().mockResolvedValueOnce(off).mockResolvedValue(approval)
    const write = vi.fn()
    const manager = createLoginItemManager({ read, write })
    expect(await manager.ensure(true)).toEqual(approval)
    expect(await manager.ensure(true)).toEqual(approval)
    expect(write).toHaveBeenCalledExactlyOnceWith(true)
  })

  it('can remove a pending approval only by an explicit disable request', async () => {
    const read = vi.fn().mockResolvedValueOnce({ enabled: false, status: 'requires-approval' }).mockResolvedValueOnce(off)
    const write = vi.fn()
    expect(await createLoginItemManager({ read, write }).ensure(false)).toEqual(off)
    expect(write).toHaveBeenCalledExactlyOnceWith(false)
  })

  it('distinguishes an app request failure and retains actual enabled state', async () => {
    const write = vi.fn().mockRejectedValue(new Error('native failure'))
    const manager = createLoginItemManager({ read: vi.fn().mockResolvedValue(on), write })
    expect(await manager.ensure(false)).toEqual({ ...on, failure: 'change-failed' })
  })

  it('does not mutate after a failed status read', async () => {
    const write = vi.fn()
    const manager = createLoginItemManager({ read: vi.fn().mockRejectedValue(new Error('unavailable')), write })
    expect(await manager.ensure(true)).toEqual({ enabled: null, status: 'unknown', failure: 'read-failed' })
    expect(write).not.toHaveBeenCalled()
  })

  it('serializes opposing requests and avoids duplicate mutations', async () => {
    let actual = off
    const write = vi.fn(async (enabled: boolean) => { actual = enabled ? on : off })
    const manager = createLoginItemManager({ read: async () => actual, write })
    expect(await Promise.all([manager.ensure(true), manager.ensure(true), manager.ensure(false)])).toEqual([on, on, off])
    expect(write.mock.calls).toEqual([[true], [false]])
  })

  it('a failure does not poison a user-initiated retry', async () => {
    let actual = off
    const write = vi.fn().mockRejectedValueOnce(new Error('failed')).mockImplementationOnce(async () => { actual = on })
    const manager = createLoginItemManager({ read: async () => actual, write })
    expect((await manager.ensure(true)).failure).toBe('change-failed')
    expect(await manager.ensure(true)).toEqual(on)
  })
})
