import { describe, expect, it, vi } from 'vitest'
import type { AutoLaunchState } from '@shared/auto-launch'
import { AutoLaunchController } from './AutoLaunchController'

const off: AutoLaunchState = { enabled: false, status: 'disabled' }
const on: AutoLaunchState = { enabled: true, status: 'enabled' }
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((ok, no) => { resolve = ok; reject = no })
  return { promise, resolve, reject }
}
function setup() {
  const host = { getAutoLaunchState: vi.fn().mockResolvedValue(off), ensureAutoLaunch: vi.fn().mockResolvedValue(on) }
  const persist = vi.fn()
  return { host, persist, controller: new AutoLaunchController(host, persist) }
}

describe('startup setting result handling', () => {
  it('does not save an optimistic preference and coalesces repeated clicks', async () => {
    const { host, persist, controller } = setup()
    const request = deferred<AutoLaunchState>()
    host.ensureAutoLaunch.mockReturnValue(request.promise)
    const pending = controller.setEnabled(true)
    await controller.setEnabled(true)
    expect(host.ensureAutoLaunch).toHaveBeenCalledExactlyOnceWith(true)
    expect(persist).not.toHaveBeenCalled()
    expect(controller.getSnapshot().pending).toBe(true)
    request.resolve(on)
    await pending
    expect(persist).toHaveBeenCalledExactlyOnceWith(true)
    expect(controller.getSnapshot()).toEqual({ ...on, pending: false })
  })

  it('reconciles native failure with actual state and permits explicit retry', async () => {
    const { host, persist, controller } = setup()
    host.ensureAutoLaunch.mockResolvedValueOnce({ ...off, failure: 'change-failed' })
    await controller.setEnabled(true)
    expect(persist).toHaveBeenLastCalledWith(false)
    expect(controller.getSnapshot()).toEqual({ ...off, failure: 'change-failed', pending: false })
    await controller.setEnabled(true)
    expect(controller.getSnapshot().enabled).toBe(true)
  })

  it('handles rejected IPC as unknown instead of reporting enabled or denied', async () => {
    const { host, persist, controller } = setup()
    host.ensureAutoLaunch.mockRejectedValue(new Error('IPC interrupted'))
    await controller.setEnabled(true)
    expect(controller.getSnapshot()).toEqual({ enabled: null, status: 'unknown', failure: 'change-failed', pending: false })
    expect(persist).not.toHaveBeenCalled()
    await controller.refresh()
    expect(controller.getSnapshot()).toEqual({ ...off, pending: false })
  })

  it('refresh observes Settings revocation without re-enabling it', async () => {
    const { host, persist, controller } = setup()
    host.getAutoLaunchState.mockResolvedValue({ enabled: false, status: 'requires-approval' })
    await controller.refresh()
    expect(persist).toHaveBeenCalledWith(false)
    expect(controller.getSnapshot().status).toBe('requires-approval')
    expect(host.ensureAutoLaunch).not.toHaveBeenCalled()
  })

  it('ignores stale read results', async () => {
    const { host, persist, controller } = setup()
    const old = deferred<AutoLaunchState>()
    host.getAutoLaunchState.mockReturnValueOnce(old.promise).mockResolvedValueOnce(off)
    const first = controller.refresh()
    await controller.refresh()
    old.resolve(on)
    await first
    expect(controller.getSnapshot()).toEqual({ ...off, pending: false })
    expect(persist).toHaveBeenCalledExactlyOnceWith(false)
  })

  it('does not refresh over an in-flight user action', async () => {
    const { host, controller } = setup()
    const request = deferred<AutoLaunchState>()
    host.ensureAutoLaunch.mockReturnValue(request.promise)
    const pending = controller.setEnabled(true)
    await controller.refresh()
    expect(host.getAutoLaunchState).not.toHaveBeenCalled()
    request.resolve(on)
    await pending
  })

  it('closing a view removes its listener while preserving the real native outcome', async () => {
    const { host, controller, persist } = setup()
    const request = deferred<AutoLaunchState>()
    host.ensureAutoLaunch.mockReturnValue(request.promise)
    const listener = vi.fn()
    const unsubscribe = controller.subscribe(listener)
    const pending = controller.setEnabled(true)
    unsubscribe()
    request.resolve(on)
    await pending
    expect(listener).toHaveBeenCalledTimes(1)
    expect(persist).toHaveBeenCalledWith(true)
    expect(controller.getSnapshot().enabled).toBe(true)
  })

  it('disposing the controller ignores late results', async () => {
    const { host, controller, persist } = setup()
    const request = deferred<AutoLaunchState>()
    host.ensureAutoLaunch.mockReturnValue(request.promise)
    const pending = controller.setEnabled(true)
    controller.dispose()
    request.resolve(on)
    await pending
    expect(persist).not.toHaveBeenCalled()
  })
})
