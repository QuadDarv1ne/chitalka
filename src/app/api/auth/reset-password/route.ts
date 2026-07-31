import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { hashPassword, createSession, getSessionCookieName, getSessionDuration, getClientIp, getUserAgent } from '@/lib/auth'
import { applyRateLimit, cleanupRateLimits } from '@/lib/rate-limit'
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

    const body = await req.json()
    const { token, password } = body ?? {}

    if (!token || !password) {
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

    const reset = await db.passwordReset.findUnique({
      where: { token },
      include: { user: true },
    })

    if (!reset || reset.usedAt || reset.expiresAt < new Date()) {
      return NextResponse.json(
        { error: 'Ссылка недействительна или устарела' },
        { status: 400 },
      )
    }

    const passwordHash = await hashPassword(password)

    const [updatedUser] = await Promise.all([
      db.user.update({
        where: { id: reset.userId },
        data: { passwordHash },
      }),
      db.passwordReset.update({
        where: { id: reset.id },
        data: { usedAt: new Date() },
      }),
    ])

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
      secure: process.env.NODE_ENV === 'production',
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
