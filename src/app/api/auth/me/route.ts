export const runtime = 'nodejs'
import { logger } from '@/lib/logger'
import { NextResponse } from 'next/server'
import { verifySession, getSessionCookieName } from '@/lib/auth'
import { db } from '@/lib/db'
import { cookies } from 'next/headers'

export async function GET() {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get(getSessionCookieName())?.value
    if (!token) {
      return NextResponse.json({ user: null })
    }

    const payload = await verifySession(token)
    if (!payload) {
      return NextResponse.json({ user: null })
    }

    const user = await db.user.findUnique({
      where: { id: payload.userId },
      select: { id: true, email: true, name: true, emailVerified: true },
    })

    if (!user) {
      cookieStore.delete(getSessionCookieName())
      return NextResponse.json({ user: null })
    }

    return NextResponse.json({ user })
  } catch (e) {
    logger.error('Me error', e)
    return NextResponse.json({ user: null })
  }
}
