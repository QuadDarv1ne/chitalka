'use client'

import { useState, useMemo, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Trash2, Plus, Edit3, Save, X, Download } from 'lucide-react'
import { useReaderStore } from '@/store/reader-store'
import { toast } from 'sonner'
import type { BookRecord } from '@/lib/library'
import { exportNotesToMarkdown } from '@/lib/export-utils'

interface Props {
  book: BookRecord
}

export function NotesPanel({ book }: Props) {
  const notes = useReaderStore((s) => s.notes)
  const addNote = useReaderStore((s) => s.addNote)
  const updateNote = useReaderStore((s) => s.updateNote)
  const removeNote = useReaderStore((s) => s.removeNote)

  const bookNotes = useMemo(
    () => notes.filter((n) => n.bookId === book.id).sort((a, b) => b.createdAt - a.createdAt),
    [notes, book.id],
  )

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')

  const bookRef = useMemo(() => book, [book])

  const addNewNote = useCallback(() => {
    if (!editText.trim()) return
    addNote({
      bookId: bookRef.id,
      text: editText.trim(),
    })
    setEditText('')
    toast.success('Заметка добавлена')
  }, [editText, addNote, bookRef])

  const saveEdit = useCallback(() => {
    if (!editingId || !editText.trim()) return
    updateNote(editingId, { text: editText.trim() })
    setEditingId(null)
    setEditText('')
    toast.success('Заметка обновлена')
  }, [editingId, editText, updateNote])

  const deleteNote = useCallback(
    (id: string) => {
      removeNote(id)
      toast.success('Заметка удалена')
    },
    [removeNote],
  )

  const handleExport = useCallback(() => {
    if (bookNotes.length === 0) return
    exportNotesToMarkdown(book, bookNotes)
    toast.success('Заметки экспортированы в Markdown')
  }, [book, bookNotes])

  return (
    <div className="flex flex-col h-full">
      {/* Add note form */}
      <div className="space-y-2 p-3 border-b">
        <div className="flex items-start gap-2">
          <Textarea
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            placeholder="Добавить заметку..."
            className="min-h-[80px] text-sm resize-none flex-1"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                addNewNote()
              }
            }}
          />
          <Button
            size="icon"
            variant="ghost"
            onClick={handleExport}
            disabled={bookNotes.length === 0}
            className="flex-shrink-0"
            aria-label="Экспортировать заметки в Markdown"
            title="Экспортировать в Markdown"
          >
            <Download className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex gap-2">
          {editingId ? (
            <>
              <Button size="sm" onClick={saveEdit} className="gap-1.5">
                <Save className="h-3.5 w-3.5" /> Сохранить
              </Button>
              <Button size="sm" variant="outline" onClick={() => { setEditingId(null); setEditText('') }}>
                <X className="h-3.5 w-3.5" /> Отмена
              </Button>
            </>
          ) : (
            <Button size="sm" onClick={addNewNote} disabled={!editText.trim()} className="gap-1.5">
              <Plus className="h-3.5 w-3.5" /> Добавить
            </Button>
          )}
        </div>
      </div>

      {/* Notes list */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {bookNotes.length === 0 ? (
          <div className="text-center py-8 text-sm text-muted-foreground">
            <p>Заметок пока нет</p>
            <p className="text-xs mt-1">Напишите свою первую заметку к этой книге</p>
          </div>
        ) : (
          bookNotes.map((note) => (
            <div
              key={note.id}
              className="rounded-lg border p-3 space-y-2 group"
            >
              {editingId === note.id ? (
                <Textarea
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  className="text-sm min-h-[60px] resize-none"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      saveEdit()
                    }
                  }}
                />
              ) : (
                <p className="text-sm whitespace-pre-wrap">{note.text}</p>
              )}
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  {new Date(note.createdAt).toLocaleDateString('ru-RU', {
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6"
                    onClick={() => {
                      setEditingId(note.id)
                      setEditText(note.text)
                    }}
                    aria-label="Редактировать"
                  >
                    <Edit3 className="h-3 w-3" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6 text-destructive hover:text-destructive"
                    onClick={() => deleteNote(note.id)}
                    aria-label="Удалить"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
