import 'server-only'
import bcrypt from 'bcryptjs'
import { SignJWT, jwtVerify } from 'jose'
import { db } from '@/lib/db'

if (!process.env.JWT_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET environment variable is required in production')
  }
  console.warn('⚠️ JWT_SECRET not set — using a random dev-only secret. Set JWT_SECRET in .env for persistent sessions across restarts.')
} else if (new TextEncoder().encode(process.env.JWT_SECRET).byteLength < 32) {
  // HS256 requires a 256-bit key; jose rejects shorter secrets with an opaque error
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET must be at least 32 bytes long in production')
  }
  console.warn('⚠️ JWT_SECRET is shorter than 32 bytes — sessions will fail with jose. Set a longer JWT_SECRET in .env.')
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

  // Persist session in DB for tracking/revocation.
  // Use a random placeholder token so concurrent session creations never
  // collide on the unique `token` column.
  const session = await db.session.create({
    data: {
      userId: payload.userId,
      token: crypto.randomUUID(),
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
    if (typeof sessionPayload.userId !== 'string' || !sessionPayload.userId) {
      return null
    }

    // Verify session exists in DB, is not expired, and belongs to the user
    if (sessionPayload.sessionId) {
      const session = await db.session.findUnique({
        where: { id: sessionPayload.sessionId },
      })
      if (
        !session ||
        session.expiresAt < new Date() ||
        session.userId !== sessionPayload.userId
      ) {
        return null
      }
    }

    return sessionPayload
  } catch (e) {
    console.warn('Session verification failed', e)
    return null
  }
}

export async function revokeSession(
  userId: string,
  sessionId: string,
): Promise<number> {
  const result = await db.session.deleteMany({
    where: { id: sessionId, userId },
  })
  return result.count
}

export async function revokeAllSessionsExcept(
  userId: string,
  exceptSessionId: string,
): Promise<void> {
  await db.session.deleteMany({
    where: { userId, NOT: { id: exceptSessionId } },
  })
}

export async function revokeAllSessions(userId: string): Promise<void> {
  await db.session.deleteMany({ where: { userId } })
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

/**
 * Whether the session cookie should carry the Secure flag.
 * Override with COOKIE_SECURE=false when serving plain HTTP behind a
 * reverse proxy (e.g. LAN deployments) — otherwise auth cookies are dropped.
 */
export function isCookieSecure(): boolean {
  if (process.env.COOKIE_SECURE === 'false') return false
  return process.env.NODE_ENV === 'production'
}

export function generateResetToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Extract the client IP for session logging.
 * X-Forwarded-For is only trusted when TRUST_PROXY=true (a configured
 * reverse proxy strips client-supplied XFF and appends the real IP).
 */
export function getClientIp(req: Request): string | undefined {
  if (process.env.TRUST_PROXY === 'true') {
    const forwarded = req.headers.get('x-forwarded-for')
    if (forwarded) {
      const parts = forwarded.split(',').map((p) => p.trim()).filter(Boolean)
      const ip = parts[parts.length - 1]
      if (ip && ip.length <= 64) return ip
    }
  }
  const real = req.headers.get('x-real-ip')
  if (real && real.length <= 64) return real
  return undefined
}

export function getUserAgent(req: Request): string | undefined {
  return req.headers.get('user-agent') || undefined
}
