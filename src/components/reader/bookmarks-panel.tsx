'use client'

import { useReaderStore } from '@/store/reader-store'
import type { BookRecord } from '@/lib/library'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { Bookmark, BookmarkX, Plus } from 'lucide-react'

interface Props {
  book: BookRecord
  currentCfi?: string
  currentTextPosition?: number
  currentPdfPage?: number
  currentCbzPage?: number
  onNavigate: () => void
}

export function BookmarksPanel({ book, currentCfi, currentTextPosition, currentPdfPage, currentCbzPage, onNavigate }: Props) {
  const bookmarks = useReaderStore((s) => s.bookmarks)
  const addBookmark = useReaderStore((s) => s.addBookmark)
  const removeBookmark = useReaderStore((s) => s.removeBookmark)

  const bookMarks = bookmarks.filter((b) => b.bookId === book.id)

  const handleAdd = () => {
    addBookmark({
      bookId: book.id,
      cfi: currentCfi ?? book.cfi,
      textPosition: currentTextPosition ?? book.textPosition,
      pdfPage: currentPdfPage ?? book.pdfPage,
      cbzPage: currentCbzPage ?? book.cbzPage,
      label: `Закладка ${bookMarks.length + 1} · ${new Date().toLocaleString('ru-RU', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })}`,
    })
  }

  const handleClick = (mark: (typeof bookMarks)[number]) => {
    if (book.format === 'epub' && mark.cfi) {
      window.dispatchEvent(new CustomEvent('epub-goto-cfi', { detail: mark.cfi }))
    } else if (book.format === 'pdf' && mark.pdfPage) {
      window.dispatchEvent(
        new CustomEvent('pdf-goto-page', { detail: mark.pdfPage }),
      )
    } else if (book.format === 'cbz' && mark.cbzPage !== undefined) {
      window.dispatchEvent(
        new CustomEvent('cbz-goto-page', { detail: mark.cbzPage }),
      )
    } else if (mark.textPosition !== undefined) {
      window.dispatchEvent(
        new CustomEvent('txt-goto-position', { detail: mark.textPosition }),
      )
    }
    onNavigate()
  }

  return (
    <div className="flex flex-col gap-3 p-2">
      <Button onClick={handleAdd} className="gap-2" variant="outline">
        <Plus className="h-4 w-4" /> Добавить закладку
      </Button>

      <ScrollArea className="h-[calc(100vh-12rem)]">
        {bookMarks.length === 0 ? (
          <div className="flex flex-col items-center gap-2 p-8 text-center">
            <Bookmark className="h-10 w-10 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              Закладок пока нет
            </p>
            <p className="text-xs text-muted-foreground/70">
              Добавьте закладку, чтобы вернуться к текущему месту позже
            </p>
          </div>
        ) : (
          <ul className="space-y-1">
            {bookMarks
              .slice()
              .sort((a, b) => b.createdAt - a.createdAt)
              .map((mark) => (
                <li
                  key={mark.id}
                  className="group flex items-center gap-2 rounded-md p-2 hover:bg-accent"
                >
                  <button
                    onClick={() => handleClick(mark)}
                    className="flex flex-1 items-start gap-2 text-left"
                  >
                    <Bookmark className="h-4 w-4 mt-0.5 flex-shrink-0 text-primary" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm leading-tight">{mark.label}</p>
                      {mark.pdfPage !== undefined && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Страница {mark.pdfPage}
                        </p>
                      )}
                      {mark.cbzPage !== undefined && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Страница {mark.cbzPage + 1}
                        </p>
                      )}
                      {mark.textPosition !== undefined && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Позиция ~{mark.textPosition}
                        </p>
                      )}
                    </div>
                  </button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                    onClick={() => removeBookmark(mark.id)}
                    aria-label="Удалить закладку"
                  >
                    <BookmarkX className="h-4 w-4" />
                  </Button>
                </li>
              ))}
          </ul>
        )}
      </ScrollArea>
    </div>
  )
}
