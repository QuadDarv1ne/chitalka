import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser } from '@/lib/session'
import { verifyPassword } from '@/lib/auth'
import { applyRateLimit } from '@/lib/rate-limit'
import { readJsonBody } from '@/lib/http'
import { cookies } from 'next/headers'
import { getSessionCookieName } from '@/lib/auth'

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

    const body = await readJsonBody<{ password?: unknown }>(req)
    const { password } = body ?? {}

    if (typeof password !== 'string' || !password) {
      return NextResponse.json(
        { error: 'Пароль обязателен для подтверждения' },
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

    const ok = await verifyPassword(password, userWithPassword.passwordHash)
    if (!ok) {
      return NextResponse.json(
        { error: 'Неверный пароль' },
        { status: 401 },
      )
    }

    // Cascade delete: PasswordReset, EmailVerification, Session, BookMeta
    await db.user.delete({ where: { id: user.id } })

    const cookieStore = await cookies()
    cookieStore.delete(getSessionCookieName())

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('Delete account error', e)
    return NextResponse.json(
      { error: 'Внутренняя ошибка сервера' },
      { status: 500 },
    )
  }
}
