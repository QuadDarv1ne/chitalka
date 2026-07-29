import 'server-only'
import bcrypt from 'bcryptjs'
import { SignJWT, jwtVerify } from 'jose'
import { db } from '@/lib/db'

if (!process.env.JWT_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET environment variable is required in production')
  }
  console.warn('⚠️ JWT_SECRET not set — using a random dev-only secret. Set JWT_SECRET in .env for persistent sessions across restarts.')
}
const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || crypto.randomUUID(),
)

const SESSION_COOKIE = 'reader-session'
const DEFAULT_SESSION_DURATION = 60 * 60 * 24 * 30 // 30 days
const REMEMBER_ME_DURATION = 60 * 60 * 24 * 365 // 1 year

export interface SessionPayload {
  userId: string
  email: string
  name?: string | null
  sessionId?: string
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12)
}

export async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

export async function createSession(
  payload: SessionPayload,
  options?: { rememberMe?: boolean; userAgent?: string; ip?: string },
): Promise<{ token: string; expiresAt: Date }> {
  const duration = options?.rememberMe ? REMEMBER_ME_DURATION : DEFAULT_SESSION_DURATION
  const expiresAt = new Date(Date.now() + duration * 1000)

  // Persist session in DB for tracking/revocation
  const session = await db.session.create({
    data: {
      userId: payload.userId,
      token: '', // will be updated after JWT creation
      userAgent: options?.userAgent?.slice(0, 500) || null,
      ip: options?.ip || null,
      expiresAt,
    },
  })

  const token = await new SignJWT({ ...payload, sessionId: session.id })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${duration}s`)
    .sign(JWT_SECRET)

  await db.session.update({
    where: { id: session.id },
    data: { token },
  })

  return { token, expiresAt }
}

export async function verifySession(
  token: string,
): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET)
    const sessionPayload = payload as unknown as SessionPayload

    // Verify session exists in DB and is not expired
    if (sessionPayload.sessionId) {
      const session = await db.session.findUnique({
        where: { id: sessionPayload.sessionId },
      })
      if (!session || session.expiresAt < new Date()) {
        return null
      }
    }

    return sessionPayload
  } catch (e) {
    console.warn('Session verification failed', e)
    return null
  }
}

export async function revokeSession(sessionId: string): Promise<void> {
  await db.session.deleteMany({ where: { id: sessionId } })
}

export async function revokeAllSessionsExcept(
  userId: string,
  exceptSessionId: string,
): Promise<void> {
  await db.session.deleteMany({
    where: { userId, NOT: { id: exceptSessionId } },
  })
}

export async function getUserSessions(userId: string) {
  return db.session.findMany({
    where: { userId, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  })
}

export function getSessionCookieName() {
  return SESSION_COOKIE
}

export function getSessionDuration(rememberMe?: boolean) {
  return rememberMe ? REMEMBER_ME_DURATION : DEFAULT_SESSION_DURATION
}

export function generateResetToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export function getClientIp(req: Request): string | undefined {
  const forwarded = req.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0].trim()
  const real = req.headers.get('x-real-ip')
  if (real) return real
  return undefined
}

export function getUserAgent(req: Request): string | undefined {
  return req.headers.get('user-agent') || undefined
}
