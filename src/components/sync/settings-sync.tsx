'use client'

import { useSettingsSync } from '@/hooks/use-settings-sync'

/**
 * Mount once (in the app root) to keep reader settings in sync with the
 * account while the user changes them from any view.
 */
export function SettingsSynchronizer() {
  useSettingsSync()
  return null
}