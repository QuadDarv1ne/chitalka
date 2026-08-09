'use client'

import { useEffect, useRef } from 'react'
import { useAuth } from '@/hooks/use-auth'
import { useReaderStore, type ReaderSettings } from '@/store/reader-store'

const PUSH_DEBOUNCE_MS = 800

/**
 * Two-way sync of reader settings with the server (`/api/user/settings`).
 *
 * - On login (first run for an account): pull server settings and apply them.
 *   A fresh account without a server row adopts the local settings as its
 *   baseline (the server defaults are never clobbered onto the user's
 *   customizations) — see `adoptLocal`.
 * - Subsequent changes are pushed up, debounced. The pushed JSON is
 *   remembered (`syncedJsonRef`) so the pull echo never round-trips back.
 */
export function useSettingsSync() {
  const { user } = useAuth()
  const userId = user?.id ?? null
  const settings = useReaderStore((s) => s.settings)
  const updateSettings = useReaderStore((s) => s.updateSettings)

  const syncedJsonRef = useRef('')
  const loadedForRef = useRef<string | null>(null)

  useEffect(() => {
    if (!userId) {
      loadedForRef.current = null
      syncedJsonRef.current = ''
      return
    }

    const json = JSON.stringify(settings)
    const push = (body: string): Promise<boolean> =>
      fetch('/api/user/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body,
        credentials: 'include',
      })
        .then((res) => res.ok)
        .catch(() => false)

    // First run for this account: pull the server settings once and seed
    // the push guard so the fetch echo doesn't bounce back.
    if (loadedForRef.current !== userId) {
      loadedForRef.current = userId
      let cancelled = false
      ;(async () => {
        try {
          const res = await fetch('/api/user/settings', {
            credentials: 'include',
          })
          if (!res.ok || cancelled) return
          const data = (await res.json()) as {
            exists: boolean
            settings: ReaderSettings | null
          }
          if (cancelled) return
          if (data.exists && data.settings) {
            updateSettings(data.settings)
            syncedJsonRef.current = JSON.stringify(data.settings)
          } else {
            // No row on the server — adopt the local settings as the
            // baseline and push them once to create the row.
            syncedJsonRef.current = json
            const ok = await push(json)
            if (!ok && !cancelled) syncedJsonRef.current = ''
          }
        } catch {
          // Offline / server error — keep working fully local
        }
      })()
      return () => {
        cancelled = true
      }
    }

    if (json === syncedJsonRef.current) return

    const t = setTimeout(() => {
      push(json).then((ok) => {
        if (ok) syncedJsonRef.current = json
      })
    }, PUSH_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [settings, userId, updateSettings])
}