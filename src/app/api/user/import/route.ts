import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser } from '@/lib/session'

export async function POST(req: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })
    }

    const body = await req.json().catch(() => ({}))
    const { backup } = body ?? {}

    if (!backup || !backup.version) {
      return NextResponse.json(
        { error: 'Некорректный файл резервной копии' },
        { status: 400 },
      )
    }

    let imported = 0
    if (Array.isArray(backup.books)) {
      for (const book of backup.books) {
        if (!book.bookId) continue
        await db.bookMeta.upsert({
          where: { userId_bookId: { userId: user.id, bookId: book.bookId } },
          update: {
            title: book.title ?? '',
            author: book.author ?? '',
            format: book.format ?? 'txt',
            progress: book.progress ?? 0,
            lastOpenedAt: book.lastOpenedAt ? new Date(book.lastOpenedAt) : null,
          },
          create: {
            userId: user.id,
            bookId: book.bookId,
            title: book.title ?? '',
            author: book.author ?? '',
            format: book.format ?? 'txt',
            progress: book.progress ?? 0,
            lastOpenedAt: book.lastOpenedAt ? new Date(book.lastOpenedAt) : null,
          },
        })
        imported++
      }
    }

    // Restore settings if provided
    if (backup.settings) {
      await db.userSettings.upsert({
        where: { userId: user.id },
        update: {
          theme: backup.settings.theme ?? undefined,
          fontFamily: backup.settings.fontFamily ?? undefined,
          fontSize: backup.settings.fontSize ?? undefined,
          lineHeight: backup.settings.lineHeight ?? undefined,
          margin: backup.settings.margin ?? undefined,
          textAlign: backup.settings.textAlign ?? undefined,
        },
        create: {
          userId: user.id,
          theme: backup.settings.theme ?? 'light',
          fontFamily: backup.settings.fontFamily ?? 'serif',
          fontSize: backup.settings.fontSize ?? 18,
          lineHeight: backup.settings.lineHeight ?? 1.7,
          margin: backup.settings.margin ?? 3,
          textAlign: backup.settings.textAlign ?? 'justify',
        },
      })
    }

    return NextResponse.json({ ok: true, imported })
  } catch (e) {
    console.error('Import error', e)
    return NextResponse.json(
      { error: 'Внутренняя ошибка сервера' },
      { status: 500 },
    )
  }
}
