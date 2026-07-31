'use client'

import { useEffect, useRef } from 'react'
import { useReaderStore } from '@/store/reader-store'

/**
 * Tracks reading time and pages flipped.
 * Logs time every 60s and pages on every flush (so page counts survive
 * quick sessions and tab closes mid-session).
 */
export function useReadingTracker(bookId: string, pagesFlipped: number) {
  const logReading = useReaderStore((s) => s.logReading)
  const startTimeRef = useRef<number>(Date.now())
  const pagesRef = useRef<number>(0)
  const lastFlushRef = useRef<number>(Date.now())
  const bookIdRef = useRef(bookId)
  bookIdRef.current = bookId

  // Track page flips
  useEffect(() => {
    pagesRef.current = pagesFlipped
  }, [pagesFlipped])

  // Start timer
  useEffect(() => {
    startTimeRef.current = Date.now()
    lastFlushRef.current = Date.now()
    pagesRef.current = 0
    const id = bookIdRef.current

    const flush = (now: number, flushPages: boolean) => {
      const elapsedMin = Math.floor((now - lastFlushRef.current) / 60000)
      const pages = pagesRef.current
      if (elapsedMin >= 1 || (flushPages && pages > 0)) {
        logReading(id, elapsedMin, pages)
        lastFlushRef.current = now
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
  }, [logReading])
}
