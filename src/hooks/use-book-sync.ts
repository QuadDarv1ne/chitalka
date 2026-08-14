'use client'

import { logger } from '@/lib/logger'
import { useEffect, useRef, useCallback } from 'react'
import { useAuth } from '@/hooks/use-auth'
import type { BookRecord } from '@/lib/library'

const MIN_BETWEEN = 30_000
const BASE_INTERVAL = 60_000
const MAX_INTERVAL = 10 * 60_000

export function bookToSyncPayload(b: BookRecord) {
  return {
    bookId: b.id,
    title: b.title,
    author: b.author,
    format: b.format,
    progress: b.progress ?? 0,
    lastOpenedAt: b.lastOpenedAt,
  }
}

/**
 * Returns the HTTP status on a response, or null on a network error.
 */
export async function syncBooksToServer(books: BookRecord[]): Promise<number | null> {
  if (books.length === 0) return 200
  try {
    const res = await fetch('/api/books/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ books: books.map(bookToSyncPayload) }),
    })
    return res.status
  } catch (e) {
    logger.error('Book sync failed', e)
    return null
  }
}

/**
 * Hook для синхронизации прогресса чтения с сервером.
 * После входа пользователя периодически отправляет прогресс на сервер.
 * Retries with exponential backoff and permanently stops on session
 * expiry (401) instead of hammering the server forever.
 */
export function useBookSync(books: BookRecord[]) {
  const { user } = useAuth()
  const lastSyncRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const booksRef = useRef(books)
  const intervalRef = useRef(BASE_INTERVAL)
  const disabledRef = useRef(false)
  const syncRef = useRef<(force?: boolean) => void>(() => {})

  useEffect(() => {
    booksRef.current = books
  }, [books])

  const sync = useCallback(
    async (force = false) => {
      if (!user || !user.emailVerified || disabledRef.current) return
      const current = booksRef.current
      if (current.length === 0) return

      const now = Date.now()
      // Throttle: max once per 30 seconds (unless force — final flush on
      // unmount/logout must never be swallowed by the throttle)
      if (!force && now - lastSyncRef.current < MIN_BETWEEN) return
      lastSyncRef.current = now

      const status = await syncBooksToServer(current)
      if (status === 401) {
        logger.warn('Book sync stopped: session expired (401)')
        disabledRef.current = true
        return
      }

      // Back off on network errors / server errors, reset on success
      intervalRef.current =
        status !== null && status < 500 ? BASE_INTERVAL : Math.min(intervalRef.current * 2, MAX_INTERVAL)

      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => void syncRef.current(), intervalRef.current)
    },
    [user],
  )

  useEffect(() => {
    syncRef.current = sync
  }, [sync])

  // Periodic sync, rescheduled after every attempt
  useEffect(() => {
    if (!user?.emailVerified) return
    void sync()
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      // Final sync on unmount — bypass the throttle so a recent interval
      // tick cannot swallow pending progress changes.
      void sync(true)
    }
  }, [user, sync])
}