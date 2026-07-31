import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { generateResetToken } from '@/lib/auth'
import { sendEmail } from '@/lib/email'
import { applyRateLimit } from '@/lib/rate-limit'
import { getAppBaseUrl } from '@/lib/url'
import { readJsonBody } from '@/lib/http'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const RESET_DURATION_MS = 60 * 60 * 1000 // 1 hour

export async function POST(req: Request) {
  try {
    // Rate limit: 5 requests per hour
    const rl = applyRateLimit(req, 'forgotPassword')
    if (!rl.ok) {
      return NextResponse.json(
        { error: 'Слишком много запросов. Попробуйте позже' },
        {
          status: 429,
          headers: { 'Retry-After': String(Math.ceil(rl.retryAfter / 1000)) },
        },
      )
    }

    const body = await readJsonBody<{ email?: unknown }>(req)
    const { email } = body ?? {}

    if (typeof email !== 'string' || !EMAIL_RE.test(email)) {
      return NextResponse.json(
        { error: 'Некорректный email' },
        { status: 400 },
      )
    }

    const normalizedEmail = email.toLowerCase().trim()

    // Always return success to prevent email enumeration
    // But only actually send if user exists
    const user = await db.user.findUnique({
      where: { email: normalizedEmail },
    })

    // Equalize response time for existing/non-existing accounts
    const dummyToken = generateResetToken()

    let resetLink: string | undefined

    if (user) {
      // Invalidate any previous tokens
      await db.passwordReset.deleteMany({
        where: { userId: user.id, usedAt: null },
      })

      const token = dummyToken
      const expiresAt = new Date(Date.now() + RESET_DURATION_MS)
      await db.passwordReset.create({
        data: {
          userId: user.id,
          token,
          expiresAt,
        },
      })

      resetLink = `${getAppBaseUrl(req)}/?reset=${token}`

      const html = `
        <div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
          <h2 style="color: #1c1c1c;">Восстановление пароля</h2>
          <p style="color: #555; line-height: 1.6;">
            Здравствуйте${user.name ? `, ${user.name}` : ''}!
          </p>
          <p style="color: #555; line-height: 1.6;">
            Мы получили запрос на сброс пароля для вашего аккаунта в Читалке.
            Нажмите на кнопку ниже, чтобы установить новый пароль:
          </p>
          <p style="margin: 32px 0;">
            <a href="${resetLink}"
               style="background: #18181b; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: 500;">
              Сбросить пароль
            </a>
          </p>
          <p style="color: #888; font-size: 13px; line-height: 1.5;">
            Или скопируйте эту ссылку в браузер:<br>
            <span style="color: #2563eb; word-break: break-all;">${resetLink}</span>
          </p>
          <p style="color: #888; font-size: 13px; line-height: 1.5;">
            Ссылка действительна 1 час. Если вы не запрашивали сброс пароля —
            просто проигнорируйте это письмо.
          </p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;">
          <p style="color: #aaa; font-size: 12px;">
            Читалка — локальная читалка книг
          </p>
        </div>
      `
      const text = `Здравствуйте${user.name ? `, ${user.name}` : ''}!

Мы получили запрос на сброс пароля для вашего аккаунта в Читалке.

Перейдите по ссылке, чтобы установить новый пароль:
${resetLink}

Ссылка действительна 1 час. Если вы не запрашивали сброс пароля — просто проигнорируйте это письмо.`

      await sendEmail({
        to: normalizedEmail,
        subject: 'Восстановление пароля — Читалка',
        html,
        text,
      })
    }

    return NextResponse.json({
      ok: true,
      message: 'Если аккаунт с таким email существует, письмо отправлено',
      // In dev mode, expose the reset link directly so user can see it
      ...(process.env.NODE_ENV !== 'production' && resetLink
        ? { _devResetLink: resetLink }
        : {}),
    })
  } catch (e) {
    console.error('Forgot password error', e)
    return NextResponse.json(
      { error: 'Внутренняя ошибка сервера' },
      { status: 500 },
    )
  }
}
