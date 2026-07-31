import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { hashPassword, createSession, getSessionCookieName, getSessionDuration, getClientIp, getUserAgent, isCookieSecure } from '@/lib/auth'
import { applyRateLimit, cleanupRateLimits } from '@/lib/rate-limit'
import { readJsonBody } from '@/lib/http'
import { cookies } from 'next/headers'

export async function POST(req: Request) {
  try {
    const rateLimit = applyRateLimit(req, 'resetPassword')
    if (!rateLimit.ok) {
      return NextResponse.json(
        { error: 'Слишком много попыток. Попробуйте позже.' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(rateLimit.retryAfter / 1000)) } },
      )
    }
    cleanupRateLimits()

    const body = await readJsonBody<{ token?: unknown; password?: unknown }>(req)
    const { token, password } = body ?? {}

    if (typeof token !== 'string' || typeof password !== 'string' || !token || !password) {
      return NextResponse.json(
        { error: 'Token и пароль обязательны' },
        { status: 400 },
      )
    }

    if (password.length < 8) {
      return NextResponse.json(
        { error: 'Пароль должен быть не менее 8 символов' },
        { status: 400 },
      )
    }

    // Atomically claim the token — a concurrent request with the same token
    // will see count === 0 and fail instead of using the token twice.
    const claimed = await db.passwordReset.updateMany({
      where: { token, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    })
    if (claimed.count !== 1) {
      return NextResponse.json(
        { error: 'Ссылка недействительна или устарела' },
        { status: 400 },
      )
    }

    const reset = await db.passwordReset.findUnique({
      where: { token },
      include: { user: true },
    })
    if (!reset || !reset.user) {
      return NextResponse.json(
        { error: 'Ссылка недействительна или устарела' },
        { status: 400 },
      )
    }

    const passwordHash = await hashPassword(password)
    const updatedUser = await db.user.update({
      where: { id: reset.userId },
      data: { passwordHash },
    })

    // Revoke all previous sessions — the account may have been compromised.
    // A fresh session is created below.
    await db.session.deleteMany({ where: { userId: updatedUser.id } })

    // Auto-login the user after reset
    const { token: sessionToken } = await createSession(
      {
        userId: updatedUser.id,
        email: updatedUser.email,
        name: updatedUser.name,
      },
      { userAgent: getUserAgent(req), ip: getClientIp(req) },
    )

    const cookieStore = await cookies()
    cookieStore.set(getSessionCookieName(), sessionToken, {
      httpOnly: true,
      secure: isCookieSecure(),
      sameSite: 'lax',
      path: '/',
      maxAge: getSessionDuration(),
    })

    return NextResponse.json({
      user: {
        id: updatedUser.id,
        email: updatedUser.email,
        name: updatedUser.name,
      },
    })
  } catch (e) {
    console.error('Reset password error', e)
    return NextResponse.json(
      { error: 'Внутренняя ошибка сервера' },
      { status: 500 },
    )
  }
}
