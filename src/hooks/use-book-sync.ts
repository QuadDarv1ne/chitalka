'use client'

import { useEffect, useRef, useCallback } from 'react'
import { useAuth } from '@/hooks/use-auth'
import type { BookRecord } from '@/lib/library'

/**
 * Hook для синхронизации прогресса чтения с сервером.
 * После входа пользователя периодически отправляет прогресс на сервер.
 */
export function useBookSync(books: BookRecord[]) {
  const { user } = useAuth()
  const lastSyncRef = useRef<number>(0)
  const syncIntervalRef = useRef<NodeJS.Timeout | null>(null)

  const sync = useCallback(async () => {
    if (!user) return
    // Only sync if email is verified
    if (!user.emailVerified) return
    if (books.length === 0) return

    const now = Date.now()
    // Throttle: max once per 30 seconds
    if (now - lastSyncRef.current < 30000) return
    lastSyncRef.current = now

    try {
      await fetch('/api/books/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          books: books.map((b) => ({
            bookId: b.id,
            title: b.title,
            author: b.author,
            format: b.format,
            progress: b.progress ?? 0,
            lastOpenedAt: b.lastOpenedAt,
          })),
        }),
      })
    } catch (e) {
      console.error('Book sync failed', e)
    }
  }, [user, books])

  // Periodic sync (every 60 seconds)
  useEffect(() => {
    if (!user?.emailVerified) return
    sync()
    syncIntervalRef.current = setInterval(sync, 60000)
    return () => {
      if (syncIntervalRef.current) {
        clearInterval(syncIntervalRef.current)
      }
      // Final sync on unmount
      sync()
    }
  }, [user, sync])
}
