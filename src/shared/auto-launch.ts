/** Native state, not the saved preference or successful IPC delivery. */
export interface AutoLaunchState {
  enabled: boolean | null
  status: 'enabled' | 'disabled' | 'requires-approval' | 'not-found' | 'unknown' | 'unsupported'
  failure?: 'read-failed' | 'change-failed' | 'not-applied'
}
