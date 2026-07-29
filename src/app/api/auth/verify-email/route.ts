import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { createSession, getSessionCookieName, getSessionDuration } from '@/lib/auth'
import { applyRateLimit, cleanupRateLimits } from '@/lib/rate-limit'
import { cookies } from 'next/headers'

export async function POST(req: Request) {
  try {
    const rateLimit = applyRateLimit(req, 'verifyEmail')
    if (!rateLimit.ok) {
      return NextResponse.json(
        { error: 'Слишком много попыток. Попробуйте позже.' },
        { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfter) } },
      )
    }
    cleanupRateLimits()

    const body = await req.json().catch(() => ({}))
    const { token } = body ?? {}

    if (!token) {
      return NextResponse.json(
        { error: 'Token обязателен' },
        { status: 400 },
      )
    }

    const verification = await db.emailVerification.findUnique({
      where: { token },
      include: { user: true },
    })

    if (!verification || verification.usedAt || verification.expiresAt < new Date()) {
      return NextResponse.json(
        { error: 'Ссылка недействительна или устарела' },
        { status: 400 },
      )
    }

    const [updatedUser] = await Promise.all([
      db.user.update({
        where: { id: verification.userId },
        data: { emailVerified: new Date() },
      }),
      db.emailVerification.update({
        where: { id: verification.id },
        data: { usedAt: new Date() },
      }),
    ])

    // Auto-login user after verification
    const { token: sessionToken } = await createSession({
      userId: updatedUser.id,
      email: updatedUser.email,
      name: updatedUser.name,
    })

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
        emailVerified: updatedUser.emailVerified,
      },
    })
  } catch (e) {
    console.error('Verify email error', e)
    return NextResponse.json(
      { error: 'Внутренняя ошибка сервера' },
      { status: 500 },
    )
  }
}
