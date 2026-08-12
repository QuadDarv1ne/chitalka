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
} from 'lucide-react'
import type { BookRecord } from '@/lib/library'
import { PAGE_WORDS } from '@/lib/constants'
import { decodeTextBlob } from '@/lib/text-encoding'
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
  // Records each page's cumulative word offset, so positions can be mapped
  // to the exact page — chapter breaks flush pages early, so `page*PAGE_WORDS`
  // does not describe where a page actually begins.
  const [pages, pageStarts] = useMemo(() => {
    if (!content) return [[], []] as const
    const isChapterStart = (line: string) =>
      /^(#{1,2})\s+/.test(line) ||
      /^(Глава|Часть|Раздел|Пролог|Эпилог|Chapter|Part|Section|Prologue|Epilogue)\s+([IVX]+|\d+)/i.test(line)

    const paragraphs = content.split(/\n\n+/).filter(Boolean)
    const result: string[] = []
    const starts: number[] = []
    let current = ''
    let words = 0
    let cumulative = 0
    let pageStart = 0
    const flush = () => {
      if (current) {
        result.push(current)
        starts.push(pageStart)
        current = ''
        words = 0
      }
    }
    for (const p of paragraphs) {
      const pWords = p.split(/\s+/).filter(Boolean).length
      const firstLine = p.split('\n')[0] ?? ''
      const isChapter = isChapterStart(firstLine)
      if (current && (isChapter || words + pWords > PAGE_WORDS)) flush()
      if (!current) pageStart = cumulative
      current = current ? `${current}\n\n${p}` : p
      words += pWords
      cumulative += pWords
    }
    if (current) {
      result.push(current)
      starts.push(pageStart)
    }
    return [result, starts] as const
  }, [content])

  const totalPages = pages.length

  // Map a word position to the page containing it (falls back to the last page)
  const findPageForPosition = useCallback(
    (pos: number): number => {
      for (let i = 0; i < totalPages; i++) {
        const end = i + 1 < totalPages ? pageStarts[i + 1] : Infinity
        if (pos >= pageStarts[i] && pos < end) return i
      }
      return Math.max(0, totalPages - 1)
    },
    [totalPages, pageStarts],
  )

  // Restore the saved position once the book is paginated
  const positionRestoredRef = useRef(false)
  useEffect(() => {
    if (totalPages === 0 || positionRestoredRef.current) return
    if (book.textPosition) {
      positionRestoredRef.current = true
      setPage(findPageForPosition(book.textPosition))
    }
  }, [totalPages, book.textPosition, findPageForPosition])

  // Clamp the restored page once the book is paginated (content may load
  // with a stale position that exceeds the page count)
  useEffect(() => {
    if (totalPages > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPage((p) => Math.max(0, Math.min(p, totalPages - 1)))
    }
  }, [totalPages])

  const currentPage = pages[page] || ''
  const progress = totalPages > 0 ? (page + 1) / totalPages : 0

  // Highlights that belong to this page (by real word range)
  const pageStartPos = pageStarts[page] ?? 0
  const pageEndPos = pageStarts[page + 1] ?? Infinity
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
    if (page <= 0) return
    setPage(page - 1)
    setPagesFlipped((n) => n + 1)
    containerRef.current?.scrollTo({ top: 0 })
    tts.stop()
  }, [page, tts])
  const next = useCallback(() => {
    if (totalPages === 0 || page >= totalPages - 1) return
    setPage(page + 1)
    setPagesFlipped((n) => n + 1)
    containerRef.current?.scrollTo({ top: 0 })
    tts.stop()
  }, [page, totalPages, tts])

  // Keyboard nav
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.target instanceof Element && e.target.closest('[role="dialog"]')) return
      if (e.key === 'ArrowLeft') prev()
      else if (e.key === 'ArrowRight') next()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [prev, next])

  // Bookmark navigation
  useEffect(() => {
    const onGotoPosition = (e: Event) => {
      const pos = (e as CustomEvent<number>).detail
      if (typeof pos === 'number') {
        setPage(findPageForPosition(pos))
        containerRef.current?.scrollTo({ top: 0 })
      }
    }
    const onGotoLabel = (e: Event) => {
      const label = (e as CustomEvent<string>).detail
      if (typeof label === 'string') {
        const idx = pages.findIndex((p) => p.includes(label))
        if (idx >= 0) {
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
  }, [findPageForPosition, pages, totalPages])

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
    addHighlight({
      bookId: book.id,
      text: selection.text,
      color,
      textPosition: pageStartPos,
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

  const handleTTS = () => {
    if (tts.speaking) {
      tts.stop()
      return
    }
    const text = currentPage.replace(/[#*_`>-]/g, '').replace(/\n+/g, ' ')
    // The settings panel stores the voice by `voiceURI`; match it first and
    // fall back to `name` for values saved by older versions.
    const voice = settings.ttsVoice
      ? window.speechSynthesis
          .getVoices()
          .find((v) => v.voiceURI === settings.ttsVoice || v.name === settings.ttsVoice) ?? null
      : null
    tts.speak(text, { rate: settings.ttsRate, voice })
  }

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

  // Render a paragraph with highlights
  const renderParagraph = (para: string, i: number) => {
    const segments = splitWithHighlights(para, pageHighlights)
    return (
      <p key={i} className="mb-4 whitespace-pre-wrap">
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
        <article
          ref={articleRef}
          className="mx-auto px-6 py-10 max-w-3xl"
          style={{
            ...readerStyle,
            paddingLeft: marginX,
            paddingRight: marginX,
          }}
        >
          {book.format === 'md' ? (
            <div className="prose prose-lg max-w-none dark:prose-invert" style={{ color: 'inherit' }}>
              <ReactMarkdown>{currentPage}</ReactMarkdown>
            </div>
          ) : (
            currentPage.split(/\n\n+/).map((para, i) => renderParagraph(para, i))
          )}
        </article>
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
        disabled={page === 0}
        className="fixed left-2 top-1/2 -translate-y-1/2 h-12 w-12 rounded-full bg-black/5 hover:bg-black/10 disabled:opacity-20"
        aria-label="Назад"
      >
        <ChevronLeft className="h-6 w-6" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        onClick={next}
        disabled={page >= totalPages - 1}
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
          {page + 1} / {totalPages}
        </div>
      )}
    </div>
  )
}
