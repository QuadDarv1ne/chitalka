import { NextResponse } from 'next/server'
import { getCurrentUser, getSessionPayload } from '@/lib/session'
import { getUserSessions, revokeSession, revokeAllSessionsExcept } from '@/lib/auth'

export async function GET() {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json(
        { error: 'Не авторизован' },
        { status: 401 },
      )
    }

    const sessions = await getUserSessions(user.id)
    const currentSession = await getSessionPayload()

    return NextResponse.json({
      sessions: sessions.map((s) => ({
        id: s.id,
        createdAt: s.createdAt,
        expiresAt: s.expiresAt,
        userAgent: s.userAgent,
        ip: s.ip,
        isCurrent: s.id === currentSession?.sessionId,
      })),
    })
  } catch (e) {
    console.error('Get sessions error', e)
    return NextResponse.json(
      { error: 'Внутренняя ошибка сервера' },
      { status: 500 },
    )
  }
}

export async function DELETE(req: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json(
        { error: 'Не авторизован' },
        { status: 401 },
      )
    }

    const url = new URL(req.url)
    const sessionId = url.searchParams.get('id')
    const action = url.searchParams.get('action')

    if (action === 'revoke-others') {
      const currentSession = await getSessionPayload()
      if (!currentSession?.sessionId) {
        return NextResponse.json(
          { error: 'Сессия не найдена' },
          { status: 400 },
        )
      }
      await revokeAllSessionsExcept(user.id, currentSession.sessionId)
      return NextResponse.json({ ok: true })
    }

    if (!sessionId) {
      return NextResponse.json(
        { error: 'ID сессии обязателен' },
        { status: 400 },
      )
    }

    const currentSession = await getSessionPayload()
    if (sessionId === currentSession?.sessionId) {
      return NextResponse.json(
        { error: 'Нельзя завершить текущую сессию этим способом' },
        { status: 400 },
      )
    }

    const count = await revokeSession(user.id, sessionId)
    if (count === 0) {
      return NextResponse.json(
        { error: 'Сессия не найдена' },
        { status: 404 },
      )
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('Delete session error', e)
    return NextResponse.json(
      { error: 'Внутренняя ошибка сервера' },
      { status: 500 },
    )
  }
}
