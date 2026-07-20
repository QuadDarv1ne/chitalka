'use client'

import type { Highlight, BookRecord } from '@/lib/library'
import { highlightColors } from '@/store/reader-store'

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
    const color = highlightColors[h.color]
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
  a.download = `${book.title.replace(/[^\wа-яА-ЯёЁ\s-]/g, '')} — выделения.md`
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
  settings: any,
  bookmarks: any[],
  highlights: any[],
  sessions: any[],
): Promise<void> {
  const books = await getAllBooks()
  // Strip blob (too large) - keep metadata only
  const booksMeta = books.map((b) => ({
    id: b.id,
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
    version: 1,
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
