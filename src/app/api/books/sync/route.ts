export const runtime = 'nodejs'
import { logger } from '@/lib/logger'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser } from '@/lib/session'
import { applyRateLimit } from '@/lib/rate-limit'
import { readJsonBody, toDate } from '@/lib/http'

/**
 * POST /api/books/sync — sync local book metadata to server
 * Body: { books: SyncBook[] } — массив метаданных книг
 * Сохраняет только метаданные (НЕ blob), используется для синхронизации прогресса между устройствами
 */
export async function POST(req: Request) {
  try {
    const rl = applyRateLimit(req, 'booksSync')
    if (!rl.ok) {
      return NextResponse.json(
        { error: 'Слишком много запросов. Попробуйте позже.' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfter / 1000)) } },
      )
    }

    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json(
        { error: 'Не авторизован' },
        { status: 401 },
      )
    }

    const body = await readJsonBody<{ books?: unknown }>(req, 2 * 1024 * 1024)
    const { books } = body ?? {}

    if (!Array.isArray(books) || books.length > 5000) {
      return NextResponse.json(
        { error: 'books должен быть массивом (макс. 5000)' },
        { status: 400 },
      )
    }

    let synced = 0

    const tasks = []
    for (const book of books) {
      if (!book || typeof book !== 'object') continue
      const raw = book as Record<string, unknown>
      if (typeof raw.bookId !== 'string' || typeof raw.title !== 'string') continue

      const bookId = raw.bookId.slice(0, 200)
      if (!bookId) continue
      const lastOpenedAt = toDate(raw.lastOpenedAt)
      if (lastOpenedAt === null && raw.lastOpenedAt !== null && raw.lastOpenedAt !== undefined) continue

      const data = {
        userId: user.id,
        bookId,
        title: raw.title.slice(0, 500),
        author: typeof raw.author === 'string' ? raw.author.slice(0, 300) : '',
        format: typeof raw.format === 'string' ? raw.format.slice(0, 20) : 'unknown',
        progress: Math.max(0, Math.min(1, Number(raw.progress) || 0)),
        lastOpenedAt,
        cfi: typeof raw.cfi === 'string' ? raw.cfi.slice(0, 2000) : undefined,
        textPosition: typeof raw.textPosition === 'number' ? raw.textPosition : undefined,
        pdfPage: typeof raw.pdfPage === 'number' ? raw.pdfPage : undefined,
        cbzPage: typeof raw.cbzPage === 'number' ? raw.cbzPage : undefined,
        audioTrack: typeof raw.audioTrack === 'number' ? raw.audioTrack : undefined,
        audioTime: typeof raw.audioTime === 'number' ? raw.audioTime : undefined,
      }

      // upsert is race-safe (concurrent syncs from two devices cannot
      // both fail on a unique-constraint violation) and replaces the N+1.
      tasks.push(
        db.bookMeta
          .upsert({
            where: { userId_bookId: { userId: user.id, bookId } },
            update: data,
            create: data,
          })
          .then(() => 1)
          .catch(() => 0),
      )
    }

    // Run in bounded batches — SQLite is single-writer, avoid 5000 queued writes
    const BATCH = 50
    for (let i = 0; i < tasks.length; i += BATCH) {
      const results = await Promise.all(tasks.slice(i, i + BATCH))
      synced += results.reduce((sum: number, r: number) => sum + r, 0)
    }

    return NextResponse.json({ ok: true, synced })
  } catch (e) {
    logger.error('Sync books error', e)
    return NextResponse.json(
      { error: 'Внутренняя ошибка сервера' },
      { status: 500 },
    )
  }
}

/**
 * GET /api/books/sync — fetch server-side book metadata
 * Возвращает все метаданные книг пользователя с сервера
 */
export async function GET() {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json(
        { error: 'Не авторизован' },
        { status: 401 },
      )
    }

    const books = await db.bookMeta.findMany({
      where: { userId: user.id },
      orderBy: { lastOpenedAt: 'desc' },
    })

    return NextResponse.json({
      books: books.map((b) => ({
        bookId: b.bookId,
        title: b.title,
        author: b.author,
        format: b.format,
        progress: b.progress,
        lastOpenedAt: b.lastOpenedAt,
        cfi: b.cfi,
        textPosition: b.textPosition,
        pdfPage: b.pdfPage,
        cbzPage: b.cbzPage,
        audioTrack: b.audioTrack,
        audioTime: b.audioTime,
        updatedAt: b.updatedAt,
      })),
    })
  } catch (e) {
    logger.error('Get synced books error', e)
    return NextResponse.json(
      { error: 'Внутренняя ошибка сервера' },
      { status: 500 },
    )
  }
}
