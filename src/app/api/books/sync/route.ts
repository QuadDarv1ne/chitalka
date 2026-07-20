import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser } from '@/lib/session'

interface SyncBook {
  bookId: string
  title: string
  author: string
  format: string
  progress: number
  lastOpenedAt?: string | null
}

/**
 * POST /api/books/sync — sync local book metadata to server
 * Body: { books: SyncBook[] } — массив метаданных книг
 * Сохраняет только метаданные (НЕ blob), используется для синхронизации прогресса между устройствами
 */
export async function POST(req: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json(
        { error: 'Не авторизован' },
        { status: 401 },
      )
    }

    const body = await req.json().catch(() => ({}))
    const { books } = body ?? {}

    if (!Array.isArray(books)) {
      return NextResponse.json(
        { error: 'books должен быть массивом' },
        { status: 400 },
      )
    }

    let updated = 0
    let created = 0

    for (const book of books) {
      if (!book.bookId || !book.title) continue

      const data = {
        userId: user.id,
        bookId: String(book.bookId),
        title: String(book.title).slice(0, 500),
        author: String(book.author || '').slice(0, 300),
        format: String(book.format || 'unknown').slice(0, 20),
        progress: Math.max(0, Math.min(1, Number(book.progress) || 0)),
        lastOpenedAt: book.lastOpenedAt ? new Date(book.lastOpenedAt) : null,
      }

      const existing = await db.bookMeta.findUnique({
        where: {
          userId_bookId: { userId: user.id, bookId: data.bookId },
        },
      })

      if (existing) {
        // Only update if local data is newer
        const localDate = data.lastOpenedAt?.getTime() ?? 0
        const serverDate = existing.lastOpenedAt?.getTime() ?? 0
        if (localDate >= serverDate) {
          await db.bookMeta.update({
            where: { id: existing.id },
            data,
          })
          updated++
        }
      } else {
        await db.bookMeta.create({ data })
        created++
      }
    }

    return NextResponse.json({ ok: true, created, updated })
  } catch (e) {
    console.error('Sync books error', e)
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
        updatedAt: b.updatedAt,
      })),
    })
  } catch (e) {
    console.error('Get synced books error', e)
    return NextResponse.json(
      { error: 'Внутренняя ошибка сервера' },
      { status: 500 },
    )
  }
}
