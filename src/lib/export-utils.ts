'use client'

import type { Highlight, ReaderSettings, Bookmark, ReadingSession } from '@/store/reader-store'
import type { BookRecord } from '@/lib/library'
import { highlightColors } from '@/store/reader-store'

export interface BackupData {
  version: number
  exportedAt: string
  books: Array<{
    bookId: string
    title: string
    author: string
    format: string
    size: number
    addedAt: string
    lastOpenedAt: string | null
    progress: number
    description?: string
  }>
  settings: ReaderSettings
  bookmarks: Bookmark[]
  highlights: Highlight[]
  sessions: ReadingSession[]
}

/**
 * Export book highlights as a Markdown file and trigger download.
 */
export function exportHighlightsToMarkdown(
  book: BookRecord,
  highlights: Highlight[],
): void {
  if (highlights.length === 0) return

  const sorted = [...highlights].sort((a, b) => a.createdAt - b.createdAt)
  const lines: string[] = []
  lines.push(`# Выделения и заметки — ${book.title}`)
  lines.push('')
  lines.push(`**Автор:** ${book.author}`)
  lines.push(`**Формат:** ${book.format.toUpperCase()}`)
  lines.push(`**Всего выделений:** ${sorted.length}`)
  lines.push(`**Экспортировано:** ${new Date().toLocaleString('ru-RU')}`)
  lines.push('')
  lines.push('---')
  lines.push('')

  for (let i = 0; i < sorted.length; i++) {
    const h = sorted[i]
    const color = highlightColors[h.color] ?? highlightColors.yellow
    lines.push(`## ${i + 1}. Выделение (${color.label})`)
    lines.push('')
    lines.push('> ' + h.text.split('\n').join('\n> '))
    lines.push('')
    if (h.note) {
      lines.push(`**Заметка:** ${h.note}`)
      lines.push('')
    }
    lines.push(`*Добавлено: ${new Date(h.createdAt).toLocaleString('ru-RU')}*`)
    lines.push('')
    lines.push('---')
    lines.push('')
  }

  const content = lines.join('\n')
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${book.title.replace(/[^\wа-яА-ЯёЁ\s-]/g, '').trim().replace(/\s+/g, '_')} - vydeleniya.md`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/**
 * Export all library data (without blobs) as JSON.
 */
export async function exportLibraryBackup(
  getAllBooks: () => Promise<BookRecord[]>,
  settings: ReaderSettings,
  bookmarks: Bookmark[],
  highlights: Highlight[],
  sessions: ReadingSession[],
): Promise<void> {
  const books = await getAllBooks()
  // Strip blob (too large) - keep metadata only
  const booksMeta = books.map((b) => ({
    bookId: b.id,
    title: b.title,
    author: b.author,
    format: b.format,
    size: b.size,
    addedAt: b.addedAt,
    lastOpenedAt: b.lastOpenedAt,
    progress: b.progress,
    description: b.description,
  }))
  const backup = {
    version: 2,
    exportedAt: new Date().toISOString(),
    books: booksMeta,
    settings,
    bookmarks,
    highlights,
    sessions,
  }
  const blob = new Blob([JSON.stringify(backup, null, 2)], {
    type: 'application/json',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `reader-backup-${new Date().toISOString().slice(0, 10)}.json`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/**
 * Parse a backup JSON file (from exportLibraryBackup).
 * Returns the parsed data or throws a descriptive error.
 */
export async function parseLibraryBackup(file: File): Promise<BackupData> {
  if (file.size > 20 * 1024 * 1024) {
    throw new Error('Файл резервной копии слишком большой (>20 МБ)')
  }
  let raw: string
  try {
    raw = await file.text()
  } catch {
    throw new Error('Не удалось прочитать файл')
  }
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    throw new Error('Файл не является корректным JSON')
  }
  if (!data || typeof data !== 'object') {
    throw new Error('Некорректная структура резервной копии')
  }
  const backup = data as Record<string, unknown>
  if (typeof backup.version !== 'number' || backup.version < 1 || backup.version > 2) {
    throw new Error('Неподдерживаемая версия резервной копии')
  }
  if (!Array.isArray(backup.books) || backup.books.length > 5000) {
    throw new Error('Некорректные данные книг в резервной копии')
  }
  // Validate required fields
  if (!backup.settings || typeof backup.settings !== 'object') {
    throw new Error('Отсутствуют настройки в резервной копии')
  }
  if (!Array.isArray(backup.bookmarks)) {
    throw new Error('Некорректные данные закладок в резервной копии')
  }
  if (!Array.isArray(backup.highlights)) {
    throw new Error('Некорректные данные выделений в резервной копии')
  }
  if (!Array.isArray(backup.sessions)) {
    throw new Error('Некорректные данные сессий чтения в резервной копии')
  }
  return data as BackupData
}
