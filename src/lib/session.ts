import 'server-only'
import { cookies } from 'next/headers'
import { verifySession, getSessionCookieName, type SessionPayload } from '@/lib/auth'
import { db } from '@/lib/db'

export interface AuthenticatedUser {
  id: string
  email: string
  name: string | null
  emailVerified: Date | null
}

export async function getCurrentUser(): Promise<AuthenticatedUser | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get(getSessionCookieName())?.value
  if (!token) return null

  const payload = await verifySession(token)
  if (!payload) return null

  const user = await db.user.findUnique({
    where: { id: payload.userId },
    select: {
      id: true,
      email: true,
      name: true,
      emailVerified: true,
    },
  })

  return user
}

export async function requireUser(): Promise<AuthenticatedUser> {
  const user = await getCurrentUser()
  if (!user) {
    throw new Error('Unauthorized')
  }
  return user
}

export async function getSessionPayload(): Promise<SessionPayload | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get(getSessionCookieName())?.value
  if (!token) return null
  return verifySession(token)
}
