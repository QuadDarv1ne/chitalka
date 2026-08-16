'use client'

import { logger } from '@/lib/logger'
import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  Volume2,
  Square,
  Pause,
  Play,
  Repeat,
} from 'lucide-react'
import type { BookRecord } from '@/lib/library'
import { decodeTextBlob } from '@/lib/text-encoding'
import { paginateText, findPageForPosition as findPageInStarts } from '@/lib/pagination'
import {
  useReaderStore,
  fontFamilyCss,
  type HighlightColor,
} from '@/store/reader-store'
import ReactMarkdown from 'react-markdown'
import { useTTS } from '@/hooks/use-tts'
import { useReadingTracker } from '@/hooks/use-reading-tracker'
import { ColorPicker } from './highlights-panel'
import { splitWithHighlights, HighlightMark } from '@/lib/highlights-utils'
import { toast } from 'sonner'

interface Props {
  book: BookRecord
  onProgress: (p: number, extra?: { cfi?: string; textPosition?: number }) => void
}

export function TxtReader({ book, onProgress }: Props) {
  const [content, setContent] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(0)
  const [pagesFlipped, setPagesFlipped] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const articleRef = useRef<HTMLDivElement>(null)
  const touchStartX = useRef<number | null>(null)
  const touchStartY = useRef<number | null>(null)
  const [selection, setSelection] = useState<{ x: number; y: number; text: string } | null>(null)
  const [editingHighlightId, setEditingHighlightId] = useState<string | null>(null)
  const [editingNote, setEditingNote] = useState('')
  const settings = useReaderStore((s) => s.settings)
  const highlights = useReaderStore((s) => s.highlights)
  const addHighlight = useReaderStore((s) => s.addHighlight)
  const updateHighlight = useReaderStore((s) => s.updateHighlight)
  const tts = useTTS()

  // Two-page spread: only on wide screens. `page` is the index of the left
  // page; the right page is page+1 (may not exist on the last odd page of
  // the book). Navigation moves by 2.
  const twoPage = settings.twoPage

  useReadingTracker(book.id, pagesFlipped)

  // Load text
  useEffect(() => {
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    decodeTextBlob(book.blob)
      .then((text) => {
        if (cancelled) return
        setContent(text)
      })
      .catch((e) => logger.error(e))
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [book.id, book.blob])

  // Split into pages (by words, with chapter breaks).
  const [pages, pageStarts] = useMemo<[string[], number[]]>(() => {
    if (!content) return [[], []]
    const { pages, pageStarts } = paginateText(content)
    return [pages, pageStarts]
  }, [content])

  const totalPages = pages.length

  const findPageForPositionCb = useCallback(
    (pos: number): number => findPageInStarts(pageStarts, pos),
    [pageStarts],
  )

  // Restore the saved position once the book is paginated.
  // In two-page mode the spread is aligned to an even left page, so the
  // restored page stays visible (as the right page for odd indices).
  const alignToSpread = (p: number) => (twoPage ? (p % 2 === 0 ? p : Math.max(0, p - 1)) : p)
  const positionRestoredRef = useRef(false)
  useEffect(() => {
    if (totalPages === 0 || positionRestoredRef.current) return
    if (book.textPosition) {
      positionRestoredRef.current = true
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPage(alignToSpread(findPageForPositionCb(book.textPosition)))
    }
  }, [totalPages, book.textPosition, findPageForPositionCb, twoPage])

  // Clamp the restored page once the book is paginated (content may load
  // with a stale position that exceeds the page count)
  useEffect(() => {
    if (totalPages > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPage((p) => alignToSpread(Math.max(0, Math.min(p, totalPages - 1))))
    }
  }, [totalPages, twoPage])

  const currentPage = pages[page] || ''
  // In two-page mode the right page is the one after the left (spreadStart).
  const rightPage = twoPage ? (pages[page + 1] || '') : ''
  const pagesInSpread = twoPage ? (rightPage ? 2 : 1) : 1
  const progress = totalPages > 0 ? Math.min(1, (page + pagesInSpread) / totalPages) : 0

  // Live refs so TTS callbacks (which fire from browser events) always see
  // the current page without stale closures.
  const pageRef = useRef(page)
  const totalPagesRef = useRef(totalPages)
  const speakLatestRef = useRef<() => void>(() => {})

  // Highlights that belong to this spread (by real word range)
  const pageStartPos = pageStarts[page] ?? 0
  const pageEndPos = twoPage
    ? (pageStarts[page + 2] ?? Infinity)
    : (pageStarts[page + 1] ?? Infinity)
  const pageHighlights = useMemo(
    () =>
      highlights.filter(
        (h) =>
          h.bookId === book.id &&
          h.textPosition !== undefined &&
          h.textPosition >= pageStartPos &&
          h.textPosition < pageEndPos,
      ),
    [highlights, book.id, pageStartPos, pageEndPos],
  )

  useEffect(() => {
    if (totalPages > 0) {
      onProgress(progress, { textPosition: pageStartPos })
    }
  }, [page, totalPages, progress, onProgress, pageStartPos, pageEndPos])

  const prev = useCallback(() => {
    const step = twoPage ? 2 : 1
    if (page - step < 0) return
    setPage(page - step)
    setPagesFlipped((n) => n + 1)
    containerRef.current?.scrollTo({ top: 0 })
    tts.stop()
  }, [page, tts, twoPage])
  const next = useCallback(() => {
    const step = twoPage ? 2 : 1
    if (totalPages === 0 || page + step > totalPages - 1) {
      // On the last odd page, a single-page step still flips the final page
      if (twoPage && page + 1 <= totalPages - 1) {
        setPage(page + 1)
        setPagesFlipped((n) => n + 1)
        containerRef.current?.scrollTo({ top: 0 })
        tts.stop()
      }
      return
    }
    setPage(page + step)
    setPagesFlipped((n) => n + 1)
    containerRef.current?.scrollTo({ top: 0 })
    tts.stop()
  }, [page, totalPages, tts, twoPage])

  // Keyboard nav
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.target instanceof Element && e.target.closest('[role="dialog"]')) return
      // Space on a focused button/link must trigger the element, not the
      // page turn (otherwise the floating nav buttons would double-flip)
      if ((e.key === ' ' || e.key === 'PageDown' || e.key === 'PageUp') &&
        e.target instanceof Element && e.target.closest('button, a')) return
      if (e.key === 'ArrowLeft' || e.key === 'PageUp' || e.key === 'Backspace') prev()
      else if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
        if (e.key === ' ' || e.key === 'PageDown') e.preventDefault()
        next()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [prev, next])

  // Bookmark navigation
  useEffect(() => {
    const onGotoPosition = (e: Event) => {
      const pos = (e as CustomEvent<number>).detail
      if (typeof pos === 'number') {
        tts.stop()
        setPage(findPageForPositionCb(pos))
        containerRef.current?.scrollTo({ top: 0 })
      }
    }
    const onGotoLabel = (e: Event) => {
      const label = (e as CustomEvent<string>).detail
      if (typeof label === 'string') {
        const idx = pages.findIndex((p) => p.includes(label))
        if (idx >= 0) {
          tts.stop()
          setPage(idx)
          containerRef.current?.scrollTo({ top: 0 })
        }
      }
    }
    window.addEventListener('txt-goto-position', onGotoPosition)
    window.addEventListener('txt-goto', onGotoLabel)
    return () => {
      window.removeEventListener('txt-goto-position', onGotoPosition)
      window.removeEventListener('txt-goto', onGotoLabel)
    }
  }, [findPageForPositionCb, pages])

  // Text selection → show color picker
  useEffect(() => {
    const onMouseUp = () => {
      const sel = window.getSelection()
      if (!sel || sel.isCollapsed || !articleRef.current) {
        setSelection(null)
        return
      }
      const text = sel.toString().trim()
      if (!text || text.length < 2) {
        setSelection(null)
        return
      }
      const range = sel.getRangeAt(0)
      if (!articleRef.current.contains(range.commonAncestorContainer)) {
        setSelection(null)
        return
      }
      const rect = range.getBoundingClientRect()
      setSelection({
        x: rect.left + rect.width / 2,
        y: rect.top - 10,
        text,
      })
    }
    document.addEventListener('mouseup', onMouseUp)
    return () => document.removeEventListener('mouseup', onMouseUp)
  }, [])

  // Touch swipe for mobile
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onTouchStart = (e: TouchEvent) => {
      touchStartX.current = e.touches[0].clientX
      touchStartY.current = e.touches[0].clientY
    }
    const onTouchEnd = (e: TouchEvent) => {
      if (touchStartX.current === null || touchStartY.current === null) return
      const dx = e.changedTouches[0].clientX - touchStartX.current
      const dy = e.changedTouches[0].clientY - touchStartY.current
      // Only horizontal swipes (dx > 3*dy) and length > 50
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 3) {
        if (dx > 0) prev()
        else next()
      }
      touchStartX.current = null
      touchStartY.current = null
    }
    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchend', onTouchEnd, { passive: true })
    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchend', onTouchEnd)
    }
  }, [prev, next])

  const handleHighlight = (color: HighlightColor) => {
    if (!selection) return
    // Word-level position: the DOM text may wrap across paragraphs of the
    // spread, so locate it in the raw spread text and count the words
    // before it. Falls back to the page start when the raw text differs
    // (e.g. markdown source vs rendered output).
    const spreadText = rightPage ? `${currentPage}\n\n${rightPage}` : currentPage
    const idx = spreadText.indexOf(selection.text)
    const wordOffset =
      idx >= 0 ? spreadText.slice(0, idx).split(/\s+/).filter(Boolean).length : 0
    addHighlight({
      bookId: book.id,
      text: selection.text,
      color,
      textPosition: pageStartPos + wordOffset,
    })
    toast.success('Выделение добавлено')
    setSelection(null)
    window.getSelection()?.removeAllRanges()
  }

  const handleHighlightClick = (h: { id: string; note?: string }) => {
    setEditingHighlightId(h.id)
    setEditingNote(h.note ?? '')
  }

  const saveNote = () => {
    if (editingHighlightId) {
      updateHighlight(editingHighlightId, { note: editingNote })
      toast.success('Заметка сохранена')
    }
    setEditingHighlightId(null)
    setEditingNote('')
  }

  // "Listen mode": when the TTS finishes the last chunk of a page, flip to
  // the next page and keep reading (until the book ends or the user stops).
  const [autoRead, setAutoRead] = useState(false)
  const autoReadRef = useRef(false)
  useEffect(() => {
    autoReadRef.current = autoRead
  }, [autoRead])

  const speakCurrentPage = useCallback(() => {
    const text = currentPage.replace(/[#*_`>-]/g, '').replace(/\n+/g, ' ')
    // The settings panel stores the voice by `voiceURI`; match it first and
    // fall back to `name` for values saved by older versions.
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
        const total = totalPagesRef.current
        const cur = pageRef.current
        const step = twoPage ? 2 : 1
        let nxt = cur + step
        if (nxt > total - 1) nxt = twoPage && cur + 1 <= total - 1 ? cur + 1 : cur
        if (nxt === cur) return // end of the book — stop
        setPage(nxt)
        setPagesFlipped((n) => n + 1)
        containerRef.current?.scrollTo({ top: 0 })
        // Give the new page a moment to render before speaking it
        window.setTimeout(() => speakLatestRef.current(), 450)
      },
    })
  }, [currentPage, settings.ttsRate, settings.ttsVoice, tts, twoPage])

  const handleTTS = () => {
    if (tts.speaking) {
      tts.stop()
      return
    }
    speakCurrentPage()
  }

  useEffect(() => {
    pageRef.current = page
    totalPagesRef.current = totalPages
    speakLatestRef.current = speakCurrentPage
  }, [page, totalPages, speakCurrentPage])

  // Highlight the paragraph currently being spoken. Maps the TTS chunk's
  // char offset (within the normalized spoken text) back to the paragraph,
  // using the exact same normalization as handleTTS.
  const ttsParaIndex = useMemo(() => {
    if (!tts.speaking || book.format === 'md' || !currentPage) return -1
    const paragraphs = currentPage.split(/\n\n+/)
    let offset = 0
    for (let i = 0; i < paragraphs.length; i++) {
      const len = paragraphs[i].replace(/[#*_`>-]/g, '').replace(/\n+/g, ' ').length
      if (tts.currentChunkStart < offset + len) return i
      offset += len + 1
    }
    return paragraphs.length - 1
  }, [tts.speaking, tts.currentChunkStart, currentPage, book.format])

  const readerStyle: React.CSSProperties = {
    background: 'var(--reader-bg)',
    color: 'var(--reader-fg)',
    fontFamily: fontFamilyCss[settings.fontFamily],
    fontSize: `${settings.fontSize}px`,
    lineHeight: settings.lineHeight,
    textAlign: settings.textAlign,
    hyphens: settings.hyphens ? 'auto' : 'manual',
    WebkitHyphens: settings.hyphens ? 'auto' : 'manual',
  }

  const marginX = `${settings.margin * 1.5}rem`

  // Keep the paragraph being read visible while TTS is speaking
  useEffect(() => {
    if (ttsParaIndex < 0) return
    const el = containerRef.current?.querySelector(`[data-tts-index="${ttsParaIndex}"]`)
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [ttsParaIndex])

  // Render a paragraph with highlights
  const renderParagraph = (para: string, i: number) => {
    const segments = splitWithHighlights(para, pageHighlights)
    const isSpoken = ttsParaIndex === i
    return (
      <p
        key={i}
        data-tts-index={i}
        className={`mb-4 whitespace-pre-wrap transition-colors duration-200 ${
          isSpoken ? 'rounded-md bg-primary/10 px-2 ring-1 ring-primary/20 -mx-2' : ''
        }`}
      >
        {segments.map((seg, j) =>
          seg.highlight ? (
            <HighlightMark
              key={j}
              color={seg.highlight.color}
              note={seg.highlight.note}
              onClick={() => handleHighlightClick(seg.highlight!)}
            >
              {seg.text}
            </HighlightMark>
          ) : (
            <span key={j}>{seg.text}</span>
          ),
        )}
      </p>
    )
  }

  // Render the body of a single page (markdown or paragraphs with highlights)
  const renderPageBody = (pageText: string) => {
    if (book.format === 'md') {
      return (
        <div className="prose prose-lg max-w-none dark:prose-invert" style={{ color: 'inherit' }}>
          <ReactMarkdown
            components={{
              // Strip potentially dangerous attributes from HTML tags
              a: ({ href, children, ...props }) => (
                <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
                  {children}
                </a>
              ),
            }}
          >
            {pageText}
          </ReactMarkdown>
        </div>
      )
    }
    return pageText.split(/\n\n+/).map((para, i) => renderParagraph(para, i))
  }

  return (
    <div
      ref={containerRef}
      className="relative w-full overflow-y-auto"
      style={{
        background: 'var(--reader-bg)',
        height: 'calc(100vh - 6.5rem)',
      }}
    >
      {loading ? (
        <div className="flex h-full items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div
          ref={articleRef}
          className={`mx-auto flex items-stretch py-10 ${
            twoPage ? 'max-w-[min(140rem,99vw)] gap-0' : 'max-w-[min(100rem,97vw)]'
          }`}
          style={{ paddingLeft: marginX, paddingRight: marginX }}
        >
          <article
            className="flex-1 min-w-0 px-2 sm:px-4"
            style={readerStyle}
          >
            {renderPageBody(currentPage)}
          </article>
          {twoPage && rightPage && (
            <article
              className="flex-1 min-w-0 px-2 sm:px-4 border-l"
              style={{ ...readerStyle, borderColor: 'color-mix(in srgb, var(--reader-fg) 10%, transparent)' }}
            >
              {renderPageBody(rightPage)}
            </article>
          )}
        </div>
      )}

      {/* Floating action: TTS */}
      {!loading && (
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

      {/* Selection toolbar */}
      {selection && (
        <div
          className="fixed z-50 -translate-x-1/2 -translate-y-full"
          style={{
            left: selection.x,
            // Keep the toolbar on screen when the selection is near the top
            top: Math.max(selection.y, 56),
          }}
        >
          <ColorPicker onPick={handleHighlight} />
        </div>
      )}

      {/* Highlight note editor (inline popover) */}
      {editingHighlightId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => setEditingHighlightId(null)}
        >
          <div
            className="w-full max-w-md rounded-lg border bg-background p-4 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-medium mb-2">Заметка к выделению</h3>
            <textarea
              autoFocus
              value={editingNote}
              onChange={(e) => setEditingNote(e.target.value)}
              placeholder="Напишите заметку..."
              className="w-full min-h-[100px] rounded border bg-background px-3 py-2 text-sm"
            />
            <div className="flex justify-end gap-2 mt-3">
              <Button variant="outline" size="sm" onClick={() => setEditingHighlightId(null)}>
                Отмена
              </Button>
              <Button size="sm" onClick={saveNote}>
                Сохранить
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Side nav buttons */}
      <Button
        variant="ghost"
        size="icon"
        onClick={prev}
        disabled={twoPage ? page < 2 : page === 0}
        className="fixed left-2 top-1/2 -translate-y-1/2 h-12 w-12 rounded-full bg-black/5 hover:bg-black/10 disabled:opacity-20"
        aria-label="Назад"
      >
        <ChevronLeft className="h-6 w-6" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        onClick={next}
        disabled={twoPage ? page + pagesInSpread >= totalPages : page >= totalPages - 1}
        className="fixed right-2 top-1/2 -translate-y-1/2 h-12 w-12 rounded-full bg-black/5 hover:bg-black/10 disabled:opacity-20"
        aria-label="Вперёд"
      >
        <ChevronRight className="h-6 w-6" />
      </Button>

      {/* Page indicator */}
      {totalPages > 0 && (
        <div
          className="pointer-events-none fixed bottom-16 left-1/2 -translate-x-1/2 rounded-full px-3 py-1 text-xs"
          style={{
            background: 'color-mix(in srgb, var(--reader-bg) 80%, transparent)',
            color: 'var(--reader-fg)',
          }}
        >
          {twoPage && rightPage
            ? `${page + 1}–${page + 2} / ${totalPages}`
            : `${page + 1} / ${totalPages}`}
        </div>
      )}
    </div>
  )
}
