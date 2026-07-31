import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { hashPassword, createSession, getSessionCookieName, getSessionDuration, getClientIp, getUserAgent, generateResetToken, isCookieSecure } from '@/lib/auth'
import { applyRateLimit } from '@/lib/rate-limit'
import { sendEmail } from '@/lib/email'
import { getAppBaseUrl } from '@/lib/url'
import { cookies } from 'next/headers'
import { Prisma } from '@prisma/client'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const VERIFY_DURATION_MS = 60 * 60 * 24 * 7 // 7 days

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

    const body = await req.json()
    const { email, password, name, rememberMe } = body ?? {}

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email и пароль обязательны' },
        { status: 400 },
      )
    }

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
    let user
    try {
      user = await db.user.create({
        data: {
          email: normalizedEmail,
          name: typeof name === 'string' && name.trim() ? name.trim() : null,
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

    const verifyLink = `${getAppBaseUrl(req)}/?verify=${verifyToken}`

    const html = `
      <div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
        <h2 style="color: #1c1c1c;">Добро пожаловать в Читалку!</h2>
        <p style="color: #555; line-height: 1.6;">
          Здравствуйте${user.name ? `, ${user.name}` : ''}!
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
    const text = `Здравствуйте${user.name ? `, ${user.name}` : ''}!

Ваш аккаунт в Читалке создан. Подтвердите email:
${verifyLink}

Ссылка действительна 7 дней.`

    const sent = await sendEmail({
      to: normalizedEmail,
      subject: 'Добро пожаловать! Подтвердите email — Читалка',
      html,
      text,
    })

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
      secure: isCookieSecure(),
      sameSite: 'lax',
      path: '/',
      maxAge: getSessionDuration(rememberMe),
    })

    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        emailVerified: null,
      },
      ...(process.env.NODE_ENV !== 'production'
        ? { _devVerifyLink: sent.previewUrl || verifyLink }
        : {}),
    })
  } catch (e) {
    console.error('Register error', e)
    return NextResponse.json(
      { error: 'Внутренняя ошибка сервера' },
      { status: 500 },
    )
  }
}
