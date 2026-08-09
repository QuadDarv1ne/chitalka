import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { generateResetToken } from '@/lib/auth'
import { sendEmail } from '@/lib/email'
import { applyRateLimit } from '@/lib/rate-limit'
import { getAppBaseUrl } from '@/lib/url'
import { readJsonBody } from '@/lib/http'

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
    // Rate limit: 3 per hour
    const rl = applyRateLimit(req, 'resendVerification')
    if (!rl.ok) {
      return NextResponse.json(
        { error: 'Слишком много запросов. Попробуйте позже' },
        {
          status: 429,
          headers: { 'Retry-After': String(Math.ceil(rl.retryAfter / 1000)) },
        },
      )
    }

    const body = await readJsonBody<{ email?: unknown }>(req, 16 * 1024)
    const { email } = body ?? {}

    if (typeof email !== 'string' || !email) {
      return NextResponse.json(
        { error: 'Email обязателен' },
        { status: 400 },
      )
    }

    const normalizedEmail = email.toLowerCase().trim()
    const user = await db.user.findUnique({
      where: { email: normalizedEmail },
    })

    // Always return ok to prevent enumeration
    if (!user || user.emailVerified) {
      return NextResponse.json({ ok: true })
    }

    // Invalidate previous tokens
    await db.emailVerification.deleteMany({
      where: { userId: user.id, usedAt: null },
    })

    const token = generateResetToken()
    const expiresAt = new Date(Date.now() + VERIFY_DURATION_MS)
    await db.emailVerification.create({
      data: { userId: user.id, token, expiresAt },
    })

    const verifyLink = `${getAppBaseUrl(req)}/?verify=${token}`

    const escapedName = escapeHtml(user.name || '')
    const html = `
      <div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
        <h2 style="color: #1c1c1c;">Подтверждение email</h2>
        <p style="color: #555; line-height: 1.6;">
          Здравствуйте${escapedName ? `, ${escapedName}` : ''}!
        </p>
        <p style="color: #555; line-height: 1.6;">
          Пожалуйста, подтвердите ваш email для аккаунта в Читалке.
          Нажмите на кнопку ниже:
        </p>
        <p style="margin: 32px 0;">
          <a href="${verifyLink}"
             style="background: #18181b; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: 500;">
            Подтвердить email
          </a>
        </p>
        <p style="color: #888; font-size: 13px; line-height: 1.5;">
          Или скопируйте ссылку:<br>
          <span style="color: #2563eb; word-break: break-all;">${verifyLink}</span>
        </p>
        <p style="color: #888; font-size: 13px;">
          Ссылка действительна 7 дней.
        </p>
      </div>
    `
    const text = `Здравствуйте${user.name ? `, ${user.name}` : ''}!

Подтвердите ваш email для аккаунта в Читалке.
Перейдите по ссылке:
${verifyLink}

Ссылка действительна 7 дней.`

    try {
      const sent = await sendEmail({
        to: normalizedEmail,
        subject: 'Подтверждение email — Читалка',
        html,
        text,
      })
      return NextResponse.json({
        ok: true,
        ...(process.env.NODE_ENV !== 'production'
          ? { _devVerifyLink: verifyLink, _devPreviewUrl: sent.previewUrl }
          : {}),
      })
    } catch (e) {
      // Delivery failure must not leak account existence — return the same
      // `ok` as for unknown/already-verified emails.
      console.error('Failed to send verification email', e)
      return NextResponse.json({ ok: true })
    }
  } catch (e) {
    console.error('Resend verification error', e)
    return NextResponse.json(
      { error: 'Внутренняя ошибка сервера' },
      { status: 500 },
    )
  }
}
