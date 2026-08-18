'use client'

import { memo, useRef, useCallback, useEffect, useState } from 'react'
import { BookRecord } from '@/lib/library'
import { FileText, BookOpen, Check, Info, Trash2 } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

/**
 * Virtualized grid that only renders visible book cards.
 * Uses a fixed item size per row/col for simplicity — no need for
 * complex measurement since we use CSS aspect-ratio cards.
 */
export function VirtualizedBookList({
  books,
  columns = 6,
  cardGap = 24,
  onOpen,
  onDelete,
  onDetails,
}: {
  books: BookRecord[]
  columns?: number
  cardGap?: number
  onOpen: (book: BookRecord) => void
  onDelete: (book: BookRecord) => void
  onDetails: (book: BookRecord) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [viewportHeight, setViewportHeight] = useState(0)
  const [scrollY, setScrollY] = useState(0)

  // Card dimensions
  const CARD_HEIGHT = 320 // px approx for aspect-[2/3] card with info
  const visibleCount = Math.ceil(viewportHeight / (CARD_HEIGHT + cardGap)) + 2

  const totalHeight = books.length * (CARD_HEIGHT + cardGap)

  const startIndex = Math.max(0, Math.floor(scrollY / (CARD_HEIGHT + cardGap)) - 1)
  const endIndex = Math.min(books.length, startIndex + visibleCount + 2)

  const topOffset = startIndex * (CARD_HEIGHT + cardGap)

  const handleScroll = useCallback(() => {
    if (containerRef.current) {
      setScrollY(containerRef.current.scrollTop)
    }
  }, [])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const onResize = () => {
      setViewportHeight(container.clientHeight)
    }
    onResize()

    container.addEventListener('scroll', handleScroll, { passive: true })
    window.addEventListener('resize', onResize)
    return () => {
      container.removeEventListener('scroll', handleScroll)
      window.removeEventListener('resize', onResize)
    }
  }, [handleScroll])

  const visibleBooks = books.slice(startIndex, endIndex)

  if (books.length === 0) return null

  return (
    <div
      ref={containerRef}
      className="overflow-y-auto overscroll-contain"
      style={{ maxHeight: 'calc(100vh - 300px)' }}
    >
      <div style={{ height: `${totalHeight}px`, position: 'relative' }}>
        <div
          style={{
            transform: `translateY(${topOffset}px)`,
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
          }}
        >
          <div
            className="grid gap-4 md:gap-6"
            style={{
              gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
            }}
          >
            {visibleBooks.map((book) => (
              <BookCardVirtual
                key={book.id}
                book={book}
                onOpen={() => onOpen(book)}
                onDelete={() => onDelete(book)}
                onDetails={() => onDetails(book)}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

const FORMAT_BADGES: Record<string, { label: string; color: string }> = {
  epub: { label: 'EPUB', color: 'bg-green-600 text-white' },
  pdf: { label: 'PDF', color: 'bg-red-600 text-white' },
  txt: { label: 'TXT', color: 'bg-blue-600 text-white' },
  md: { label: 'MD', color: 'bg-purple-600 text-white' },
  html: { label: 'HTML', color: 'bg-orange-600 text-white' },
  fb2: { label: 'FB2', color: 'bg-cyan-600 text-white' },
  mp3: { label: 'MP3', color: 'bg-amber-600 text-white' },
}

const isFinished = (progress?: number) => progress !== undefined && progress >= 0.99

const BookCardVirtual = memo(function BookCardVirtual({
  book,
  onOpen,
  onDelete,
  onDetails,
}: {
  book: BookRecord
  onOpen: () => void
  onDelete: () => void
  onDetails: () => void
}) {
  const badge = FORMAT_BADGES[book.format]
  const stars = book.rating ? '★'.repeat(book.rating) + '☆'.repeat(5 - book.rating) : ''
  const finished = isFinished(book.progress)

  return (
    <Card
      className="group relative overflow-hidden p-0 cursor-pointer hover:shadow-lg transition-all hover:-translate-y-1 duration-200"
      onClick={onOpen}
    >
      <div className="aspect-2/3 relative bg-muted overflow-hidden">
        {book.cover ? (
          <img
            src={book.cover}
            alt={book.title}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-4 text-center bg-linear-to-br from-primary/5 to-primary/10">
            <FileText className="h-12 w-12 text-muted-foreground/60" />
            <span className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
              {book.format}
            </span>
          </div>
        )}
        <div className="absolute top-2 left-2 flex flex-col items-start gap-1">
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${badge.color}`}>
            {badge.label}
          </span>
          {finished && (
            <span className="rounded px-1.5 py-0.5 text-[10px] font-bold bg-green-600 text-white flex items-center gap-1">
              <Check className="h-3 w-3" /> Прочитана
            </span>
          )}
        </div>
        {book.progress !== undefined && book.progress > 0 && (
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/20">
            <div
              className={`h-full ${finished ? 'bg-green-500' : 'bg-primary'}`}
              style={{ width: `${Math.round(book.progress * 100)}%` }}
            />
          </div>
        )}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
          <Button size="sm" variant="secondary">
            <BookOpen className="h-4 w-4 mr-1.5" /> Открыть
          </Button>
        </div>
        <div className="absolute top-2 right-2 flex items-center gap-1">
          <button
            onClick={(e) => {
              e.stopPropagation()
              onDetails()
            }}
            className="h-8 w-8 rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center hover:bg-primary"
            aria-label="Подробнее"
            title="Информация о книге"
          >
            <Info className="h-4 w-4" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation()
              onDelete()
            }}
            className="h-8 w-8 rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center hover:bg-destructive"
            aria-label="Удалить"
            title="Удалить книгу"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="p-3">
        <h3 className="font-medium text-sm line-clamp-2 leading-snug" title={book.title}>
          {book.title}
        </h3>
        <p className="text-xs text-muted-foreground mt-1 line-clamp-1">
          {book.author}
        </p>
        {stars && (
          <p className="text-xs mt-1 text-amber-500" title={`${book.rating} из 5`}>
            {stars}
          </p>
        )}
      </div>
    </Card>
  )
})
