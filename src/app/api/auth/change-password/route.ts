export const runtime = 'nodejs'
import { logger } from '@/lib/logger'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser } from '@/lib/session'
import {
  verifyPassword,
  hashPassword,
  createSession,
  revokeAllSessions,
  getSessionCookieName,
  getSessionDuration,
  getClientIp,
  getUserAgent,
  isCookieSecure,
} from '@/lib/auth'
import { applyRateLimit } from '@/lib/rate-limit'
import { readJsonBody } from '@/lib/http'
import { cookies } from 'next/headers'

export async function POST(req: Request) {
  try {
    // Rate limit: brute-force guard for the password-verifying endpoint
    const rl = applyRateLimit(req, 'login')
    if (!rl.ok) {
      return NextResponse.json(
        {
          error: `Слишком много попыток. Попробуйте через ${Math.ceil(rl.retryAfter / 60000)} мин`,
        },
        {
          status: 429,
          headers: { 'Retry-After': String(Math.ceil(rl.retryAfter / 1000)) },
        },
      )
    }

    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json(
        { error: 'Не авторизован' },
        { status: 401 },
      )
    }

    const body = await readJsonBody<{ currentPassword?: unknown; newPassword?: unknown }>(req)
    const { currentPassword, newPassword } = body ?? {}

    if (typeof currentPassword !== 'string' || typeof newPassword !== 'string' || !currentPassword || !newPassword) {
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

    // Revoke every session (incl. current) and issue a fresh one —
    // the old cookie must not survive a password change.
    await revokeAllSessions(user.id)
    const { token } = await createSession(
      { userId: user.id, email: user.email, name: user.name },
      {
        userAgent: getUserAgent(req),
        ip: getClientIp(req),
      },
    )
    const cookieStore = await cookies()
    cookieStore.set(getSessionCookieName(), token, {
      httpOnly: true,
      secure: isCookieSecure(),
      sameSite: 'lax',
      path: '/',
      maxAge: getSessionDuration(false),
    })

    return NextResponse.json({ ok: true })
  } catch (e) {
    logger.error('Change password error', e)
    return NextResponse.json(
      { error: 'Внутренняя ошибка сервера' },
      { status: 500 },
    )
  }
}
