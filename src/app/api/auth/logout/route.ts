import { logger } from '@/lib/logger'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionCookieName, verifySession, revokeSession } from '@/lib/auth'
import { cookies } from 'next/headers'

export async function POST() {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get(getSessionCookieName())?.value

    if (token) {
      const payload = await verifySession(token)
      if (payload?.sessionId) {
        await revokeSession(payload.userId, payload.sessionId)
      } else if (token) {
        // Session without sessionId in payload — revoke the DB record too
        // so the token can't be reused after logout.
        try {
          const session = await db.session.findFirst({
            where: { userId: payload?.userId },
          })
          if (session) {
            await db.session.delete({ where: { id: session.id } })
          }
        } catch {
          // Non-critical — cookie is already deleted below
        }
      }
    }

    cookieStore.delete(getSessionCookieName())
    return NextResponse.json({ ok: true })
  } catch (e) {
    logger.error('Logout error', e)
    return NextResponse.json(
      { error: 'Внутренняя ошибка сервера' },
      { status: 500 },
    )
  }
}
