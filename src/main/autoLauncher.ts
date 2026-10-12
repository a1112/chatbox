import AutoLaunch from 'auto-launch'
import { app } from 'electron'
import type { AutoLaunchState } from '../shared/auto-launch'
import { createLoginItemManager, macLoginItemState } from './login-item'

let autoLaunch: AutoLaunch | null = null
function getLegacyLauncher() {
  autoLaunch ??= new AutoLaunch({ name: 'Chatbox' })
  return autoLaunch
}

const manager = createLoginItemManager({
  async read(): Promise<AutoLaunchState> {
    if (process.platform === 'darwin') {
      return macLoginItemState(app.getLoginItemSettings())
    }
    const enabled = await getLegacyLauncher().isEnabled()
    return { enabled, status: enabled ? 'enabled' : 'disabled' }
  },
  async write(enabled: boolean) {
    if (process.platform === 'darwin') {
      // Native ServiceManagement/legacy fallback, not System Events scripting.
      // Its void return is NOT proof of success; the manager re-reads state.
      app.setLoginItemSettings({ openAtLogin: enabled })
      return
    }
    if (enabled) await getLegacyLauncher().enable()
    else await getLegacyLauncher().disable()
  },
})

export const read = manager.read
export const ensure = manager.ensure
