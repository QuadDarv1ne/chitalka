'use client'

import { logger } from '@/lib/logger'
import { useEffect, useRef, useCallback } from 'react'
import { useAuth } from '@/hooks/use-auth'
import { updateBook, getBook, type BookRecord } from '@/lib/library'

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
    cfi: b.cfi,
    textPosition: b.textPosition,
    pdfPage: b.pdfPage,
    cbzPage: b.cbzPage,
    audioTrack: b.audioTrack,
    audioTime: b.audioTime,
    rating: b.rating,
    favorite: b.favorite,
  }
}

/**
 * SyncBook from server response — contains only metadata fields.
 */
export interface SyncBook {
  bookId: string
  title: string
  author: string
  format: string
  progress: number
  lastOpenedAt: number | null
  cfi: string | null
  textPosition: number | null
  pdfPage: number | null
  cbzPage: number | null
  audioTrack: number | null
  audioTime: number | null
  rating: number | null
  favorite: boolean | null
  updatedAt: number
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
 * Fetch server-side book metadata and apply to local IndexedDB.
 * Returns the number of books updated locally.
 *
 * Conflict resolution: server wins only if its updatedAt is newer than
 * the local record's last write. This avoids overwriting a local change
 * that happened after the last sync.
 */
export async function syncBooksFromServer(): Promise<{ updated: number; localOnly: number }> {
  try {
    const res = await fetch('/api/books/sync')
    if (res.status === 401) return { updated: 0, localOnly: 0 }

    if (!res.ok) {
      logger.error('Failed to fetch synced books', await res.text())
      return { updated: 0, localOnly: 0 }
    }

    const data = await res.json()
    const serverBooks: SyncBook[] = data?.books ?? []
    if (serverBooks.length === 0) return { updated: 0, localOnly: 0 }

    let updated = 0
    let localOnly = 0
    const serverIds = new Set<string>()

    for (const sb of serverBooks) {
      serverIds.add(sb.bookId)
      const local = await getBook(sb.bookId)

      if (!local) {
        // Book exists on server but not locally — this shouldn't normally
        // happen (books are local-first), but skip it to avoid creating
        // records without blobs.
        continue
      }

      // Compare updatedAt timestamps: only apply server data if it's newer
      // than the local record's last modification. We use local addedAt as a
      // proxy for "last meaningful write" since we don't track per-field
      // timestamps. If the server has a more recent updatedAt, its version
      // of progress/position is fresher.
      const serverTime = sb.updatedAt
      const localTime = local.lastOpenedAt ?? local.addedAt

      if (serverTime > localTime) {
        await updateBook(sb.bookId, {
          progress: sb.progress,
          lastOpenedAt: sb.lastOpenedAt ?? undefined,
          cfi: sb.cfi ?? undefined,
          textPosition: sb.textPosition ?? undefined,
          pdfPage: sb.pdfPage ?? undefined,
          cbzPage: sb.cbzPage ?? undefined,
          audioTrack: sb.audioTrack ?? undefined,
          audioTime: sb.audioTime ?? undefined,
          rating: sb.rating ?? undefined,
          favorite: sb.favorite ?? undefined,
        })
        updated++
      } else {
        localOnly++
      }
    }

    if (updated > 0) {
      logger.info(`Synced ${updated} book(s) from server`)
    }

    return { updated, localOnly }
  } catch (e) {
    logger.error('Book sync from server failed', e)
    return { updated: 0, localOnly: 0 }
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

/**
 * Hook to pull server-side book metadata into local IndexedDB.
 * Triggers on login and periodically while authenticated.
 */
export function useServerBookSync(refresh: () => Promise<void>) {
  const { user } = useAuth()
  const lastPullRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const disabledRef = useRef(false)
  const pullRef = useRef<() => void>(() => {})

  const pull = useCallback(async () => {
    if (!user || !user.emailVerified || disabledRef.current) return
    const now = Date.now()
    // Throttle: max once per 60 seconds
    if (now - lastPullRef.current < 60_000) return
    lastPullRef.current = now

    const { updated } = await syncBooksFromServer()
    if (updated > 0) {
      void refresh()
    }
    if (updated === 0 && !disabledRef.current) {
      // Keep pulling periodically
      timerRef.current = setTimeout(() => void pullRef.current(), BASE_INTERVAL)
    }
  }, [user, refresh])

  useEffect(() => {
    pullRef.current = pull
  }, [pull])

  useEffect(() => {
    if (!user?.emailVerified) return
    void pull()
  }, [user])
}