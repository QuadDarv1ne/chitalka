export const runtime = 'nodejs'
import { logger } from '@/lib/logger'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { createSession, getSessionCookieName, getSessionDuration, isCookieSecure } from '@/lib/auth'
import { applyRateLimit, cleanupRateLimits } from '@/lib/rate-limit'
import { readJsonBody } from '@/lib/http'
import { cookies } from 'next/headers'

export async function POST(req: Request) {
  try {
    const rateLimit = applyRateLimit(req, 'verifyEmail')
    if (!rateLimit.ok) {
      return NextResponse.json(
        { error: 'Слишком много попыток. Попробуйте позже.' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(rateLimit.retryAfter / 1000)) } },
      )
    }
    cleanupRateLimits()

    const body = await readJsonBody<{ token?: unknown }>(req)
    const { token } = body ?? {}

    if (typeof token !== 'string' || !token) {
      return NextResponse.json(
        { error: 'Token обязателен' },
        { status: 400 },
      )
    }

    // Atomically claim the token — a concurrent request with the same token
    // will see count === 0 and fail instead of using the token twice.
    const claimed = await db.emailVerification.updateMany({
      where: { token, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    })
    if (claimed.count !== 1) {
      return NextResponse.json(
        { error: 'Ссылка недействительна или устарела' },
        { status: 400 },
      )
    }

    const verification = await db.emailVerification.findUnique({
      where: { token },
      include: { user: true },
    })
    if (!verification || !verification.user) {
      return NextResponse.json(
        { error: 'Ссылка недействительна или устарела' },
        { status: 400 },
      )
    }

    const updatedUser = await db.user.update({
      where: { id: verification.userId },
      data: { emailVerified: new Date() },
    })

    // Auto-login user after verification
    const { token: sessionToken } = await createSession({
      userId: updatedUser.id,
      email: updatedUser.email,
      name: updatedUser.name,
    })

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
        emailVerified: updatedUser.emailVerified,
      },
    })
  } catch (e) {
    logger.error('Verify email error', e)
    return NextResponse.json(
      { error: 'Внутренняя ошибка сервера' },
      { status: 500 },
    )
  }
}
