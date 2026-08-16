'use client'

import { logger } from '@/lib/logger'
import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import type { BookRecord } from '@/lib/library'
import {
  useReaderStore,
  fontFamilyCss,
  highlightColors,
  themeBg,
  themeFg,
  type HighlightColor,
  type Highlight,
} from '@/store/reader-store'
import { decodeTextBlob } from '@/lib/text-encoding'
import { useReadingTracker } from '@/hooks/use-reading-tracker'
import { ColorPicker } from './highlights-panel'
import { toast } from 'sonner'

interface Props {
  book: BookRecord
  onProgress: (p: number, extra?: { textPosition?: number }) => void
}

export function HtmlReader({ book, onProgress }: Props) {
  const [html, setHtml] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [decodeError, setDecodeError] = useState(false)
  const [page, setPage] = useState(0)
  const [pagesFlipped, setPagesFlipped] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLIFrameElement>(null)
  const frameRightRef = useRef<HTMLIFrameElement>(null)
  const selectionSourceRef = useRef<'left' | 'right'>('left')
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
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    decodeTextBlob(book.blob)
      .then((text) => {
        if (cancelled) return
        setHtml(text)
      })
      .catch((e) => {
        logger.error(e)
        if (!cancelled) setDecodeError(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [book.id, book.blob])

  // Split HTML into pages by sections. Must be memoized on `html` — the
  // content loads asynchronously, so a lazy useState initializer would only
  // ever see the empty string and produce a blank reader.
  const [pages, pageStarts] = useMemo(() => splitHtmlIntoPages(html), [html])
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
  // In two-page mode the spread is aligned to an even left page, so the
  // restored page stays visible (as the right page for odd indices).
  const alignToSpread = (p: number) => (twoPage ? (p % 2 === 0 ? p : Math.max(0, p - 1)) : p)

  // Reset per-book state when the user switches between two books of the
  // same format — the component stays mounted and a stale restore flag
  // would open the new book at the old book's page.
  const bookIdRef = useRef(book.id)
  /* eslint-disable react-hooks/refs */
  if (book.id !== bookIdRef.current) {
    bookIdRef.current = book.id
    positionRestoredRef.current = false
    setPage(0)
    setPagesFlipped(0)
  }
  /* eslint-enable react-hooks/refs */

  useEffect(() => {
    if (totalPages === 0 || positionRestoredRef.current) return
    if (book.textPosition) {
      positionRestoredRef.current = true
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPage(alignToSpread(findPageForPosition(book.textPosition)))
    }
  }, [totalPages, book.textPosition, findPageForPosition, alignToSpread])

  // Clamp the restored page once the book is paginated (the saved position
  // may exceed the page count for a different pagination)
  useEffect(() => {
    if (totalPages > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPage((p) => alignToSpread(Math.max(0, Math.min(p, totalPages - 1))))
    }
  }, [totalPages, alignToSpread])

  const currentPage = pages[page] || ''
  const twoPage = settings.twoPage
  const rightPage = twoPage ? (pages[page + 1] || '') : ''
  const pagesInSpread = twoPage ? (rightPage ? 2 : 1) : 1
  const progress = totalPages > 0 ? Math.min(1, (page + pagesInSpread) / totalPages) : 0

  // Highlights for current page (by real word range)
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

  // Highlights that belong to the right page of a two-page spread
  const rightPageStartPos = twoPage ? (pageStarts[page + 1] ?? 0) : 0
  const rightPageEndPos = twoPage ? (pageStarts[page + 2] ?? Infinity) : Infinity
  const rightPageHighlights = useMemo(
    () =>
      highlights.filter(
        (h) =>
          h.bookId === book.id &&
          h.textPosition !== undefined &&
          h.textPosition >= rightPageStartPos &&
          h.textPosition < rightPageEndPos,
      ),
    [highlights, book.id, rightPageStartPos, rightPageEndPos],
  )

  useEffect(() => {
    if (totalPages > 0) {
      onProgress(progress, { textPosition: pageStartPos })
    }
  }, [page, totalPages, progress, onProgress, pageStartPos])

  const prev = useCallback(() => {
    const step = twoPage ? 2 : 1
    if (page - step < 0) return
    setPage(page - step)
    setPagesFlipped((n) => n + 1)
    containerRef.current?.scrollTo({ top: 0 })
  }, [page, twoPage])

  const next = useCallback(() => {
    const step = twoPage ? 2 : 1
    if (totalPages === 0 || page + step > totalPages - 1) {
      // On the last odd page, a single-page step still flips the final page
      if (twoPage && page + 1 <= totalPages - 1) {
        setPage(page + 1)
        setPagesFlipped((n) => n + 1)
        containerRef.current?.scrollTo({ top: 0 })
      }
      return
    }
    setPage(page + step)
    setPagesFlipped((n) => n + 1)
    containerRef.current?.scrollTo({ top: 0 })
  }, [page, totalPages, twoPage])

  // Keyboard nav
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.target instanceof Element && e.target.closest('[role="dialog"]')) return
      if ((e.key === ' ' || e.key === 'PageDown' || e.key === 'PageUp') &&
        e.target instanceof Element && e.target.closest('button, a')) return
      if (e.key === 'ArrowLeft' || e.key === 'PageUp' || e.key === 'Backspace') {
        if (e.key === 'Backspace') e.preventDefault()
        prev()
      }
      else if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
        if (e.key === ' ' || e.key === 'PageDown') e.preventDefault()
        next()
      }
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

  // Bookmark / highlight navigation from the panels
  useEffect(() => {
    const onGotoPosition = (e: Event) => {
      const pos = (e as CustomEvent<number>).detail
      if (typeof pos === 'number') {
        setPage(alignToSpread(findPageForPosition(pos)))
        containerRef.current?.scrollTo({ top: 0 })
      }
    }
    const onGotoLabel = (e: Event) => {
      const label = (e as CustomEvent<string>).detail
      if (typeof label === 'string') {
        const idx = pages.findIndex((p) => p.includes(label))
        if (idx >= 0) {
          setPage(alignToSpread(idx))
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
  }, [totalPages, pages, findPageForPosition, alignToSpread])

  // Messages from the reader iframe: text selection and highlight clicks
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frameRef.current?.contentWindow &&
          e.source !== frameRightRef.current?.contentWindow) return
      const data = e.data
      if (!data || data.__chitalka !== true) return
      if (data.type === 'select') {
        const fromRight = e.source === frameRightRef.current?.contentWindow
        selectionSourceRef.current = fromRight ? 'right' : 'left'
        const frame = fromRight ? frameRightRef.current : frameRef.current
        const rect = frame?.getBoundingClientRect()
        setSelection({
          x: (rect?.left ?? 0) + data.x,
          y: (rect?.top ?? 0) + data.y,
          text: data.text,
        })
      } else if (data.type === 'highlight-click') {
        const h = highlights.find((hh) => hh.id === data.id)
        if (h) {
          setEditingHighlightId(h.id)
          setEditingNote(h.note ?? '')
        }
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [highlights])

  // Highlight from iframe selection
  const handleHighlight = (color: HighlightColor) => {
    if (!selection) return
    const pos =
      selectionSourceRef.current === 'right' && twoPage
        ? (pageStarts[page + 1] ?? pageStartPos)
        : pageStartPos
    addHighlight({
      bookId: book.id,
      text: selection.text,
      color,
      textPosition: pos,
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
      ) : decodeError ? (
        <div className="flex h-full flex-col items-center justify-center gap-3">
          <p className="text-sm text-muted-foreground">Не удалось прочитать файл книги</p>
          <p className="text-xs text-muted-foreground/60">
            Файл может быть повреждён или закодирован в неподдерживаемом формате
          </p>
        </div>
      ) : (
        <div
          className={`mx-auto flex items-stretch py-10 ${
            twoPage ? 'max-w-[min(140rem,99vw)] gap-0' : 'max-w-[min(100rem,97vw)]'
          }`}
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
          {/* Left page */}
          <iframe
            ref={frameRef}
            title={book.title}
            sandbox="allow-scripts"
            srcDoc={buildPageHtml(currentPage, settings, pageHighlights)}
            className="flex-1 min-w-0"
            style={{
              minHeight: '60vh',
              border: 'none',
              background: 'transparent',
            }}
          />
          {/* Right page (two-page spread) */}
          {twoPage && rightPage && (
            <iframe
              ref={frameRightRef}
              title={`${book.title} — стр. ${page + 2}`}
              sandbox="allow-scripts"
              srcDoc={buildPageHtml(rightPage, settings, rightPageHighlights)}
              className="flex-1 min-w-0 border-l"
              style={{
                minHeight: '60vh',
                border: 'none',
                background: 'transparent',
                borderColor: 'color-mix(in srgb, var(--reader-fg) 10%, transparent)',
              }}
            />
          )}
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

/**
 * Split HTML content into pages by <h1>/<h2> headings or <section> tags,
 * falling back to chunks of ~PAGE_WORDS for unstructured books.
 */
function splitHtmlIntoPages(html: string): [string[], number[]] {
  if (!html) return [[], []]

  const sections = html.split(/(<h[12][^>]*>.*?<\/h[12]>)|(<section[^>]*>)/gi)
  const chunks: string[] = []
  let current = ''

  for (const part of sections) {
    if (!part) continue
    if (/^<h[12]/i.test(part) || /^<section/i.test(part)) {
      if (current) {
        chunks.push(current)
        current = ''
      }
    }
    current += part
  }
  if (current) chunks.push(current)

  // If we got too many chunks (>200), merge groups of 3 into one page
  let pages: string[]
  if (chunks.length > 200) {
    const merged: string[] = []
    let acc = ''
    let count = 0
    for (const chunk of chunks) {
      acc += chunk
      if (++count % 3 === 0) {
        merged.push(acc)
        acc = ''
      }
    }
    if (acc) merged.push(acc)
    pages = merged
  } else {
    pages = chunks.length > 0 ? chunks : [html]
  }

  // Cumulative word offsets per page — the restored position and
  // highlight ranges must land on the page that actually owns them.
  const wordCount = (chunk: string) =>
    chunk.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length
  const starts: number[] = []
  let cumulative = 0
  for (const page of pages) {
    starts.push(cumulative)
    cumulative += wordCount(page)
  }
  return [pages, starts]
}

/**
 * Wrap the text of saved highlights in <mark data-highlight-id> elements.
 * Text is matched per text node (whitespace-insensitive) so attributes and
 * markup are never touched.
 */
function markHighlights(content: string, highlights: Highlight[]): string {
  if (!highlights.length || typeof DOMParser === 'undefined') return content

  const doc = new DOMParser().parseFromString(content, 'text/html')
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT)
  const textNodes: Text[] = []
  while (walker.nextNode()) textNodes.push(walker.currentNode as Text)

  for (const h of highlights) {
    if (!h.text) continue
    const color = highlightColors[h.color] ?? highlightColors.yellow
    let re: RegExp
    try {
      re = new RegExp(
        h.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'),
        'gi',
      )
    } catch {
      continue
    }
    for (const node of textNodes) {
      const data = node.data
      re.lastIndex = 0
      let last = 0
      let m: RegExpExecArray | null
      let matched = false
      const parts: (string | Node)[] = []
      while ((m = re.exec(data)) !== null) {
        if (m[0].length === 0) {
          re.lastIndex++
          continue
        }
        matched = true
        parts.push(data.slice(last, m.index))
        const mark = doc.createElement('mark')
        mark.dataset.highlightId = h.id
        if (h.note) mark.title = h.note
        mark.style.background = color.bg
        mark.style.color = color.fg
        mark.style.padding = '0 2px'
        mark.style.borderRadius = '2px'
        mark.style.borderBottom = h.note ? `2px solid ${color.fg}` : 'none'
        mark.textContent = m[0]
        parts.push(mark)
        last = re.lastIndex
      }
      if (!matched) continue
      parts.push(data.slice(last))
      const frag = doc.createDocumentFragment()
      for (const part of parts) {
        frag.appendChild(typeof part === 'string' ? doc.createTextNode(part) : part)
      }
      node.parentNode?.replaceChild(frag, node)
    }
  }

  return doc.body.innerHTML
}

/**
 * Build a complete HTML page for the iframe with embedded styles.
 * The injected script reports text selections and highlight clicks to the
 * parent window, which owns the selection toolbar and note editor.
 */
function buildPageHtml(
  content: string,
  settings: ReturnType<typeof useReaderStore.getState>['settings'],
  highlights: Highlight[],
): string {
  // CSS custom properties set on the parent document (--reader-bg, --primary)
  // do NOT propagate into an iframe document — embed the resolved values so
  // HTML books actually respect the chosen theme.
  const bg = themeBg[settings.theme]
  const fg = themeFg[settings.theme]
  const accent =
    typeof document !== 'undefined'
      ? getComputedStyle(document.documentElement).getPropertyValue('--primary').trim()
      : fg
  const fontFamily = fontFamilyCss[settings.fontFamily]
  const marked = markHighlights(content, highlights)

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
    border-left: 3px solid ${accent || fg};
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
${marked}
<script>
(function () {
  var markClicked = false;
  document.addEventListener('mousedown', function (e) {
    var t = e.target;
    markClicked = !!(t && t.closest && t.closest('mark'));
  });
  document.addEventListener('mouseup', function () {
    if (markClicked) { markClicked = false; return; }
    var sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;
    var text = sel.toString().trim();
    if (text.length < 2) return;
    var range = sel.getRangeAt(0);
    var rect = range.getBoundingClientRect();
    parent.postMessage({ __chitalka: true, type: 'select', text: text, x: rect.left + rect.width / 2, y: rect.top - 10 }, '*');
  });
  document.addEventListener('click', function (e) {
    var t = e.target;
    var mark = t && t.closest ? t.closest('mark') : null;
    if (!mark) return;
    var id = mark.getAttribute('data-highlight-id');
    if (id) parent.postMessage({ __chitalka: true, type: 'highlight-click', id: id }, '*');
  });
})();
</script>
</body>
</html>`
}
