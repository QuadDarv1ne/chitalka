'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import type { BookRecord } from '@/lib/library'
import { useReaderStore, fontFamilyCss, type HighlightColor } from '@/store/reader-store'
import { decodeTextBlob } from '@/lib/text-encoding'
import { useReadingTracker } from '@/hooks/use-reading-tracker'
import { PAGE_WORDS } from '@/lib/constants'
import { ColorPicker } from './highlights-panel'
import { toast } from 'sonner'

interface Props {
  book: BookRecord
  onProgress: (p: number, extra?: { textPosition?: number }) => void
}

export function HtmlReader({ book, onProgress }: Props) {
  const [html, setHtml] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(0)
  const [pagesFlipped, setPagesFlipped] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [selection, setSelection] = useState<{ x: number; y: number; text: string } | null>(null)
  const [editingHighlightId, setEditingHighlightId] = useState<string | null>(null)
  const [editingNote, setEditingNote] = useState('')
  const settings = useReaderStore((s) => s.settings)
  const highlights = useReaderStore((s) => s.highlights)
  const addHighlight = useReaderStore((s) => s.addHighlight)
  const updateHighlight = useReaderStore((s) => s.updateHighlight)

  useReadingTracker(book.id, pagesFlipped)

  // Load HTML content
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    decodeTextBlob(book.blob)
      .then((text) => {
        if (cancelled) return
        setHtml(text)
        if (book.textPosition) {
          const wordCount = Math.floor(book.textPosition / PAGE_WORDS)
          setPage(Math.max(0, wordCount))
        }
      })
      .catch((e) => console.error(e))
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [book.id, book.blob, book.textPosition])

  // Split HTML into pages by sections
  const pages = useState(() => splitHtmlIntoPages(html))[0]
  const totalPages = pages.length

  // Clamp page once loaded
  useEffect(() => {
    if (totalPages > 0) {
      setPage((p) => Math.max(0, Math.min(p, totalPages - 1)))
    }
  }, [totalPages])

  const currentPage = pages[page] || ''
  const progress = totalPages > 0 ? (page + 1) / totalPages : 0

  // Highlights for current page (approximate by text position)
  const pageStartPos = page * PAGE_WORDS
  const pageEndPos = (page + 1) * PAGE_WORDS
  const pageHighlights = highlights.filter(
    (h) =>
      h.bookId === book.id &&
      h.textPosition !== undefined &&
      h.textPosition >= pageStartPos &&
      h.textPosition < pageEndPos,
  )

  useEffect(() => {
    if (totalPages > 0) {
      onProgress(progress, { textPosition: page * PAGE_WORDS })
    }
  }, [page, totalPages, progress, onProgress])

  const prev = useCallback(() => {
    if (page <= 0) return
    setPage(page - 1)
    setPagesFlipped((n) => n + 1)
    containerRef.current?.scrollTo({ top: 0 })
  }, [page])

  const next = useCallback(() => {
    if (totalPages === 0 || page >= totalPages - 1) return
    setPage(page + 1)
    setPagesFlipped((n) => n + 1)
    containerRef.current?.scrollTo({ top: 0 })
  }, [page, totalPages])

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

  // Touch swipe
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    let startX = 0
    let startY = 0
    const onTouchStart = (e: TouchEvent) => {
      startX = e.touches[0].clientX
      startY = e.touches[0].clientY
    }
    const onTouchEnd = (e: TouchEvent) => {
      const dx = e.changedTouches[0].clientX - startX
      const dy = e.changedTouches[0].clientY - startY
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 3) {
        if (dx > 0) prev()
        else next()
      }
    }
    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchend', onTouchEnd, { passive: true })
    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchend', onTouchEnd)
    }
  }, [prev, next])

  // Highlight from iframe selection
  const handleHighlight = (color: HighlightColor) => {
    if (!selection) return
    addHighlight({
      bookId: book.id,
      text: selection.text,
      color,
      textPosition: page * PAGE_WORDS,
    })
    toast.success('Выделение добавлено')
    setSelection(null)
    window.getSelection()?.removeAllRanges()
  }

  const saveNote = () => {
    if (editingHighlightId) {
      updateHighlight(editingHighlightId, { note: editingNote })
      toast.success('Заметка сохранена')
    }
    setEditingHighlightId(null)
    setEditingNote('')
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
          className="mx-auto max-w-3xl px-6 py-10"
          style={{
            color: 'var(--reader-fg)',
            fontFamily: fontFamilyCss[settings.fontFamily],
            fontSize: `${settings.fontSize}px`,
            lineHeight: settings.lineHeight,
            textAlign: settings.textAlign,
            paddingLeft: `${settings.margin * 1.5}rem`,
            paddingRight: `${settings.margin * 1.5}rem`,
          }}
        >
          {/* Render HTML in an iframe for isolation */}
          <iframe
            ref={frameRef}
            title={book.title}
            srcDoc={buildPageHtml(currentPage, settings, pageHighlights)}
            className="w-full"
            style={{
              minHeight: '60vh',
              border: 'none',
              background: 'transparent',
            }}
          />
        </div>
      )}

      {/* Selection toolbar */}
      {selection && (
        <div
          className="fixed z-50 -translate-x-1/2 -translate-y-full"
          style={{
            left: selection.x,
            top: Math.max(selection.y, 56),
          }}
        >
          <ColorPicker onPick={handleHighlight} />
        </div>
      )}

      {/* Highlight note editor */}
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

/**
 * Split HTML content into pages by <h1>/<h2> headings or chunks of ~PAGE_WORDS.
 */
function splitHtmlIntoPages(html: string): string[] {
  if (!html) return ['']

  // Try splitting by h1/h2 headings first
  const sections = html.split(/(<h[12][^>]*>.*?<\/h[12]>)|(<section[^>]*>)/gi)
  const chunks: string[] = []
  let current = ''

  for (const part of sections) {
    if (!part) continue
    if (/^<h[12]/i.test(part)) {
      if (current) {
        chunks.push(current)
        current = ''
      }
    }
    current += part
  }
  if (current) chunks.push(current)

  // If we got too many chunks (>200), merge them
  if (chunks.length > 200) {
    const merged: string[] = []
    let acc = ''
    for (const chunk of chunks) {
      acc += chunk
      if (merged.length % 3 === 0 && merged.length > 0) {
        merged.push(acc)
        acc = ''
      }
    }
    if (acc) merged.push(acc)
    return merged
  }

  return chunks.length > 0 ? chunks : [html]
}

/**
 * Build a complete HTML page for the iframe with embedded styles.
 */
function buildPageHtml(
  content: string,
  settings: ReturnType<typeof useReaderStore.getState>['settings'],
  _highlights: any[],
): string {
  const bg = 'var(--reader-bg)'
  const fg = 'var(--reader-fg)'
  const fontFamily = fontFamilyCss[settings.fontFamily]

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body {
    margin: 0;
    padding: 0;
    background: ${bg};
    color: ${fg};
    font-family: ${fontFamily};
    font-size: ${settings.fontSize}px;
    line-height: ${settings.lineHeight};
    text-align: ${settings.textAlign};
    hyphens: ${settings.hyphens ? 'auto' : 'manual'};
    -webkit-hyphens: ${settings.hyphens ? 'auto' : 'manual'};
  }
  body {
    padding: 1rem 0;
  }
  h1, h2, h3, h4, h5, h6 {
    color: ${fg};
    font-family: ${fontFamily};
    margin-top: 1.5em;
    margin-bottom: 0.5em;
  }
  h1 { font-size: 2em; }
  h2 { font-size: 1.5em; }
  a { color: #2563eb; }
  img { max-width: 100%; height: auto; }
  p { margin: 0.8em 0; }
  blockquote {
    border-left: 3px solid var(--primary);
    padding-left: 1em;
    margin: 1em 0;
    color: ${fg};
    opacity: 0.8;
  }
  code {
    background: color-mix(in srgb, ${fg} 10%, transparent);
    padding: 0.1em 0.3em;
    border-radius: 3px;
    font-family: ${fontFamily};
  }
  pre {
    background: color-mix(in srgb, ${fg} 8%, transparent);
    padding: 1em;
    border-radius: 6px;
    overflow-x: auto;
    font-size: 0.9em;
  }
  table {
    border-collapse: collapse;
    width: 100%;
    margin: 1em 0;
  }
  th, td {
    border: 1px solid color-mix(in srgb, ${fg} 20%, transparent);
    padding: 0.5em;
    text-align: left;
  }
  th {
    background: color-mix(in srgb, ${fg} 10%, transparent);
  }
</style>
</head>
<body>
${content}
</body>
</html>`
}
