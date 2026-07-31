import 'server-only'
import os from 'os'
import path from 'path'

const LOG_PATH = path.join(os.tmpdir(), 'reader-emails.log')

/**
 * Mock email service.
 *
 * ⚠️ In development mode, emails are logged to the server console and also
 * stored in a temp file (see LOG_PATH) so they can be inspected.
 *
 * In production, replace this with a real SMTP/transactional email provider
 * (e.g. Resend, SendGrid, Postmark, AWS SES).
 *
 * Suggested production implementation:
 *
 * ```ts
 * import { Resend } from 'resend'
 * const resend = new Resend(process.env.RESEND_API_KEY)
 * await resend.emails.send({
 *   from: 'no-reply@yourapp.com',
 *   to,
 *   subject,
 *   html,
 * })
 * ```
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

export async function sendEmail(
  message: EmailMessage,
): Promise<SentEmail> {
  if (process.env.NODE_ENV === 'production' && !process.env.RESEND_API_KEY) {
    throw new Error(
      'Email delivery is not configured. Set RESEND_API_KEY or implement an SMTP provider in src/lib/email.ts',
    )
  }
  const id = Math.random().toString(36).slice(2, 12)
  const sent: SentEmail = {
    ...message,
    id,
    sentAt: new Date(),
    // In dev mode: extract reset link for display
    previewUrl: message.html.match(/href="([^"]+)"/)?.[1],
  }
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
