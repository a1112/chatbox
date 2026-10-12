# macOS login-item state and recovery

The lockfile pins Electron 35.7.5. Its native `app.getLoginItemSettings()` and
`app.setLoginItemSettings()` APIs are used on macOS. Electron uses ServiceManagement
on macOS 13+ with a legacy-native fallback on older systems or legacy items. No
System Events AppleScript, Automation purpose or Accessibility permission is
needed for this feature. Existing non-macOS auto-launch behavior is retained.

A setter returning void or IPC resolving is not success. The manager reads actual
state before/after changes and reports enabled, disabled, requires approval,
missing, unknown or unsupported separately from request/read failures. A
requires-approval state may reflect a user-disabled setting or system policy;
the application does not claim the user denied a prompt. It never unregisters
and re-registers an item to override that choice.

Only explicit setting actions modify login items. Hydration, backup restore,
settings synchronization and focus refresh cannot enable or disable the OS item.
Both settings surfaces show the current native state, save confirmed outcomes,
disable repeated requests while pending, and provide manual Settings guidance and
Check again. The native manager serializes requests from multiple views/windows.
An interrupted IPC produces unknown state, not a successful enabled preference.
No login-item changes run at module import or app startup.

## Targeted verification

`pnpm test:permissions` uses a focused checked-in Vitest configuration. It exercises
production native-state mapping, failed setters, unchanged native state,
requires-approval, retry, request serialization, IPC rejection, stale reads, closed
views and non-mutating settings effects. It never launches Electron or changes an
actual login item, and does not load `.env` files or live API tests.

`pnpm check:permissions` type-checks the native adapter and pure state/controller
modules against the installed Electron types.

This is not the full application test/build graph. Full app builds, rendered
Electron acceptance and signed macOS validation must be reported separately.

## Native release acceptance

On a signed installed `.app`, test existing legacy login items, fresh enable and
disable, Settings revocation, restricted policy, requires-approval recovery,
missing/moved app bundle, focus refresh, repeated clicks, close/reopen during a
request and updates. Confirm there is no System Events prompt, no automatic
re-enable after revocation, and the visible state matches System Settings.

Pinned primary references:
- https://github.com/electron/electron/blob/v35.7.5/docs/api/app.md#appgetloginitemsettingsoptions-macos-windows
- https://github.com/electron/electron/blob/v35.7.5/shell/browser/browser_mac.mm
