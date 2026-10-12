import { defineConfig } from 'vitest/config'

// Isolated native-state and IPC lifecycle tests. No app bootstrap, .env files,
// Electron launch, login-item changes, external APIs, or route generation.
export default defineConfig({
  envDir: false,
  test: {
    environment: 'node',
    include: [
      'src/main/autoLauncher.test.ts',
      'src/main/login-item.test.ts',
      'src/renderer/adapters/AutoLaunchController.test.ts',
      'src/renderer/adapters/auto-launch-contract.test.ts',
    ],
    maxWorkers: 1,
    fileParallelism: false,
  },
})
