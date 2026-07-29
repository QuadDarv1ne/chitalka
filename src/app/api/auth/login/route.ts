import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { verifyPassword, createSession, getSessionCookieName, getSessionDuration, getClientIp, getUserAgent } from '@/lib/auth'
import { applyRateLimit } from '@/lib/rate-limit'
import { cookies } from 'next/headers'

export async function POST(req: Request) {
  try {
    // Rate limit: 10 attempts / 15 min
    const rl = applyRateLimit(req, 'login')
    if (!rl.ok) {
      return NextResponse.json(
        {
          error: `Слишком много попыток входа. Попробуйте через ${Math.ceil(rl.retryAfter / 60000)} мин`,
        },
        {
          status: 429,
          headers: { 'Retry-After': String(Math.ceil(rl.retryAfter / 1000)) },
        },
      )
    }

    const body = await req.json()
    const { email, password, rememberMe } = body ?? {}

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email и пароль обязательны' },
        { status: 400 },
      )
    }

    const normalizedEmail = email.toLowerCase().trim()
    const user = await db.user.findUnique({
      where: { email: normalizedEmail },
    })

    // Constant-time comparison: always verify password, even if user not found,
    // to prevent timing-based email enumeration.
    const passwordHash = user?.passwordHash ?? '$2a$12$0000000000000000000000000000000000000000000000'
    const ok = await verifyPassword(password, passwordHash)
    if (!user || !ok) {
      return NextResponse.json(
        { error: 'Неверный email или пароль' },
        { status: 401 },
      )
    }

    const { token } = await createSession(
      { userId: user.id, email: user.email, name: user.name },
      {
        rememberMe: !!rememberMe,
        userAgent: getUserAgent(req),
        ip: getClientIp(req),
      },
    )

    const cookieStore = await cookies()
    cookieStore.set(getSessionCookieName(), token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: getSessionDuration(rememberMe),
    })

    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        emailVerified: user.emailVerified,
      },
    })
  } catch (e) {
    console.error('Login error', e)
    return NextResponse.json(
      { error: 'Внутренняя ошибка сервера' },
      { status: 500 },
    )
  }
}
