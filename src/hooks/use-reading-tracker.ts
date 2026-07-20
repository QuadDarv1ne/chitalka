'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useReaderStore } from '@/store/reader-store'

/**
 * Tracks reading time and pages flipped.
 * Logs to the global store every 60s or on unmount.
 */
export function useReadingTracker(bookId: string, pagesFlipped: number) {
  const logReading = useReaderStore((s) => s.logReading)
  const startTimeRef = useRef<number>(Date.now())
  const pagesRef = useRef<number>(0)
  const lastFlushRef = useRef<number>(Date.now())
  const [sessionMinutes, setSessionMinutes] = useState(0)

  // Track page flips
  useEffect(() => {
    pagesRef.current = pagesFlipped
  }, [pagesFlipped])

  // Start timer
  useEffect(() => {
    startTimeRef.current = Date.now()
    lastFlushRef.current = Date.now()
    const interval = setInterval(() => {
      const now = Date.now()
      const elapsedMin = Math.floor((now - lastFlushRef.current) / 60000)
      if (elapsedMin >= 1) {
        logReading(bookId, elapsedMin, 0)
        lastFlushRef.current = now
        setSessionMinutes((m) => m + elapsedMin)
      }
      setSessionMinutes(Math.floor((now - startTimeRef.current) / 60000))
    }, 5000)
    return () => {
      clearInterval(interval)
      // Final flush
      const now = Date.now()
      const elapsedMin = Math.floor((now - lastFlushRef.current) / 60000)
      if (elapsedMin > 0) {
        logReading(bookId, elapsedMin, 0)
      }
      const totalMin = Math.floor((now - startTimeRef.current) / 60000)
      if (totalMin > 0) {
        logReading(bookId, 0, pagesRef.current)
      }
    }
  }, [bookId, logReading])

  return { sessionMinutes }
}
