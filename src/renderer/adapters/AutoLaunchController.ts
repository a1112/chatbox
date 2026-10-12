import type { AutoLaunchState } from '@shared/auto-launch'

export type AutoLaunchView = AutoLaunchState & { pending: boolean }
export interface AutoLaunchHost {
  getAutoLaunchState(): Promise<AutoLaunchState>
  ensureAutoLaunch(enabled: boolean): Promise<AutoLaunchState>
}

/** A shared controller keeps remounted settings views from issuing duplicate
 * requests. Only confirmed OS state is persisted; refresh never writes the OS. */
export class AutoLaunchController {
  private state: AutoLaunchView = { enabled: null, status: 'unknown', pending: false }
  private generation = 0
  private changing = false
  private disposed = false
  private listeners = new Set<() => void>()

  constructor(
    private readonly host: AutoLaunchHost,
    private readonly persist: (enabled: boolean) => void
  ) {}

  getSnapshot = () => this.state
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  refresh = async () => {
    if (this.changing || this.disposed) return
    await this.run(() => this.host.getAutoLaunchState(), 'read-failed')
  }

  setEnabled = async (enabled: boolean) => {
    if (this.state.pending || this.disposed) return
    this.changing = true
    try {
      await this.run(() => this.host.ensureAutoLaunch(enabled), 'change-failed')
    } finally {
      this.changing = false
    }
  }

  dispose() {
    this.disposed = true
    this.generation++
    this.listeners.clear()
  }

  private async run(operation: () => Promise<AutoLaunchState>, failure: AutoLaunchState['failure']) {
    const generation = ++this.generation
    this.publish({ ...this.state, pending: true })
    let result: AutoLaunchState
    try {
      result = await operation()
    } catch {
      // A rejected IPC does not establish the current OS setting.
      result = { enabled: null, status: 'unknown', failure }
    }
    if (generation !== this.generation || this.disposed) return
    if (result.enabled !== null) this.persist(result.enabled)
    this.publish({ ...result, pending: false })
  }

  private publish(state: AutoLaunchView) {
    this.state = state
    for (const listener of this.listeners) listener()
  }
}
