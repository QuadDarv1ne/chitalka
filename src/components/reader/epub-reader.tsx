'use client'

import { logger } from '@/lib/logger'
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import ePub, { type Book, type Rendition } from 'epubjs'
import { Button } from '@/components/ui/button'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { BookRecord } from '@/lib/library'
import { useReaderStore, fontFamilyCss, themeBg, themeFg } from '@/store/reader-store'
import { useReadingTracker } from '@/hooks/use-reading-tracker'

interface Props {
  book: BookRecord
  onProgress: (p: number, extra?: { cfi?: string; textPosition?: number }) => void
}

export const EpubReader = memo(function EpubReader({ book, onProgress }: Props) {
  const viewerRef = useRef<HTMLDivElement>(null)
  const bookRef = useRef<Book | null>(null)
  const renditionRef = useRef<Rendition | null>(null)
  // Tracks whether display() finished for the CURRENT rendition instance.
  // Unlike the `ready` state this survives StrictMode remounts, so the theme
  // effect can never call resize() on a rendition whose manager (created
  // inside epubjs start()) does not exist yet.
  const renderedRef = useRef(false)
  const onProgressRef = useRef(onProgress)
  const [ready, setReady] = useState(false)
  const [hasPrev, setHasPrev] = useState(false)
  const [hasNext, setHasNext] = useState(false)
  const [relocations, setRelocations] = useState(0)
  const settings = useReaderStore((s) => s.settings)

  // Reading time tracking (page turns / relocations)
  useReadingTracker(book.id, relocations)

  useEffect(() => {
    onProgressRef.current = onProgress
  }, [onProgress])

  // Navigation helpers (declared before effects that use them)
  const prev = useCallback(() => {
    renditionRef.current?.prev()
  }, [])
  const next = useCallback(() => {
    renditionRef.current?.next()
  }, [])
  const updateNavButtons = useCallback(() => {
    const r = renditionRef.current
    if (!r) return
    try {
      const loc = r.location
      if (loc) {
        setHasPrev(!loc.atStart)
        setHasNext(!loc.atEnd)
      } else {
        setHasPrev(true)
        setHasNext(true)
      }
    } catch {
      setHasPrev(true)
      setHasNext(true)
    }
  }, [])

  // Initialize book
  useEffect(() => {
    if (!viewerRef.current) return
    let disposed = false
    // Mark the new rendition as not-yet-rendered. The theme effect gates on
    // this ref so it never calls resize() before display() completes.
    renderedRef.current = false

    const blobUrl = URL.createObjectURL(book.blob)
    const epubBook = ePub(blobUrl)
    bookRef.current = epubBook

    const rendition = epubBook.renderTo(viewerRef.current, {
      width: '100%',
      height: '100%',
      spread: settings.twoPage ? 'auto' : 'none',
      flow: 'paginated',
      allowScriptedContent: false,
    })
    renditionRef.current = rendition

    const go = async () => {
      try {
        await epubBook.ready
        if (disposed) return
        // Restore CFI if available — a stale/invalid CFI (book file replaced,
        // bookmark from another edition) must not leave the reader stuck.
        try {
          if (book.cfi) {
            await rendition.display(book.cfi)
          } else {
            await rendition.display()
          }
        } catch {
          if (disposed) return
          logger.warn('EPUB: CFI invalid, opening from the start')
          await rendition.display()
        }
        if (disposed) return
        renderedRef.current = true
        setReady(true)
        updateNavButtons()
      } catch (e) {
        logger.error('EPUB render failed', e)
      }
    }
    go()

    // Track location changes
    const onLocated = (location: any) => {
      if (disposed) return
      if (!location || !location.start) return
      const cfi = location.start.cfi
      const percent = location.start.percentage || 0
      // Persist CFI on book record
      onProgressRef.current(percent, { cfi })
      setRelocations((n) => n + 1)
      updateNavButtons()
    }
    rendition.on('relocated', onLocated)

    // Keyboard nav
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.target instanceof Element && e.target.closest('[role="dialog"]')) return
      if (e.key === 'ArrowLeft') {
        prev()
      } else if (e.key === 'ArrowRight') {
        next()
      }
    }
    window.addEventListener('keydown', onKey)

    // TOC navigation events
    const onGoto = (e: Event) => {
      const href = (e as CustomEvent<string>).detail
      if (href && renditionRef.current) {
        renditionRef.current.display(href).catch(() => {
          logger.warn('EPUB: failed to navigate to', href)
        })
      }
    }
    const onGotoCfi = (e: Event) => {
      const cfi = (e as CustomEvent<string>).detail
      if (cfi && renditionRef.current) {
        renditionRef.current.display(cfi).catch(() => {
          logger.warn('EPUB: failed to navigate to CFI', cfi)
        })
      }
    }
    const onGotoSpine = (e: Event) => {
      const idx = (e as CustomEvent<number>).detail
      if (typeof idx === 'number' && bookRef.current) {
        const spine = bookRef.current.spine
        const item = spine.get(idx)
        if (item && renditionRef.current) {
          renditionRef.current.display(item.href).catch(() => {
            logger.warn('EPUB: failed to navigate to spine item', idx)
          })
        }
      }
    }
    window.addEventListener('epub-goto', onGoto)
    window.addEventListener('epub-goto-cfi', onGotoCfi)
    window.addEventListener('epub-goto-spine', onGotoSpine)

    return () => {
      disposed = true
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('epub-goto', onGoto)
      window.removeEventListener('epub-goto-cfi', onGotoCfi)
      window.removeEventListener('epub-goto-spine', onGotoSpine)
      rendition.off('relocated', onLocated)
      try {
        rendition.destroy()
      } catch { logger.warn('Rendition destroy failed') }
      try {
        // Fully release the archive/zip resources
        epubBook.destroy()
      } catch { logger.warn('EPUB book destroy failed') }
      URL.revokeObjectURL(blobUrl)
      bookRef.current = null
      renditionRef.current = null
      renderedRef.current = false
    }
  }, [book.id])

  // Apply theme + font settings.
  // Runs only after the rendition is fully rendered (display() completed).
  // Gated on renderedRef (not `ready`) because that ref is reset on every
  // remount — epubjs creates this.manager only inside start(), and calling
  // rendition.resize() before that throws "Cannot read properties of
  // undefined (reading 'resize')".
  useEffect(() => {
    const rendition = renditionRef.current
    if (!rendition || !renderedRef.current) return

    try {
      const themes = rendition.themes
      if (!themes) return

      const bg = themeBg[settings.theme]
      const fg = themeFg[settings.theme]

      themes.register('custom', {
        body: {
          background: bg,
          color: fg,
          'font-family': fontFamilyCss[settings.fontFamily],
          'font-size': `${settings.fontSize}px`,
          'line-height': `${settings.lineHeight}`,
          padding: '0 !important',
          margin: '0 !important',
        },
        p: {
          'font-family': fontFamilyCss[settings.fontFamily],
          'font-size': `${settings.fontSize}px`,
          'line-height': `${settings.lineHeight}`,
          'text-align': settings.textAlign,
          'hyphens': settings.hyphens ? 'auto' : 'manual',
        },
        h1: { color: fg, 'font-family': fontFamilyCss[settings.fontFamily] },
        h2: { color: fg, 'font-family': fontFamilyCss[settings.fontFamily] },
        h3: { color: fg, 'font-family': fontFamilyCss[settings.fontFamily] },
        a: { color: '#2563eb' },
      })
      themes.select('custom')
      // Force re-render to apply (resize with no args re-reads the container)
      ;(rendition.resize as unknown as () => void)()
    } catch (e) {
      logger.warn('EPUB: failed to apply theme/settings', e)
    }
  }, [settings.theme, settings.fontFamily, settings.fontSize, settings.lineHeight, settings.textAlign, settings.hyphens, ready])

  return (
    <div
      className="relative w-full"
      style={{ background: 'var(--reader-bg)', height: 'calc(100vh - 6.5rem)' }}
    >
      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="text-sm opacity-70" style={{ color: 'var(--reader-fg)' }}>
            Открываем книгу…
          </p>
        </div>
      )}
      <div ref={viewerRef} className="h-full w-full" />

      {/* Side nav buttons */}
      <Button
        variant="ghost"
        size="icon"
        onClick={prev}
        disabled={!hasPrev}
        className="absolute left-2 top-1/2 -translate-y-1/2 h-12 w-12 rounded-full bg-black/5 hover:bg-black/10 disabled:opacity-30"
        aria-label="Назад"
      >
        <ChevronLeft className="h-6 w-6" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        onClick={next}
        disabled={!hasNext}
        className="absolute right-2 top-1/2 -translate-y-1/2 h-12 w-12 rounded-full bg-black/5 hover:bg-black/10 disabled:opacity-30"
        aria-label="Вперёд"
      >
        <ChevronRight className="h-6 w-6" />
      </Button>
    </div>
  )
})
