'use client'

import { useReaderStore, highlightColors, type HighlightColor } from '@/store/reader-store'
import type { BookRecord } from '@/lib/library'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { Highlighter, Trash2, FileText, Download } from 'lucide-react'
import { useState } from 'react'
import { exportHighlightsToMarkdown } from '@/lib/export-utils'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'

interface Props {
  book: BookRecord
  onNavigate: () => void
}

export function HighlightsPanel({ book, onNavigate }: Props) {
  const highlights = useReaderStore((s) => s.highlights)
  const removeHighlight = useReaderStore((s) => s.removeHighlight)
  const updateHighlight = useReaderStore((s) => s.updateHighlight)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [noteText, setNoteText] = useState('')

  const bookHighlights = highlights.filter((h) => h.bookId === book.id)

  const handleClick = (h: (typeof bookHighlights)[number]) => {
    if (book.format === 'epub' && h.cfi) {
      window.dispatchEvent(new CustomEvent('epub-goto-cfi', { detail: h.cfi }))
    } else if (book.format === 'pdf' && h.pdfPage) {
      window.dispatchEvent(
        new CustomEvent('pdf-goto-page', { detail: h.pdfPage }),
      )
    } else if (book.format === 'cbz' && h.cbzPage !== undefined) {
      window.dispatchEvent(
        new CustomEvent('cbz-goto-page', { detail: h.cbzPage }),
      )
    } else if (h.textPosition !== undefined) {
      window.dispatchEvent(
        new CustomEvent('txt-goto-position', { detail: h.textPosition }),
      )
    }
    onNavigate()
  }

  const openNoteEditor = (h: (typeof bookHighlights)[number]) => {
    setEditingId(h.id)
    setNoteText(h.note ?? '')
  }

  const saveNote = () => {
    if (editingId) {
      updateHighlight(editingId, { note: noteText })
    }
    setEditingId(null)
    setNoteText('')
  }

  return (
    <div className="flex flex-col gap-3 p-2">
      <div className="flex items-center justify-between gap-2 px-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Highlighter className="h-3.5 w-3.5" />
          Выделения и заметки
        </div>
        {bookHighlights.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs gap-1"
            onClick={() => {
              exportHighlightsToMarkdown(book, bookHighlights)
              toast.success('Выделения экспортированы в Markdown')
            }}
          >
            <Download className="h-3 w-3" />
            Экспорт
          </Button>
        )}
      </div>

      <ScrollArea className="h-[calc(100vh-12rem)]">
        {bookHighlights.length === 0 ? (
          <div className="flex flex-col items-center gap-2 p-8 text-center">
            <Highlighter className="h-10 w-10 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              Выделений пока нет
            </p>
            <p className="text-xs text-muted-foreground/70">
              В TXT/MD выделите текст мышкой, чтобы сохранить цитату
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {bookHighlights
              .slice()
              .sort((a, b) => b.createdAt - a.createdAt)
              .map((h) => {
                const color = highlightColors[h.color] ?? highlightColors.yellow
                return (
                  <li
                    key={h.id}
                    className="group rounded-md border p-2 hover:bg-accent transition-colors"
                  >
                    <button
                      onClick={() => handleClick(h)}
                      className="w-full text-left"
                    >
                      <div
                        className="rounded px-2 py-1 text-sm mb-1.5"
                        style={{
                          background: color.bg,
                          color: color.fg,
                        }}
                      >
                        <p className="line-clamp-3 italic">{h.text}</p>
                      </div>
                      {h.note && (
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2 pl-2 border-l-2">
                          {h.note}
                        </p>
                      )}
                      {h.pdfPage !== undefined && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Страница {h.pdfPage}
                        </p>
                      )}
                      {h.cbzPage !== undefined && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Страница {h.cbzPage + 1}
                        </p>
                      )}
                      {h.textPosition !== undefined && (
                        <FileText className="h-3 w-3" />
                        {new Date(h.createdAt).toLocaleString('ru-RU', {
                          day: 'numeric',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </div>
                    </button>
                    <div className="flex gap-1 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => openNoteEditor(h)}
                      >
                        Заметка
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        onClick={() => removeHighlight(h.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </li>
                )
              })}
          </ul>
        )}
      </ScrollArea>

      <Dialog open={editingId !== null} onOpenChange={(o) => !o && setEditingId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Заметка к выделению</DialogTitle>
          </DialogHeader>
          <Textarea
            autoFocus
            placeholder="Напишите заметку..."
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            rows={5}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingId(null)}>
              Отмена
            </Button>
            <Button onClick={saveNote}>Сохранить</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// Color picker for selection toolbar
export function ColorPicker({ onPick }: { onPick: (c: HighlightColor) => void }) {
  return (
    <div className="flex items-center gap-1.5 p-1.5 bg-background rounded-md shadow-lg border">
      {(Object.keys(highlightColors) as HighlightColor[]).map((c) => (
        <button
          key={c}
          onClick={() => onPick(c)}
          className="h-6 w-6 rounded-full border-2 hover:scale-110 transition-transform"
          style={{ background: highlightColors[c].bg }}
          title={highlightColors[c].label}
          aria-label={highlightColors[c].label}
        />
      ))}
    </div>
  )
}
