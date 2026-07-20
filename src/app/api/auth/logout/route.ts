import { NextResponse } from 'next/server'
import { getSessionCookieName, verifySession, revokeSession } from '@/lib/auth'
import { cookies } from 'next/headers'

export async function POST() {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get(getSessionCookieName())?.value

    if (token) {
      const payload = await verifySession(token)
      if (payload?.sessionId) {
        await revokeSession(payload.sessionId)
      }
    }

    cookieStore.delete(getSessionCookieName())
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('Logout error', e)
    return NextResponse.json(
      { error: 'Внутренняя ошибка сервера' },
      { status: 500 },
    )
  }
}
