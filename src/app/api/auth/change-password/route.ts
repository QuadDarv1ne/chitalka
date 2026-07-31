import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser, getSessionPayload } from '@/lib/session'
import { verifyPassword, hashPassword, revokeAllSessionsExcept } from '@/lib/auth'

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
    const { currentPassword, newPassword } = body ?? {}

    if (!currentPassword || !newPassword) {
      return NextResponse.json(
        { error: 'Текущий и новый пароль обязательны' },
        { status: 400 },
      )
    }

    if (newPassword.length < 8) {
      return NextResponse.json(
        { error: 'Новый пароль должен быть не менее 8 символов' },
        { status: 400 },
      )
    }

    const userWithPassword = await db.user.findUnique({
      where: { id: user.id },
      select: { passwordHash: true },
    })
    if (!userWithPassword) {
      return NextResponse.json(
        { error: 'Пользователь не найден' },
        { status: 404 },
      )
    }

    const ok = await verifyPassword(currentPassword, userWithPassword.passwordHash)
    if (!ok) {
      return NextResponse.json(
        { error: 'Неверный текущий пароль' },
        { status: 401 },
      )
    }

    const newHash = await hashPassword(newPassword)
    await db.user.update({
      where: { id: user.id },
      data: { passwordHash: newHash },
    })

    // Revoke all other sessions — the password may have been compromised
    const currentSession = await getSessionPayload()
    if (currentSession?.sessionId) {
      await revokeAllSessionsExcept(user.id, currentSession.sessionId)
    }

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('Change password error', e)
    return NextResponse.json(
      { error: 'Внутренняя ошибка сервера' },
      { status: 500 },
    )
  }
}
