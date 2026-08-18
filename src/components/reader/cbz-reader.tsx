'use client'

import { logger } from '@/lib/logger'
import { useEffect, useRef, useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import type { BookRecord } from '@/lib/library'
import { extractCbzImages } from '@/lib/book-parser'
import { useReadingTracker } from '@/hooks/use-reading-tracker'

interface Props {
  book: BookRecord
  onProgress: (p: number, extra?: { cfi?: string; textPosition?: number; pdfPage?: number; audioTrack?: number; audioTime?: number; pageIndex?: number }) => void
}

export function CbzReader({ book, onProgress }: Props) {
  const [images, setImages] = useState<{ name: string; url: string }[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [pagesFlipped, setPagesFlipped] = useState(0)
  const onProgressRef = useRef(onProgress)
  const prevIndexRef = useRef(-1)
  const [loading, setLoading] = useState(() => true)

  useEffect(() => {
    onProgressRef.current = onProgress
  }, [onProgress])

  // Extract images from CBZ
  useEffect(() => {
    let cancelled = false
    const revoked: string[] = []

    ;(async () => {
      try {
        const imageList = await extractCbzImages(book.blob)
        if (cancelled) return

        const urls = imageList.map((img) => {
          const url = URL.createObjectURL(img.blob)
          revoked.push(url)
          return { name: img.name, url }
        })

        setImages(urls)
        // Restore position
        setCurrentIndex(0)
      } catch (e) {
        logger.error('CBZ extraction failed', e)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
      for (const url of revoked) URL.revokeObjectURL(url)
    }
  }, [book.id, book.blob])

  // Track page turns
  useEffect(() => {
    if (prevIndexRef.current !== currentIndex && prevIndexRef.current !== -1) {
      prevIndexRef.current = currentIndex
      setPagesFlipped((n) => n + 1)
      
      // Update progress
      if (images.length > 0) {
        const progress = currentIndex / (images.length - 1)
        onProgressRef.current(progress, { pageIndex: currentIndex })
      }
    } else {
      prevIndexRef.current = currentIndex
    }
  }, [currentIndex, images.length])

  // Reading time tracking
  useReadingTracker(book.id, pagesFlipped)

  const prev = useCallback(() => {
    if (currentIndex > 0) {
      setCurrentIndex((i) => i - 1)
    }
  }, [currentIndex])

  const next = useCallback(() => {
    if (currentIndex < images.length - 1) {
      setCurrentIndex((i) => i + 1)
    }
  }, [currentIndex, images.length])

  // Keyboard navigation
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') prev()
      else if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') next()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [prev, next])

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (images.length === 0) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground">Не удалось загрузить изображения</p>
      </div>
    )
  }

  return (
    <div className="relative flex h-screen flex-col">
      {/* Image display */}
      <div className="flex-1 flex items-center justify-center bg-black p-4">
        <img
          src={images[currentIndex]?.url}
          alt={`Страница ${currentIndex + 1}`}
          className="max-h-full max-w-full object-contain"
          style={{ imageRendering: 'auto' }}
        />
      </div>

      {/* Navigation overlay */}
      <div className="absolute inset-0 flex items-center pointer-events-none">
        <Button
          variant="ghost"
          size="icon"
          onClick={prev}
          disabled={currentIndex === 0}
          className="h-full w-16 rounded-none bg-black/0 hover:bg-black/20 disabled:opacity-0 transition-opacity"
          aria-label="Назад"
        >
          <ChevronLeft className="h-8 w-8 text-white" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={next}
          disabled={currentIndex === images.length - 1}
          className="h-full w-16 rounded-none bg-black/0 hover:bg-black/20 disabled:opacity-0 transition-opacity ml-auto"
          aria-label="Вперёд"
        >
          <ChevronRight className="h-8 w-8 text-white" />
        </Button>
      </div>

      {/* Bottom bar */}
      <div className="bg-black/80 text-white p-3 flex items-center gap-3">
        <span className="text-sm tabular-nums">
          {currentIndex + 1} / {images.length}
        </span>
        <div className="flex-1 h-1 bg-white/20 rounded-full overflow-hidden">
          <div
            className="h-full bg-white transition-all"
            style={{ width: `${((currentIndex + 1) / images.length) * 100}%` }}
          />
        </div>
      </div>
    </div>
  )
}
