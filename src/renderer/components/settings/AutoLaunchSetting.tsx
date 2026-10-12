import { Button, Stack, Switch, Text } from '@mantine/core'
import { useEffect, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { AutoLaunchController } from '@/adapters/AutoLaunchController'
import platform from '@/platform'
import { settingsStore } from '@/stores/settingsStore'

// Delayed platform access avoids composition-root initialization cycles.
const controller = new AutoLaunchController(
  {
    getAutoLaunchState: () => platform.getAutoLaunchState(),
    ensureAutoLaunch: (enabled) => platform.ensureAutoLaunch(enabled),
  },
  (autoLaunch) => settingsStore.getState().setSettings({ autoLaunch })
)

export function AutoLaunchSetting() {
  const { t } = useTranslation()
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  useEffect(() => {
    void controller.refresh()
    return platform.onWindowFocused(() => void controller.refresh())
  }, [])

  const message =
    state.status === 'requires-approval'
      ? t(
          'macOS requires approval in System Settings > General > Login Items & Extensions. Allow Chatbox there, then check again. Chatbox will not override this setting.'
        )
      : state.status === 'not-found'
        ? t('macOS could not find the login item. Open the installed Chatbox app from Applications, then check again.')
        : state.status === 'unsupported'
          ? t('Startup settings are unavailable in this build.')
          : state.status === 'unknown'
            ? t('The startup setting is unknown. Check again to read the current system setting.')
            : t('This shows the current system setting. Changes apply immediately.')

  return (
    <Stack gap="xs">
      <Switch
        label={t('Launch at system startup')}
        checked={state.enabled === true}
        disabled={
          state.pending ||
          state.enabled === null ||
          state.status === 'requires-approval' ||
          state.status === 'not-found'
        }
        onChange={(event) => void controller.setEnabled(event.currentTarget.checked)}
      />
      <Text size="sm" role="status">
        {state.pending ? t('Checking startup setting...') : message}
      </Text>
      {!state.pending && state.failure && (
        <Text size="sm" role="alert">
          {state.failure === 'read-failed'
            ? t('Could not read the current startup setting. Check again.')
            : state.failure === 'not-applied'
              ? t('The requested startup change was not applied. Check the current system setting before retrying.')
              : t('The startup request reported an error. Check the current system setting before retrying.')}
        </Text>
      )}
      <Button variant="subtle" size="compact-sm" disabled={state.pending} onClick={() => void controller.refresh()}>
        {t('Check again')}
      </Button>
    </Stack>
  )
}

if (import.meta.hot) import.meta.hot.dispose(() => controller.dispose())
