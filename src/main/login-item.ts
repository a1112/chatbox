import type { AutoLaunchState } from '../shared/auto-launch'

export interface LoginItemBackend {
  read(): Promise<AutoLaunchState>
  write(enabled: boolean): Promise<void>
}

/** Electron 35.7.5 reports SMAppService status on macOS 13+, and openAtLogin
 * for legacy login items/older macOS. Unknown future states are not denial. */
export function macLoginItemState(settings: { openAtLogin: boolean; status?: string }): AutoLaunchState {
  switch (settings.status) {
    case 'requires-approval':
      return { enabled: false, status: 'requires-approval' }
    case 'not-found':
      return { enabled: false, status: 'not-found' }
    case 'enabled':
      return { enabled: true, status: 'enabled' }
    case 'not-registered':
      return { enabled: false, status: 'disabled' }
    case undefined:
    case '':
      return { enabled: settings.openAtLogin, status: settings.openAtLogin ? 'enabled' : 'disabled' }
    default:
      return { enabled: null, status: 'unknown' }
  }
}

export function createLoginItemManager(backend: LoginItemBackend) {
  let queue: Promise<unknown> = Promise.resolve()
  const read = async (): Promise<AutoLaunchState> => {
    try {
      return await backend.read()
    } catch {
      return { enabled: null, status: 'unknown', failure: 'read-failed' }
    }
  }
  return {
    read,
    ensure(enabled: boolean): Promise<AutoLaunchState> {
      const operation = queue.then(async () => {
        const before = await read()
        // Never unregister/re-register to get around macOS user approval or a
        // policy restriction. Refresh is read-only; the user controls Settings.
        if (
          before.enabled === null ||
          before.status === 'unsupported' ||
          (enabled && before.status === 'requires-approval')
        ) {
          return before
        }
        if (before.enabled === enabled && before.status !== 'requires-approval') return before
        try {
          await backend.write(enabled)
        } catch {
          const actual = await read()
          return { ...actual, failure: 'change-failed' as const }
        }
        const actual = await read()
        if (actual.status === 'requires-approval') {
          return enabled ? actual : { ...actual, failure: 'not-applied' as const }
        }
        if (actual.enabled !== enabled) return { ...actual, failure: actual.failure ?? ('not-applied' as const) }
        return actual
      })
      queue = operation.catch(() => undefined)
      return operation
    },
  }
}
