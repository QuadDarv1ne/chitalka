import { NextResponse } from 'next/server'
import { getRecentEmails } from '@/lib/email'

/**
 * Dev-only endpoint to inspect recently sent emails.
 * Useful for development — shows reset links without real SMTP.
 */
export async function GET() {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json(
      { error: 'Not available in production' },
      { status: 404 },
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
