import { SettingsService } from '@chatbox/core/application/settings'
import type { SettingsStoragePort } from '@chatbox/core/ports'
import { describe, expect, test, vi } from 'vitest'
import { RendererSettingsEffects } from './RendererSettingsEffects'

const memoryStorage: SettingsStoragePort = {
  read: async () => null,
  write: async () => undefined,
  remove: async () => undefined,
}

describe('RendererSettingsEffects', () => {
  test('projects shortcut and proxy changes without applying saved login-item preferences', () => {
    const service = new SettingsService(memoryStorage, { isDesktopLike: true })
    const host = {
      ensureShortcutConfig: vi.fn(),
      ensureProxyConfig: vi.fn(),
      ensureAutoLaunch: vi.fn(),
    }
    const effects = new RendererSettingsEffects(service, host)
    effects.start()
    effects.start()

    service.updateSettings({ language: 'ja' })
    expect(host.ensureShortcutConfig).not.toHaveBeenCalled()
    expect(host.ensureProxyConfig).not.toHaveBeenCalled()
    expect(host.ensureAutoLaunch).not.toHaveBeenCalled()

    service.updateSettings((settings) => ({
      shortcuts: { ...settings.shortcuts, newChat: 'mod+shift+c' },
      proxy: 'http://127.0.0.1:7890',
      autoLaunch: true,
    }))
    expect(host.ensureShortcutConfig).toHaveBeenCalledOnce()
    expect(host.ensureProxyConfig).toHaveBeenCalledWith({ proxy: 'http://127.0.0.1:7890' })
    expect(host.ensureAutoLaunch).not.toHaveBeenCalled()

    effects.stop()
    service.updateSettings({ autoLaunch: false })
    expect(host.ensureAutoLaunch).not.toHaveBeenCalled()
  })
})
