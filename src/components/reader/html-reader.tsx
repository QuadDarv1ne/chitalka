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
  type HighlightColor,
  type Highlight,
} from '@/store/reader-store'
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
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
      .catch((e) => logger.error(e))
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [book.id, book.blob, book.textPosition])

  // Split HTML into pages by sections. Must be memoized on `html` — the
  // content loads asynchronously, so a lazy useState initializer would only
  // ever see the empty string and produce a blank reader.
  const pages = useMemo(() => splitHtmlIntoPages(html), [html])
  const totalPages = pages.length

  // Clamp the restored page once the book is paginated (the saved position
  // may exceed the page count for a different pagination)
  useEffect(() => {
    if (totalPages > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPage((p) => Math.max(0, Math.min(p, totalPages - 1)))
    }
  }, [totalPages])

  const currentPage = pages[page] || ''
  const progress = totalPages > 0 ? (page + 1) / totalPages : 0

  // Highlights for current page (approximate by text position)
  const pageStartPos = page * PAGE_WORDS
  const pageEndPos = (page + 1) * PAGE_WORDS
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

  // Bookmark / highlight navigation from the panels
  useEffect(() => {
    const onGotoPosition = (e: Event) => {
      const pos = (e as CustomEvent<number>).detail
      if (typeof pos === 'number') {
        const wordCount = Math.floor(pos / PAGE_WORDS)
        setPage(Math.max(0, Math.min(totalPages - 1, wordCount)))
        containerRef.current?.scrollTo({ top: 0 })
      }
    }
    window.addEventListener('txt-goto-position', onGotoPosition)
    return () => window.removeEventListener('txt-goto-position', onGotoPosition)
  }, [totalPages])

  // Messages from the reader iframe: text selection and highlight clicks
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frameRef.current?.contentWindow) return
      const data = e.data
      if (!data || data.__chitalka !== true) return
      if (data.type === 'select') {
        const rect = frameRef.current?.getBoundingClientRect()
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
          {/* Render HTML in an iframe for isolation.
              sandbox="allow-scripts" + opaque origin: the book's own <script>
              tags still render/interact, but cannot reach cookies, IndexedDB,
              the parent window or same-origin /api/* endpoints. */}
          <iframe
            ref={frameRef}
            title={book.title}
            sandbox="allow-scripts"
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
 * Split HTML content into pages by <h1>/<h2> headings or <section> tags,
 * falling back to chunks of ~PAGE_WORDS for unstructured books.
 */
function splitHtmlIntoPages(html: string): string[] {
  if (!html) return []

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
    return merged
  }

  return chunks.length > 0 ? chunks : [html]
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
  const bg = 'var(--reader-bg)'
  const fg = 'var(--reader-fg)'
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
