'use client'

import { useEffect, useRef } from 'react'
import { useReaderStore } from '@/store/reader-store'

/**
 * Tracks reading time and pages flipped.
 * Logs time every 60s and pages on every flush (so page counts survive
 * quick sessions and tab closes mid-session).
 *
 * `active=false` pauses the time accumulator (used by the audio reader while
 * playback is paused/sleep-timer stopped) — elapsed wall-clock time during a
 * pause must not be credited as reading time.
 */
export function useReadingTracker(bookId: string, pagesFlipped: number, active = true) {
  const logReading = useReaderStore((s) => s.logReading)
  const startTimeRef = useRef<number>(Date.now())
  const pagesRef = useRef<number>(0)
  const lastFlushRef = useRef<number>(Date.now())
  const bookIdRef = useRef(bookId)
  bookIdRef.current = bookId
  const activeRef = useRef(active)
  activeRef.current = active

  // Track page flips
  useEffect(() => {
    pagesRef.current = pagesFlipped
  }, [pagesFlipped])

  // Start timer
  useEffect(() => {
    // Reset per book — TxtReader stays mounted across book switches, and
    // without this the elapsed time would be attributed to the first book.
    startTimeRef.current = Date.now()
    lastFlushRef.current = Date.now()
    pagesRef.current = 0
    const id = bookIdRef.current

    const flush = (now: number, flushPages: boolean) => {
      if (!activeRef.current) {
        // Not actively reading right now (e.g. audio paused): keep the
        // accumulation point current so the pause is never later credited
        // as reading time, and don't flush anything.
        lastFlushRef.current = now
        return
      }
      const elapsed = now - lastFlushRef.current
      const pages = pagesRef.current
      if (elapsed >= 60000) {
        // Log whole minutes and carry the sub-minute remainder over,
        // so the elapsed seconds aren't discarded (they would otherwise
        // accumulate below the minute threshold forever and under-count).
        const elapsedMin = Math.floor(elapsed / 60000)
        logReading(id, elapsedMin, pages)
        lastFlushRef.current = now - (elapsed % 60000)
        pagesRef.current = 0
      } else if (flushPages && pages > 0) {
        // Page-only flush: log pages immediately, but keep the timer
        // bucket untouched — minutes still accrue toward the next tick.
        logReading(id, 0, pages)
        pagesRef.current = 0
      }
    }

    const interval = setInterval(() => {
      flush(Date.now(), true)
    }, 5000)
    return () => {
      clearInterval(interval)
      // Final flush — captures sub-minute sessions and page counts
      flush(Date.now(), true)
    }
  }, [logReading, bookId])
}
