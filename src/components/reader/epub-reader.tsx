'use client'

import { logger } from '@/lib/logger'
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import ePub, { type Book, type Rendition } from 'epubjs'
import { Button } from '@/components/ui/button'
import { ChevronLeft, ChevronRight, Volume2, Square, Pause, Play, Repeat } from 'lucide-react'
import type { BookRecord } from '@/lib/library'
import { useReaderStore, fontFamilyCss, themeBg, themeFg } from '@/store/reader-store'
import { useReadingTracker } from '@/hooks/use-reading-tracker'
import { useTTS } from '@/hooks/use-tts'

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
  // Tracks the pending TTS auto-advance timeout so unmount can cancel it —
  // otherwise the timer reads a page of an unmounted reader aloud.
  const ttsAdvanceTimerRef = useRef<number | null>(null)
  const [hasPrev, setHasPrev] = useState(false)
  const [hasNext, setHasNext] = useState(false)
  const [relocations, setRelocations] = useState(0)
  const settings = useReaderStore((s) => s.settings)
  const tts = useTTS()
  // Stable handle to stop TTS from inside the init effect (which must not
  // re-run when the TTS hook's state object changes).
  const stopTtsRef = useRef<() => void>(() => {})
  useEffect(() => {
    stopTtsRef.current = tts.stop
  }, [tts.stop])
  // "Listen mode": when TTS finishes a page, flip to the next one and keep
  // reading. The advance is confirmed via the 'relocated' event (not a blind
  // timeout), so the book end can never re-read the same page in a loop.
  const [autoRead, setAutoRead] = useState(false)
  const autoReadRef = useRef(false)
  const ttsAdvancePendingRef = useRef(false)
  const speakLatestRef = useRef<() => void>(() => {})
  useEffect(() => {
    autoReadRef.current = autoRead
  }, [autoRead])

  // Reading time tracking (page turns / relocations)
  useReadingTracker(book.id, relocations)

  useEffect(() => {
    onProgressRef.current = onProgress
  }, [onProgress])

  // Navigation helpers (declared before effects that use them)
  const prev = useCallback(() => {
    tts.stop()
    renditionRef.current?.prev()
  }, [tts])
  const next = useCallback(() => {
    tts.stop()
    renditionRef.current?.next()
  }, [tts])
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
        // Generate the location map BEFORE the first display(): epubjs computes
        // relocated.percentage from book.locations, and until generate() runs
        // the map is empty — every location would report 0% and overwrite the
        // saved progress on open. Generation is heavy for huge books, so a
        // failure only degrades the percentage, never the CFI restore.
        try {
          await epubBook.locations.generate()
        } catch (e) {
          logger.warn('EPUB: locations.generate failed, % progress will be unreliable', e)
        }
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
        if (!disposed) {
          setReady(false)
        }
      }
    }
    go()

    // Track location changes
    const onLocated = (location: any) => {
      if (disposed) return
      if (!location || !location.start) return
      const cfi = location.start.cfi
      // Clamp the percentage — epubjs spine-relative values can exceed 1
      // (multi-spine books), which would persist as progress > 100%.
      const percent = Math.max(0, Math.min(1, location.start.percentage || 0))
      // Persist CFI on book record
      onProgressRef.current(percent, { cfi })
      setRelocations((n) => n + 1)
      updateNavButtons()
      // Resume TTS after an auto-advance once the new page is in place
      if (ttsAdvancePendingRef.current) {
        ttsAdvancePendingRef.current = false
        if (ttsAdvanceTimerRef.current) clearTimeout(ttsAdvanceTimerRef.current)
        ttsAdvanceTimerRef.current = window.setTimeout(() => speakLatestRef.current(), 350)
      }
    }
    rendition.on('relocated', onLocated)

    // Keyboard nav
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.target instanceof Element && e.target.closest('[role="dialog"]')) return
      if ((e.key === ' ' || e.key === 'PageDown' || e.key === 'PageUp') &&
        e.target instanceof Element && e.target.closest('button, a')) return
      if (e.key === 'ArrowLeft' || e.key === 'PageUp' || e.key === 'Backspace') {
        if (e.key === 'Backspace') e.preventDefault()
        prev()
      } else if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
        if (e.key === ' ' || e.key === 'PageDown') e.preventDefault()
        next()
      }
    }
    window.addEventListener('keydown', onKey)

    // TOC navigation events
    const onGoto = (e: Event) => {
      const href = (e as CustomEvent<string>).detail
      if (href && renditionRef.current) {
        stopTtsRef.current()
        renditionRef.current.display(href).catch(() => {
          logger.warn('EPUB: failed to navigate to', href)
        })
      }
    }
    const onGotoCfi = (e: Event) => {
      const cfi = (e as CustomEvent<string>).detail
      if (cfi && renditionRef.current) {
        stopTtsRef.current()
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
          stopTtsRef.current()
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
      if (ttsAdvanceTimerRef.current) {
        clearTimeout(ttsAdvanceTimerRef.current)
        ttsAdvanceTimerRef.current = null
      }
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
    // Recreate the rendition when the spread mode changes — epubjs fixes the
    // spread at renderTo() time, so toggling "разворот" requires a rebuild.
    // Position is restored from book.cfi (kept fresh by onLocated).
  }, [book.id, settings.twoPage])

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

// TTS: extract the text of the current viewport via CFI range.
  const getCurrentText = useCallback((): string => {
    const rendition = renditionRef.current
    if (!book || !rendition) return ''
    try {
      const loc = rendition.currentLocation()
      // currentLocation() returns { start, end, atStart, atEnd } — the CFI
      // lives on start/end, not on the top level.
      const cfi = loc?.start?.cfi || loc?.end?.cfi
      if (!cfi) return ''
      const range = rendition.getRange(cfi)
      // A page-start CFI ranges to the end of the section — cap it so a
      // single read-aloud session doesn't queue a huge chapter.
      const text = (range?.toString() ?? '').replace(/\s+/g, ' ').trim().slice(0, 10000)
      return text
    } catch (e) {
      logger.warn('EPUB TTS: failed to read current location', e)
      return ''
    }
  }, [])

  const speakCurrentPage = useCallback(() => {
    const text = getCurrentText()
    if (!text) return
    const voice = settings.ttsVoice
      ? window.speechSynthesis
          .getVoices()
          .find((v) => v.voiceURI === settings.ttsVoice || v.name === settings.ttsVoice) ?? null
      : null
    tts.speak(text, {
      rate: settings.ttsRate,
      voice,
      onFinished: () => {
        if (!autoReadRef.current) return
        const rendition = renditionRef.current
        if (!rendition) return
        try {
          if (rendition.location?.atEnd) return // end of the book — stop
        } catch { return }
        ttsAdvancePendingRef.current = true
        rendition.next()
      },
    })
  }, [getCurrentText, settings.ttsRate, settings.ttsVoice, tts])

  const handleTTS = () => {
    if (tts.speaking) {
      tts.stop()
      return
    }
    speakCurrentPage()
  }

  useEffect(() => {
    speakLatestRef.current = speakCurrentPage
  }, [speakCurrentPage])

  return (
    <div
      className="relative w-full"
      style={{
        background: 'var(--reader-bg)',
        height: 'calc(100vh - 6.5rem)',
      }}
    >
      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="text-sm opacity-70" style={{ color: 'var(--reader-fg)' }}>
            Открываем книгу…
          </p>
        </div>
      )}
      <div
        ref={viewerRef}
        className="h-full"
        style={{
          width: settings.twoPage ? '100%' : 'min(100%, 720px)',
          margin: settings.twoPage ? '0 auto' : '0 auto',
        }}
      />

      {/* Floating action: TTS */}
      {ready && (
        <div className="fixed bottom-20 right-4 z-20 flex flex-col items-end gap-2">
          {tts.speaking && (
            <div className="flex items-center gap-1 rounded-full border bg-background px-2 py-1 shadow-md">
              <span className="text-xs px-1">
                {tts.currentChunk + 1} / {tts.totalChunks}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => (tts.paused ? tts.resume() : tts.pause())}
              >
                {tts.paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={tts.stop}
              >
                <Square className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
          <Button
            variant={autoRead ? 'default' : 'outline'}
            size="icon"
            onClick={() => setAutoRead((v) => !v)}
            className="rounded-full shadow-md h-10 w-10"
            aria-label={autoRead ? 'Выключить автоперелистывание' : 'Включить автоперелистывание страниц при озвучке'}
            title={autoRead ? 'Автоперелистывание: включено' : 'Автоперелистывание: выключено'}
          >
            <Repeat className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={handleTTS}
            className="rounded-full shadow-md h-11 w-11"
            aria-label={tts.speaking ? 'Остановить' : 'Читать вслух'}
          >
            {tts.speaking ? <Square className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
          </Button>
        </div>
      )}

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
