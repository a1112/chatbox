import type { SettingsStoragePort } from '@chatbox/core/ports'
import storage from '@/storage'
import { restoreSettings, stripSettings } from '@/playground/credentials'

export const SETTINGS_STORAGE_KEY = 'settings'

/**
 * Renderer adapter for the historical global settings value.
 *
 * It deliberately stores the raw envelope unchanged; SettingsService owns
 * validation, migrations and versioning.
 */
export class RendererSettingsStorage implements SettingsStoragePort {
  read(): Promise<unknown> {
    return storage.getItem(SETTINGS_STORAGE_KEY, null).then(restoreSettings)
  }

  write(value: unknown): Promise<void> {
    return storage.setItem(SETTINGS_STORAGE_KEY, stripSettings(value))
  }

  remove(): Promise<void> {
    return storage.removeItem(SETTINGS_STORAGE_KEY)
  }
}
