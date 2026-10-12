import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), legacy: vi.fn() }))
vi.mock('electron', () => ({ app: { getLoginItemSettings: native.get, setLoginItemSettings: native.set } }))
vi.mock('auto-launch', () => ({ default: native.legacy }))
const platform = Object.getOwnPropertyDescriptor(process, 'platform')!

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
})
afterEach(() => {
  Object.defineProperty(process, 'platform', platform)
})

it('reads the exact Electron adapter without constructing the AppleScript backend', async () => {
  const { app } = await import('electron')
  expect(vi.isMockFunction(app.getLoginItemSettings)).toBe(true)
  native.get.mockReturnValue({ openAtLogin: false, status: 'requires-approval' })
  const launcher = await import('./autoLauncher')
  expect(native.get).not.toHaveBeenCalled() // No startup read or write at module import.
  expect(await launcher.read()).toEqual({ enabled: false, status: 'requires-approval' })
  expect(await launcher.ensure(true)).toEqual({ enabled: false, status: 'requires-approval' })
  expect(native.set).not.toHaveBeenCalled()
  expect(native.legacy).not.toHaveBeenCalled()
})

it('verifies an explicit native mutation instead of trusting the void return', async () => {
  const { app } = await import('electron')
  expect(vi.isMockFunction(app.setLoginItemSettings)).toBe(true)
  native.get.mockReturnValueOnce({ openAtLogin: false, status: 'not-registered' })
    .mockReturnValueOnce({ openAtLogin: true, status: 'enabled' })
  const launcher = await import('./autoLauncher')
  expect(await launcher.ensure(true)).toEqual({ enabled: true, status: 'enabled' })
  expect(native.set).toHaveBeenCalledExactlyOnceWith({ openAtLogin: true })
  expect(native.get).toHaveBeenCalledTimes(2)
  expect(native.legacy).not.toHaveBeenCalled()
})

it('returns a failed native request with actual state over the adapter boundary', async () => {
  const { app } = await import('electron')
  expect(vi.isMockFunction(app.setLoginItemSettings)).toBe(true)
  native.get.mockReturnValue({ openAtLogin: false, status: 'not-registered' })
  native.set.mockImplementationOnce(() => { throw new Error('fixture request failure') })
  const launcher = await import('./autoLauncher')
  expect(await launcher.ensure(true)).toEqual({ enabled: false, status: 'disabled', failure: 'change-failed' })
  expect(native.legacy).not.toHaveBeenCalled()
})
