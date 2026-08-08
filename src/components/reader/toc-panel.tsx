'use client'

import { useEffect, useState } from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { BookOpen, FileText } from 'lucide-react'
import type { BookRecord } from '@/lib/library'
import { Button } from '@/components/ui/button'
import { initPdfWorker } from '@/lib/pdf-worker'
import { decodeTextBlob } from '@/lib/text-encoding'

interface TocItem {
  id: string
  href: string
  label: string
  subitems?: TocItem[]
  level: number
}

interface Props {
  book: BookRecord
  onNavigate: () => void
}

const tocCache = new Map<string, TocItem[]>()

export function TocPanel({ book, onNavigate }: Props) {
  const [toc, setToc] = useState<TocItem[]>(() => tocCache.get(book.id) ?? [])
  const [loading, setLoading] = useState(() => !tocCache.has(book.id))

  useEffect(() => {
    const cached = tocCache.get(book.id)
    if (cached) {
      setToc(cached)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    ;(async () => {
      if (book.format === 'epub') {
        let epubBook: any = null
        let blobUrl = ''
        try {
          const ePub = (await import('epubjs')).default
          blobUrl = URL.createObjectURL(book.blob)
          epubBook = ePub(blobUrl)
          await epubBook.ready
          const navigation = await epubBook.loaded.navigation
          if (cancelled) return
          const flatten = (items: any[], level = 0): TocItem[] => {
            return items.map((it) => ({
              id: it.id,
              href: it.href,
              label: it.label.trim(),
              level,
              subitems: it.subitems?.length
                ? flatten(it.subitems, level + 1)
                : undefined,
            }))
          }
          const flattened = flatten(navigation.toc || [])
          tocCache.set(book.id, flattened)
          setToc(flattened)
        } catch (e) {
          console.error(e)
        } finally {
          try {
            epubBook?.destroy()
          } catch { /* already destroyed */ }
          if (blobUrl) URL.revokeObjectURL(blobUrl)
        }
      } else if (book.format === 'pdf') {
        let doc: any = null
        try {
          const pdfjs = await import('pdfjs-dist')
          await initPdfWorker()
          const data = await book.blob.arrayBuffer()
          doc = await pdfjs.getDocument({ data }).promise
          const items: TocItem[] = []
          const outline = await doc.getOutline().catch(() => [])
          const walk = async (nodes: any[], level = 0) => {
            for (const n of nodes) {
              if (cancelled) return
              let pageNum = 1
              if (n.dest) {
                try {
                  const dest = typeof n.dest === 'string' ? await doc.getDestination(n.dest) : n.dest
                  if (dest?.[0]) {
                    const idx = await doc.getPageIndex(dest[0])
                    pageNum = idx + 1
                  }
                } catch { console.warn('PDF destination lookup failed') }
              }
              items.push({
                id: crypto.randomUUID(),
                href: String(pageNum),
                label: n.title,
                level,
              })
              if (n.items?.length) await walk(n.items, level + 1)
            }
          }
          if (outline) await walk(outline)
          // If no outline, generate page list
          if (items.length === 0) {
            for (let i = 1; i <= doc.numPages; i++) {
              items.push({
                id: crypto.randomUUID(),
                href: String(i),
                label: `Страница ${i}`,
                level: 0,
              })
            }
          }
          if (!cancelled) {
            tocCache.set(book.id, items)
            setToc(items)
          }
        } catch (e) {
          console.error(e)
        } finally {
          doc?.destroy().catch(() => {})
        }
      } else {
        // For text/markdown/fb2, generate TOC from headings
        try {
          // decodeTextBlob honors BOMs and falls back to cp1251 — blob.text()
          // always assumes UTF-8 and produces mojibake for Russian FB2/TXT
          const text = await decodeTextBlob(book.blob)
          const lines = text.split('\n')
          const items: TocItem[] = []
          for (const line of lines) {
            // Markdown headings: # Title, ## Title, etc.
            const mdMatch = line.match(/^(#{1,6})\s+(.+)$/)
            if (mdMatch) {
              items.push({
                id: crypto.randomUUID(),
                href: '',
                label: mdMatch[2].trim(),
                level: mdMatch[1].length - 1,
              })
              continue
            }
            // Russian patterns: "Глава N. Title", "Часть N. Title"
            const ruMatch = line.match(/^(Глава|Часть|Раздел|Пролог|Эпилог)\s+(\d+|[IVX]+)[.\s—–-]*(.*)$/i)
            if (ruMatch) {
              const label = ruMatch[3].trim()
              items.push({
                id: crypto.randomUUID(),
                href: '',
                label: label
                  ? `${ruMatch[1]} ${ruMatch[2]}. ${label}`
                  : `${ruMatch[1]} ${ruMatch[2]}`,
                level: 0,
              })
              continue
            }
            // English: "Chapter N. Title"
            const enMatch = line.match(/^(Chapter|Part|Section|Prologue|Epilogue)\s+(\d+|[IVX]+)[.\s—–-]*(.*)$/i)
            if (enMatch) {
              const label = enMatch[3].trim()
              items.push({
                id: crypto.randomUUID(),
                href: '',
                label: label
                  ? `${enMatch[1]} ${enMatch[2]}. ${label}`
                  : `${enMatch[1]} ${enMatch[2]}`,
                level: 0,
              })
            }
          }
          if (!cancelled) {
            tocCache.set(book.id, items)
            setToc(items)
          }
        } catch (e) {
          console.error(e)
        }
      }
      if (!cancelled) setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [book])

  if (loading) {
    return (
      <div className="p-4 text-sm text-muted-foreground">Загрузка оглавления…</div>
    )
  }

  if (toc.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 p-8 text-center">
        <BookOpen className="h-10 w-10 text-muted-foreground/50" />
        <p className="text-sm text-muted-foreground">
          В этой книге нет оглавления
        </p>
      </div>
    )
  }

  const handleClick = (item: TocItem) => {
    if (book.format === 'epub') {
      // For search results, "page" is the spine index
      // For TOC, "href" is the chapter href
      window.dispatchEvent(
        new CustomEvent('epub-goto', { detail: item.href }),
      )
    } else if (book.format === 'pdf') {
      const pageNum = parseInt(item.href, 10)
      if (!isNaN(pageNum)) {
        window.dispatchEvent(
          new CustomEvent('pdf-goto-page', { detail: pageNum }),
        )
      }
    } else {
      window.dispatchEvent(
        new CustomEvent('txt-goto', { detail: item.label }),
      )
    }
    onNavigate()
  }

  return (
    <ScrollArea className="h-[calc(100vh-8rem)]">
      <nav className="p-2">
        <ul className="space-y-0.5">
          {toc.map((item) => (
            <TocRow key={item.id} item={item} onClick={() => handleClick(item)} />
          ))}
        </ul>
      </nav>
    </ScrollArea>
  )
}

function TocRow({ item, onClick }: { item: TocItem; onClick: () => void }) {
  const hasSubitems = item.subitems && item.subitems.length > 0
  return (
    <li>
      <Button
        variant="ghost"
        size="sm"
        className="w-full justify-start gap-2 h-auto py-2 text-left font-normal"
        style={{ paddingLeft: `${item.level * 12 + 8}px` }}
        onClick={onClick}
      >
        <FileText className="h-3.5 w-3.5 flex-shrink-0 opacity-50" />
        <span className="truncate text-sm">{item.label}</span>
      </Button>
      {hasSubitems && (
        <ul className="space-y-0.5">
          {item.subitems!.map((sub) => (
            <TocRow key={sub.id} item={sub} onClick={onClick} />
          ))}
        </ul>
      )}
    </li>
  )
}
