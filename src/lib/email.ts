import 'server-only'
import os from 'os'
import path from 'path'

const LOG_PATH = path.join(os.tmpdir(), 'reader-emails.log')

/**
 * Email service.
 *
 * - In development: emails are logged to the server console and stored in a
 *   temp file (see LOG_PATH) so they can be inspected via /api/auth/emails.
 * - In production with RESEND_API_KEY set: delivered through the Resend HTTP
 *   API (no extra dependency needed). RESEND_FROM overrides the sender.
 * - In production without RESEND_API_KEY: sendEmail() throws — callers that
 *   must not break the flow (register/forgot/resend) are responsible for
 *   catching and continuing.
 */

export interface EmailMessage {
  to: string
  subject: string
  html: string
  text: string
}

export interface SentEmail extends EmailMessage {
  id: string
  sentAt: Date
  // For dev mode — the actual link/preview so we can show it in UI
  previewUrl?: string
}

const sentEmails: SentEmail[] = []
const MAX_STORED_EMAILS = 100

async function sendViaResend(message: EmailMessage, apiKey: string): Promise<void> {
  const from =
    process.env.RESEND_FROM?.trim() || 'Читалка <onboarding@resend.dev>'
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
    }),
    signal: AbortSignal.timeout(10000),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Resend API error ${res.status}: ${detail.slice(0, 200)}`)
  }
}

export async function sendEmail(
  message: EmailMessage,
): Promise<SentEmail> {
  const id = Math.random().toString(36).slice(2, 12)
  const sent: SentEmail = {
    ...message,
    id,
    sentAt: new Date(),
  }

  if (process.env.NODE_ENV === 'production') {
    if (!process.env.RESEND_API_KEY) {
      throw new Error(
        'Email delivery is not configured. Set RESEND_API_KEY or implement an SMTP provider in src/lib/email.ts',
      )
    }
    await sendViaResend(message, process.env.RESEND_API_KEY)
    return sent
  }

  // Dev mode: extract reset link for display
  sent.previewUrl = message.html.match(/href="([^"]+)"/)?.[1]
  sentEmails.push(sent)
  // Keep memory bounded
  if (sentEmails.length > MAX_STORED_EMAILS) {
    sentEmails.splice(0, sentEmails.length - MAX_STORED_EMAILS)
  }

  // Log to console (visible in dev.log) — dev only, no token leakage in prod
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log(`📧 EMAIL SENT (dev mode)`)
  console.log(`To: ${message.to}`)
  console.log(`Subject: ${message.subject}`)
  console.log(`Body: ${message.text}`)
  if (sent.previewUrl) {
    console.log(`🔗 Reset link: ${sent.previewUrl}`)
  }
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

  // Also append to file for retrieval
  try {
    const fs = await import('fs/promises')
    const logEntry = `[${sent.sentAt.toISOString()}] To: ${message.to} | Subject: ${message.subject} | ${sent.previewUrl || ''}\n`
    await fs.appendFile(LOG_PATH, logEntry)
  } catch { console.warn('Failed to write email log') }

  return sent
}

/**
 * Get recently sent emails (for dev-mode "inbox" preview).
 * Only the last 10 emails, only in development.
 */
export function getRecentEmails(limit = 10): SentEmail[] {
  if (process.env.NODE_ENV !== 'production') {
    return sentEmails.slice(-limit).reverse()
  }
  return []
}

/**
 * Find a sent email by recipient address (for password reset preview).
 */
export function findEmailByRecipient(email: string): SentEmail | undefined {
  return sentEmails
    .slice()
    .reverse()
    .find((e) => e.to.toLowerCase() === email.toLowerCase())
}
