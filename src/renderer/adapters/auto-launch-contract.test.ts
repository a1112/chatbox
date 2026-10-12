import fs from 'node:fs'
import path from 'node:path'
import { expect, it, vi } from 'vitest'
import { RendererSettingsEffects } from './RendererSettingsEffects'

it('hydration or backup settings changes cannot modify native login items', () => {
  let listener: (next: object, previous: object) => void = () => undefined
  const unsubscribe = vi.fn()
  const service = { subscribe: vi.fn((callback: (next: object, previous: object) => void) => { listener = callback; return unsubscribe }) }
  const host = { ensureShortcutConfig: vi.fn(), ensureProxyConfig: vi.fn(), ensureAutoLaunch: vi.fn() }
  // The pure effects adapter only depends on subscribe; no application graph is booted.
  const effects = new RendererSettingsEffects(service as unknown as ConstructorParameters<typeof RendererSettingsEffects>[0], host)
  effects.start()
  effects.start()
  listener({ autoLaunch: true }, { autoLaunch: false })
  listener({ autoLaunch: false }, { autoLaunch: true })
  expect(host.ensureAutoLaunch).not.toHaveBeenCalled()
  expect(service.subscribe).toHaveBeenCalledTimes(1)
  effects.stop()
  expect(unsubscribe).toHaveBeenCalledTimes(1)
})

it('macOS adapter uses pinned Electron native APIs and returns results over IPC', () => {
  const read = (relative: string) => fs.readFileSync(path.resolve(relative), 'utf8')
  const adapter = read('src/main/autoLauncher.ts')
  expect(adapter).toContain('macLoginItemState(app.getLoginItemSettings())')
  expect(adapter).toContain('app.setLoginItemSettings({ openAtLogin: enabled })')
  expect(adapter).not.toContain('getSettings')
  const main = read('src/main/main.ts')
  expect(main).toContain("ipcMain.handle('getAutoLaunchState'")
  expect(main).toContain('return autoLauncher.ensure(enable)')
  expect(main).toContain("return { enabled: null, status: 'unsupported' }")
  expect(read('src/renderer/app/renderer-application.ts')).not.toContain('void platform.ensureAutoLaunch')
})
