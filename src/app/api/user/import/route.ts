export const runtime = 'nodejs'
import { logger } from '@/lib/logger'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser } from '@/lib/session'
import { readJsonBody, toDate } from '@/lib/http'

const VALID_FORMATS = ['epub', 'fb2', 'pdf', 'txt', 'md', 'html', 'mp3', 'cbz']
const VALID_THEMES = ['light', 'dark', 'sepia', 'contrast']
const VALID_FONTS = ['serif', 'sans', 'mono']
const VALID_ALIGN = ['left', 'justify']
const VALID_SPEEDS = ['slow', 'normal', 'fast', 'very-fast']

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

function clampString(value: unknown, maxLength: number, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, maxLength) : fallback
}

export async function POST(req: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })
    }

    const body = await readJsonBody<{ backup?: unknown }>(req, 20 * 1024 * 1024)
    const backup = (body?.backup ?? null) as Record<string, unknown> | null

    if (!backup || !backup.version) {
      return NextResponse.json(
        { error: 'Некорректный файл резервной копии' },
        { status: 400 },
      )
    }

    if (!Array.isArray(backup.books) || backup.books.length > 5000) {
      return NextResponse.json(
        { error: 'Некорректные данные резервной копии' },
        { status: 400 },
      )
    }

    let imported = 0
    for (const book of backup.books) {
      if (!book || typeof book !== 'object') continue
      const bookId = typeof book.bookId === 'string' ? book.bookId.slice(0, 200) : ''
      if (!bookId) continue

      const format = VALID_FORMATS.includes(book.format) ? book.format : 'txt'
      const progress = clampNumber(book.progress, 0, 1, 0)
      const lastOpenedAt = toDate(book.lastOpenedAt)
      if (book.lastOpenedAt !== null && book.lastOpenedAt !== undefined && !lastOpenedAt) continue

      await db.bookMeta.upsert({
        where: { userId_bookId: { userId: user.id, bookId } },
        update: {
          title: clampString(book.title, 500, ''),
          author: clampString(book.author, 300, ''),
          format,
          progress,
          lastOpenedAt,
          cfi: typeof book.cfi === 'string' ? book.cfi.slice(0, 2000) : undefined,
          textPosition: typeof book.textPosition === 'number' ? book.textPosition : undefined,
          pdfPage: typeof book.pdfPage === 'number' ? book.pdfPage : undefined,
          cbzPage: typeof book.cbzPage === 'number' ? book.cbzPage : undefined,
          audioTrack: typeof book.audioTrack === 'number' ? book.audioTrack : undefined,
          audioTime: typeof book.audioTime === 'number' ? book.audioTime : undefined,
          rating: typeof book.rating === 'number' ? Math.max(1, Math.min(5, book.rating)) : undefined,
          favorite: typeof book.favorite === 'boolean' ? book.favorite : undefined,
        },
        create: {
          userId: user.id,
          bookId,
          title: clampString(book.title, 500, ''),
          author: clampString(book.author, 300, ''),
          format,
          progress,
          lastOpenedAt,
          cfi: typeof book.cfi === 'string' ? book.cfi.slice(0, 2000) : undefined,
          textPosition: typeof book.textPosition === 'number' ? book.textPosition : undefined,
          pdfPage: typeof book.pdfPage === 'number' ? book.pdfPage : undefined,
          cbzPage: typeof book.cbzPage === 'number' ? book.cbzPage : undefined,
          audioTrack: typeof book.audioTrack === 'number' ? book.audioTrack : undefined,
          audioTime: typeof book.audioTime === 'number' ? book.audioTime : undefined,
          rating: typeof book.rating === 'number' ? Math.max(1, Math.min(5, book.rating)) : undefined,
          favorite: typeof book.favorite === 'boolean' ? book.favorite : undefined,
        },
      })
      imported++
    }

    // Restore settings if provided
    if (backup.settings && typeof backup.settings === 'object') {
      const s = backup.settings as Record<string, unknown>
      const settingsData: Record<string, unknown> = {}
      if (typeof s.theme === 'string' && VALID_THEMES.includes(s.theme)) settingsData.theme = s.theme
      if (typeof s.fontFamily === 'string' && VALID_FONTS.includes(s.fontFamily)) settingsData.fontFamily = s.fontFamily
      if (Number.isFinite(Number(s.fontSize))) settingsData.fontSize = clampNumber(s.fontSize, 12, 28, 18)
      if (Number.isFinite(Number(s.lineHeight))) settingsData.lineHeight = clampNumber(s.lineHeight, 1.2, 2.4, 1.7)
      if (Number.isFinite(Number(s.margin))) settingsData.margin = clampNumber(s.margin, 1, 6, 3)
      if (typeof s.textAlign === 'string' && VALID_ALIGN.includes(s.textAlign)) settingsData.textAlign = s.textAlign
      if (typeof s.hyphens === 'boolean') settingsData.hyphens = s.hyphens
      if (typeof s.twoPage === 'boolean') settingsData.twoPage = s.twoPage
      if (Number.isFinite(Number(s.ttsRate))) settingsData.ttsRate = clampNumber(s.ttsRate, 0.5, 2, 1)
      if (s.ttsVoice === null || typeof s.ttsVoice === 'string') settingsData.ttsVoice = s.ttsVoice
      if (Number.isFinite(Number(s.dailyGoalMinutes))) settingsData.dailyGoalMinutes = clampNumber(s.dailyGoalMinutes, 5, 240, 30)
      if (typeof s.readingSpeed === 'string' && VALID_SPEEDS.includes(s.readingSpeed)) settingsData.readingSpeed = s.readingSpeed

      if (Object.keys(settingsData).length > 0) {
        await db.userSettings.upsert({
          where: { userId: user.id },
          update: settingsData,
          create: { userId: user.id, ...settingsData },
        })
      }
    }

    return NextResponse.json({ ok: true, imported })
  } catch (e) {
    logger.error('Import error', e)
    return NextResponse.json(
      { error: 'Внутренняя ошибка сервера' },
      { status: 500 },
    )
  }
}
