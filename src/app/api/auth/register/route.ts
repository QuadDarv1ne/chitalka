export const runtime = 'nodejs'
import { logger } from '@/lib/logger'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { hashPassword, createSession, getSessionCookieName, getSessionDuration, getClientIp, getUserAgent, generateResetToken, isCookieSecure } from '@/lib/auth'
import { applyRateLimit } from '@/lib/rate-limit'
import { sendEmail } from '@/lib/email'
import { getAppBaseUrl } from '@/lib/url'
import { readJsonBody } from '@/lib/http'
import { cookies } from 'next/headers'
import { Prisma } from '@prisma/client'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const VERIFY_DURATION_MS = 60 * 60 * 24 * 7 // 7 days

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export async function POST(req: Request) {
  try {
    // Rate limit: 5 registrations per hour per IP
    const rl = applyRateLimit(req, 'register')
    if (!rl.ok) {
      return NextResponse.json(
        {
          error: `Слишком много регистраций. Попробуйте через ${Math.ceil(rl.retryAfter / 60000)} мин`,
        },
        {
          status: 429,
          headers: { 'Retry-After': String(Math.ceil(rl.retryAfter / 1000)) },
        },
      )
    }

    const body = await readJsonBody<{ email?: unknown; password?: unknown; name?: unknown; rememberMe?: unknown }>(req)
    const { email, password, name, rememberMe } = body ?? {}
    if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
      return NextResponse.json(
        { error: 'Email и пароль обязательны' },
        { status: 400 },
      )
    }

    const remember = rememberMe === true

    const normalizedEmail = email.toLowerCase().trim()
    if (!EMAIL_RE.test(normalizedEmail)) {
      return NextResponse.json(
        { error: 'Некорректный email' },
        { status: 400 },
      )
    }

    if (password.length < 8) {
      return NextResponse.json(
        { error: 'Пароль должен быть не менее 8 символов' },
        { status: 400 },
      )
    }

    const existing = await db.user.findUnique({
      where: { email: normalizedEmail },
    })
    if (existing) {
      return NextResponse.json(
        { error: 'Не удалось создать аккаунт. Попробуйте другой email или войдите, если аккаунт уже существует.' },
        { status: 409 },
      )
    }

    const passwordHash = await hashPassword(password)
    const displayName = typeof name === 'string' ? name.trim().slice(0, 100) : ''
    let user
    try {
      user = await db.user.create({
        data: {
          email: normalizedEmail,
          name: displayName || null,
          passwordHash,
        },
      })
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        // Concurrent registration race — same email created between check and create
        return NextResponse.json(
          { error: 'Не удалось создать аккаунт. Попробуйте другой email или войдите, если аккаунт уже существует.' },
          { status: 409 },
        )
      }
      throw e
    }

    // Generate email verification token
    const verifyToken = generateResetToken()
    const verifyExpiresAt = new Date(Date.now() + VERIFY_DURATION_MS)
    await db.emailVerification.create({
      data: { userId: user.id, token: verifyToken, expiresAt: verifyExpiresAt },
    })

    // A failed welcome email must not break registration — the account exists
    // and the user can resend the verification link later.
    let previewUrl: string | undefined
    try {
      const verifyLink = `${getAppBaseUrl(req)}/?verify=${verifyToken}`
      const escapedName = escapeHtml(displayName)
      const html = `
      <div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
        <h2 style="color: #1c1c1c;">Добро пожаловать в Читалку!</h2>
        <p style="color: #555; line-height: 1.6;">
          Здравствуйте${escapedName ? `, ${escapedName}` : ''}!
        </p>
        <p style="color: #555; line-height: 1.6;">
          Ваш аккаунт создан. Пожалуйста, подтвердите ваш email:
        </p>
        <p style="margin: 32px 0;">
          <a href="${verifyLink}"
             style="background: #18181b; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: 500;">
            Подтвердить email
          </a>
        </p>
        <p style="color: #888; font-size: 13px;">
          Ссылка действительна 7 дней. Если вы не регистрировались — проигнорируйте это письмо.
        </p>
      </div>
    `
      const text = `Здравствуйте${displayName ? `, ${displayName}` : ''}!

Ваш аккаунт в Читалке создан. Подтвердите email:
${verifyLink}

Ссылка действительна 7 дней.`
      const sent = await sendEmail({
        to: normalizedEmail,
        subject: 'Добро пожаловать! Подтвердите email — Читалка',
        html,
        text,
      })
      previewUrl = sent.previewUrl
    } catch (e) {
      // A missing NEXT_PUBLIC_APP_URL or failing SMTP delivery must not break
      // registration — the account exists and the link can be resent later.
      logger.warn('Failed to send welcome email', e)
    }

    const { token } = await createSession(
      { userId: user.id, email: user.email, name: user.name },
      {
        rememberMe: remember,
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
      maxAge: getSessionDuration(remember),
    })

    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        emailVerified: null,
      },
      ...(process.env.NODE_ENV !== 'production'
        ? { _devVerifyLink: previewUrl ?? '' }
        : {}),
    })
  } catch (e) {
    logger.error('Register error', e)
    return NextResponse.json(
      { error: 'Внутренняя ошибка сервера' },
      { status: 500 },
    )
  }
}
