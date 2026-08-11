export const runtime = 'nodejs'
import { logger } from '@/lib/logger'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser } from '@/lib/session'

/**
 * GET /api/user/export — exports all user data as JSON
 * Includes: profile (without password), settings, books metadata, bookmarks, highlights, sessions
 * Does NOT include book files (blobs) — they are too large; use IndexedDB backup for that.
 */
export async function GET() {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })
    }

    const [settings, bookMetas, sessions] = await Promise.all([
      db.userSettings.findUnique({ where: { userId: user.id } }),
      db.bookMeta.findMany({ where: { userId: user.id } }),
      db.session.findMany({
        where: { userId: user.id },
        select: {
          id: true,
          createdAt: true,
          expiresAt: true,
          userAgent: true,
          ip: true,
        },
      }),
    ])

    const exportData = {
      version: 1,
      exportedAt: new Date().toISOString(),
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        emailVerified: user.emailVerified,
        createdAt: undefined, // don't expose internal timestamps
      },
      settings: settings || null,
      books: bookMetas.map((b) => ({
        bookId: b.bookId,
        title: b.title,
        author: b.author,
        format: b.format,
        progress: b.progress,
        lastOpenedAt: b.lastOpenedAt,
      })),
      sessions: sessions.map((s) => ({
        createdAt: s.createdAt,
        expiresAt: s.expiresAt,
        userAgent: s.userAgent,
        ip: s.ip,
      })),
      note: 'Book files (blobs) are not included in this export. Use the JSON backup in Library to download book files.',
    }

    const json = JSON.stringify(exportData, null, 2)

    return new NextResponse(json, {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="reader-account-${user.email.replace(/[@.]/g, '_')}-${new Date().toISOString().slice(0, 10)}.json"`,
      },
    })
  } catch (e) {
    logger.error('Export error', e)
    return NextResponse.json(
      { error: 'Внутренняя ошибка сервера' },
      { status: 500 },
    )
  }
}
