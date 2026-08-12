'use client'

import { logger } from '@/lib/logger'
import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Search } from 'lucide-react'
import { useReaderStore } from '@/store/reader-store'
import type { BookRecord } from '@/lib/library'
import { PAGE_WORDS } from '@/lib/constants'
import { initPdfWorker } from '@/lib/pdf-worker'
import { decodeTextBlob } from '@/lib/text-encoding'

interface Props {
  book: BookRecord
}

interface SearchResult {
  page: number
  snippet: string
  matchIndex: number
}

/**
 * Full-text search dialog.
 * For TXT/MD: searches in the loaded text.
 * For PDF: extracts text per page using pdfjs.
 * For EPUB: searches across spine items using epub.js.
 */
export function SearchDialog({ book }: Props) {
  const open = useReaderStore((s) => s.searchOpen)
  const setOpen = useReaderStore((s) => s.setSearchOpen)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [textContent, setTextContent] = useState<string>('')
  const [textLoaded, setTextLoaded] = useState(false)
  // Search is text-format-only for the button gating (PDF/EPUB search works without preprocessing)
  const needsText = book.format === 'txt' || book.format === 'md' || book.format === 'fb2' || book.format === 'html'
  // Monotonic counter: stale (out-of-order) search results are discarded
  const searchSeqRef = useRef(0)
  const openRef = useRef(open)
  openRef.current = open

  // Invalidate in-flight searches when the component unmounts (e.g. the
  // reader closes mid-search) so they can't touch unmounted state.
  useEffect(() => {
    return () => {
      searchSeqRef.current++
    }
  }, [])

  // Load text content (for TXT/MD/FB2/HTML)
  useEffect(() => {
    if (!open) return
    let cancelled = false
    if (book.format === 'txt' || book.format === 'md' || book.format === 'fb2' || book.format === 'html') {
      setTextLoaded(false)
      decodeTextBlob(book.blob)
        .then((text) => {
          if (!cancelled) {
            setTextContent(text)
            setTextLoaded(true)
          }
        })
        .catch((e) => logger.error(e))
    }
    return () => { cancelled = true }
  }, [open, book])

  // Word-start character offsets, built once per text — match-to-word
  // conversion then costs O(log n) per hit instead of O(n) slice+split.
  const wordStarts = useMemo(() => {
    const starts: number[] = []
    let inWord = false
    for (let i = 0; i < textContent.length; i++) {
      const isWs = /\s/.test(textContent[i])
      if (!isWs && !inWord) starts.push(i)
      inWord = !isWs
    }
    return starts
  }, [textContent])

  const search = useCallback(async () => {
    if (!query.trim()) {
      setResults([])
      setSearched(false)
      return
    }
    if (!textLoaded && needsText) {
      return
    }
    const seq = ++searchSeqRef.current
    setLoading(true)
    setSearched(true)
    try {
      if (book.format === 'txt' || book.format === 'md' || book.format === 'fb2' || book.format === 'html') {
        const lower = textContent.toLowerCase()
        const q = query.toLowerCase()
        const found: SearchResult[] = []
        let idx = lower.indexOf(q)
        while (idx !== -1 && found.length < 100) {
          // Word offset of the match start: binary search over precomputed
          // word-start positions (positions are stored in words, indexes in chars)
          let lo = 0
          let hi = wordStarts.length
          while (lo < hi) {
            const mid = (lo + hi) >> 1
            if (wordStarts[mid] <= idx) lo = mid + 1
            else hi = mid
          }
          const wordOffset = lo
          const pageNum = Math.floor(wordOffset / PAGE_WORDS) + 1
          const start = Math.max(0, idx - 50)
          const end = Math.min(textContent.length, idx + query.length + 50)
          const snippet =
            (start > 0 ? '…' : '') +
            textContent.slice(start, end).replace(/\n+/g, ' ') +
            (end < textContent.length ? '…' : '')
          found.push({
            page: pageNum,
            snippet,
            matchIndex: wordOffset,
          })
          idx = lower.indexOf(q, idx + 1)
        }
        if (searchSeqRef.current === seq && openRef.current) setResults(found)
      } else if (book.format === 'pdf') {
        // Search PDF pages via pdfjs
        const pdfjs = await import('pdfjs-dist')
        await initPdfWorker()
        const data = await book.blob.arrayBuffer()
        const loadingTask = pdfjs.getDocument({ data })
        const doc = await loadingTask.promise
        const found: SearchResult[] = []
        const q = query.toLowerCase()
        try {
          for (let i = 1; i <= doc.numPages && found.length < 50; i++) {
            if (searchSeqRef.current !== seq) return
            const page = await doc.getPage(i)
            const content = await page.getTextContent()
            // pdfjs-dist v6: getTextContent returns items array with TextItem objects
            const text = content.items
              .filter((item: any): item is { str: string } => 'str' in item)
              .map((item) => item.str)
              .join(' ')
            const lower = text.toLowerCase()
            const idx = lower.indexOf(q)
            if (idx !== -1) {
              const start = Math.max(0, idx - 50)
              const end = Math.min(text.length, idx + query.length + 50)
              const snippet =
                (start > 0 ? '…' : '') +
                text.slice(start, end) +
                (end < text.length ? '…' : '')
              found.push({ page: i, snippet, matchIndex: idx })
            }
          }
        } finally {
          // Release the document and its worker
          loadingTask.destroy().catch(() => {})
        }
        if (searchSeqRef.current === seq && openRef.current) setResults(found)
      } else if (book.format === 'epub') {
        // EPUB: use epub.js's built-in search via Book.spine
        const ePub = (await import('epubjs')).default
        const blobUrl = URL.createObjectURL(book.blob)
        let epubBook: any = null
        try {
          epubBook = ePub(blobUrl)
          await epubBook.ready
          const spine = await epubBook.spine
          const found: SearchResult[] = []
          const q = query.toLowerCase()
          for (const item of (spine as any).items) {
            if (found.length >= 50 || searchSeqRef.current !== seq) break
            try {
              const doc = await item.load(epubBook.load.bind(epubBook))
              const text = doc.body?.textContent || ''
              const lower = text.toLowerCase()
              let idx = lower.indexOf(q)
              while (idx !== -1 && found.length < 50) {
                const start = Math.max(0, idx - 50)
                const end = Math.min(text.length, idx + query.length + 50)
                const snippet =
                  (start > 0 ? '…' : '') +
                  text.slice(start, end).replace(/\s+/g, ' ') +
                  (end < text.length ? '…' : '')
                found.push({
                  page: item.index,
                  snippet,
                  matchIndex: idx,
                })
                idx = lower.indexOf(q, idx + 1)
              }
            } catch { logger.warn('EPUB spine item load failed') }
          }
          if (searchSeqRef.current === seq && openRef.current) setResults(found)
        } finally {
          try {
            epubBook?.destroy()
          } catch { /* already destroyed */ }
          URL.revokeObjectURL(blobUrl)
        }
      }
    } catch (e) {
      logger.error('Search failed', e)
    } finally {
      if (searchSeqRef.current === seq) setLoading(false)
    }
  }, [query, book, textContent, textLoaded, wordStarts])

  const goTo = useCallback(
    (result: SearchResult) => {
      if (book.format === 'txt' || book.format === 'md' || book.format === 'fb2' || book.format === 'html') {
        window.dispatchEvent(
          new CustomEvent('txt-goto-position', { detail: result.matchIndex }),
        )
      } else if (book.format === 'pdf') {
        window.dispatchEvent(
          new CustomEvent('pdf-goto-page', { detail: result.page }),
        )
      } else if (book.format === 'epub') {
        window.dispatchEvent(
          new CustomEvent('epub-goto-spine', { detail: result.page }),
        )
      }
      setOpen(false)
    },
    [book.format, setOpen],
  )

  // Reset on close
  useEffect(() => {
    if (!open) {
      searchSeqRef.current++
      setQuery('')
      setResults([])
      setSearched(false)
      setTextContent('')
      setTextLoaded(false)
    }
  }, [open])

  // Cmd/Ctrl+F to focus
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault()
        setOpen(true)
      } else if (e.key === 'Escape' && open) {
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, setOpen])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Search className="h-5 w-5" />
            Поиск по книге
          </DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            search()
          }}
          className="flex gap-2"
        >
          <Input
            autoFocus
            placeholder="Введите текст для поиска..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <Button
            type="submit"
            disabled={loading || !query.trim() || (needsText && !textLoaded)}
          >
            Найти
          </Button>
        </form>
        <div className="flex-1 overflow-y-auto -mx-2 px-2">
          {results.length > 0 && (
            <p className="text-xs text-muted-foreground mb-2 px-1">
              Найдено результатов: {results.length}
            </p>
          )}
          <ul className="space-y-1">
            {results.map((r, i) => (
              <li key={i}>
                <button
                  onClick={() => goTo(r)}
                  className="w-full text-left rounded-md p-2 hover:bg-accent transition-colors"
                >
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                    <span className="rounded bg-muted px-1.5 py-0.5">
                      Стр. {r.page}
                    </span>
                  </div>
                  <p className="text-sm line-clamp-2">{r.snippet}</p>
                </button>
              </li>
            ))}
            {results.length === 0 && searched && !loading && (
              <p className="text-center text-sm text-muted-foreground py-8">
                Ничего не найдено
              </p>
            )}
            {!query && (
              <p className="text-center text-sm text-muted-foreground py-8">
                Введите запрос и нажмите «Найти»
              </p>
            )}
          </ul>
        </div>
      </DialogContent>
    </Dialog>
  )
}
