'use client'

import { memo, useCallback, useEffect, useRef, useState } from 'react'
import ePub, { type Book, type Rendition } from 'epubjs'
import { Button } from '@/components/ui/button'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { BookRecord } from '@/lib/library'
import { useReaderStore, fontFamilyCss, themeBg, themeFg } from '@/store/reader-store'

interface Props {
  book: BookRecord
  onProgress: (p: number, extra?: { cfi?: string; textPosition?: number }) => void
}

export const EpubReader = memo(function EpubReader({ book, onProgress }: Props) {
  const viewerRef = useRef<HTMLDivElement>(null)
  const bookRef = useRef<Book | null>(null)
  const renditionRef = useRef<Rendition | null>(null)
  const onProgressRef = useRef(onProgress)
  const [ready, setReady] = useState(false)
  const [hasPrev, setHasPrev] = useState(false)
  const [hasNext, setHasNext] = useState(false)
  const settings = useReaderStore((s) => s.settings)

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

    const blobUrl = URL.createObjectURL(book.blob)
    const epubBook = ePub(blobUrl)
    bookRef.current = epubBook

    const rendition = epubBook.renderTo(viewerRef.current, {
      width: '100%',
      height: '100%',
      spread: 'none',
      flow: 'paginated',
      allowScriptedContent: false,
    })
    renditionRef.current = rendition

    const go = async () => {
      try {
        await epubBook.ready
        if (disposed) return
        // Restore CFI if available
        if (book.cfi) {
          await rendition.display(book.cfi)
        } else {
          await rendition.display()
        }
        if (disposed) return
        setReady(true)
        updateNavButtons()
      } catch (e) {
        console.error('EPUB render failed', e)
      }
    }
    go()

    // Track location changes
    const onLocated = (location: any) => {
      if (!location || !location.start) return
      const cfi = location.start.cfi
      const percent = location.start.percentage || 0
      // Persist CFI on book record
      onProgressRef.current(percent, { cfi })
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
        renditionRef.current.display(href)
      }
    }
    const onGotoCfi = (e: Event) => {
      const cfi = (e as CustomEvent<string>).detail
      if (cfi && renditionRef.current) {
        renditionRef.current.display(cfi)
      }
    }
    const onGotoSpine = (e: Event) => {
      const idx = (e as CustomEvent<number>).detail
      if (typeof idx === 'number' && bookRef.current) {
        const spine = bookRef.current.spine
        const item = spine.get(idx)
        if (item && renditionRef.current) {
          renditionRef.current.display(item.href)
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
      } catch { console.warn('Rendition destroy failed') }
      try {
        // Fully release the archive/zip resources
        epubBook.destroy()
      } catch { console.warn('EPUB book destroy failed') }
      URL.revokeObjectURL(blobUrl)
      bookRef.current = null
      renditionRef.current = null
    }
  }, [book.id])

  // Apply theme + font settings
  useEffect(() => {
    const rendition = renditionRef.current
    if (!rendition) return

    const themes = rendition.themes
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
    // Force re-render to apply
    ;(rendition.resize as any)?.()
  }, [settings.theme, settings.fontFamily, settings.fontSize, settings.lineHeight, settings.textAlign, settings.hyphens])

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
