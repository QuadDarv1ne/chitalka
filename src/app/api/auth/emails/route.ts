import { NextResponse } from 'next/server'
import { getRecentEmails } from '@/lib/email'

/**
 * Dev-only endpoint to inspect recently sent emails.
 * Useful for development — shows reset links without real SMTP.
 * Guarded by a token (DEV_EMAIL_TOKEN) so LAN visitors cannot read
 * password-reset links from other users.
 */
export async function GET(req: Request) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json(
      { error: 'Not available in production' },
      { status: 404 },
    )
  }
  const expected = process.env.DEV_EMAIL_TOKEN
  if (!expected) {
    // Treat an unconfigured token as "disabled" — never serve reset/verify
    // links to unauthenticated LAN visitors in dev mode.
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${expected}`) {
    return NextResponse.json(
      { error: 'Forbidden' },
      { status: 403 },
    )
  }
  const emails = getRecentEmails(10).map((e) => ({
    id: e.id,
    to: e.to,
    subject: e.subject,
    text: e.text,
    previewUrl: e.previewUrl,
    sentAt: e.sentAt,
  }))
  return NextResponse.json({ emails })
}
