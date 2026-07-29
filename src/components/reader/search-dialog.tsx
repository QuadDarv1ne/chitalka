'use client'

import { useEffect, useState, useCallback } from 'react'
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
  const [textContent, setTextContent] = useState<string>('')

  // Load text content (for TXT/MD/FB2)
  useEffect(() => {
    if (!open) return
    let cancelled = false
    if (book.format === 'txt' || book.format === 'md' || book.format === 'fb2') {
      book.blob.text().then((text) => {
        if (!cancelled) setTextContent(text)
      })
    }
    return () => { cancelled = true }
  }, [open, book])

  const search = useCallback(async () => {
    if (!query.trim()) {
      setResults([])
      return
    }
    setLoading(true)
    try {
      if (book.format === 'txt' || book.format === 'md' || book.format === 'fb2') {
        const lower = textContent.toLowerCase()
        const q = query.toLowerCase()
        const found: SearchResult[] = []
        let idx = lower.indexOf(q)
        while (idx !== -1 && found.length < 100) {
          const pageNum = Math.floor(idx / PAGE_WORDS) + 1
          const start = Math.max(0, idx - 50)
          const end = Math.min(textContent.length, idx + query.length + 50)
          const snippet =
            (start > 0 ? '…' : '') +
            textContent.slice(start, end).replace(/\n+/g, ' ') +
            (end < textContent.length ? '…' : '')
          found.push({
            page: pageNum,
            snippet,
            matchIndex: idx,
          })
          idx = lower.indexOf(q, idx + 1)
        }
        setResults(found)
      } else if (book.format === 'pdf') {
        // Search PDF pages via pdfjs
        const pdfjs = await import('pdfjs-dist')
        await initPdfWorker()
        const data = await book.blob.arrayBuffer()
        const doc = await pdfjs.getDocument({ data }).promise
        const found: SearchResult[] = []
        const q = query.toLowerCase()
        for (let i = 1; i <= doc.numPages && found.length < 50; i++) {
          const page = await doc.getPage(i)
          const content = await page.getTextContent()
          const text = content.items.map((it: any) => it.str).join(' ')
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
        setResults(found)
      } else if (book.format === 'epub') {
        // EPUB: use epub.js's built-in search via Book.spine
        const ePub = (await import('epubjs')).default
        const blobUrl = URL.createObjectURL(book.blob)
        const epubBook = ePub(blobUrl)
        await epubBook.ready
        const spine = await epubBook.spine
        const found: SearchResult[] = []
        const q = query.toLowerCase()
        for (const item of (spine as any).items) {
          if (found.length >= 50) break
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
          } catch { console.warn('EPUB spine item load failed') }
        }
        URL.revokeObjectURL(blobUrl)
        setResults(found)
      }
    } catch (e) {
      console.error('Search failed', e)
    } finally {
      setLoading(false)
    }
  }, [query, book, textContent])

  const goTo = useCallback(
    (result: SearchResult) => {
      if (book.format === 'txt' || book.format === 'md' || book.format === 'fb2') {
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
      setQuery('')
      setResults([])
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
          <Button type="submit" disabled={loading || !query.trim()}>
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
            {results.length === 0 && query && !loading && (
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
