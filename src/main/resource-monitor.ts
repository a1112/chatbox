import { app, BrowserWindow, ipcMain } from 'electron'
import { cpus } from 'node:os'

let sampled = false
export function registerResourceMonitor() {
  ipcMain.handle('app-resources:snapshot', (event) => {
    if (!BrowserWindow.fromWebContents(event.sender) || event.senderFrame !== event.sender.mainFrame) {
      throw new Error('Resource monitoring is restricted to application windows')
    }
    const processes = app.getAppMetrics()
    const cpu = processes.reduce((total, process) => total + process.cpu.percentCPUUsage, 0)
    const snapshot = {
      cpuPercent: sampled ? Math.min(100, Math.max(0, cpu / Math.max(1, cpus().length))) : null,
      memoryBytes: processes.reduce((total, process) => total + process.memory.workingSetSize * 1024, 0),
      processCount: processes.length,
      readBytesPerSecond: null,
      writeBytesPerSecond: null,
      gpuPercent: null,
    }
    sampled = true
    return snapshot
  })
}
