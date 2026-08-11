import 'server-only'

/**
 * In-memory rate limiter (single-instance, suitable for dev/small deployments).
 * For production multi-instance setups, replace with Redis-based implementation.
 */

interface RateLimitEntry {
  count: number
  firstRequestAt: number
  blockedUntil?: number
}

const buckets = new Map<string, RateLimitEntry>()

interface RateLimitOptions {
  /** Maximum requests allowed in the window */
  max: number
  /** Time window in ms */
  windowMs: number
  /** Block duration after exceeding limit (ms). Default: windowMs */
  blockMs?: number
}

interface RateLimitResult {
  ok: boolean
  remaining: number
  retryAfter?: number // ms
}

/**
 * Check rate limit for a given key.
 * Returns { ok: false } if limit exceeded.
 */
export function checkRateLimit(
  key: string,
  options: RateLimitOptions,
): RateLimitResult {
  const now = Date.now()
  const blockMs = options.blockMs ?? options.windowMs
  const entry = buckets.get(key)

  // Currently blocked?
  if (entry?.blockedUntil && entry.blockedUntil > now) {
    return {
      ok: false,
      remaining: 0,
      retryAfter: entry.blockedUntil - now,
    }
  }

  // Block expired: reset the entry so the next request starts a fresh window.
  // Without this, a stale count (still > max) would instantly re-block.
  if (entry?.blockedUntil && entry.blockedUntil <= now && entry.count > options.max) {
    buckets.delete(key)
  }

  // Reset if window expired
  if (!entry || now - entry.firstRequestAt > options.windowMs) {
    buckets.set(key, {
      count: 1,
      firstRequestAt: now,
    })
    return { ok: true, remaining: options.max - 1 }
  }

  // Increment
  entry.count += 1
  if (entry.count > options.max) {
    entry.blockedUntil = now + blockMs
    return {
      ok: false,
      remaining: 0,
      retryAfter: blockMs,
    }
  }

  return {
    ok: true,
    remaining: options.max - entry.count,
  }
}

/**
 * Get client identifier for rate limiting.
 *
 * X-Forwarded-For is only trusted when the app runs behind a reverse proxy
 * that strips client-supplied XFF (Caddy/nginx append their own value and
 * should be configured to drop incoming XFF). Without TRUST_PROXY=true the
 * client could forge a fresh identity per request and bypass every limit.
 */
export function getRateLimitKey(req: Request, endpoint: string): string {
  const trustProxy = process.env.TRUST_PROXY === 'true'
  let ip = ''
  if (trustProxy) {
    const forwarded = req.headers.get('x-forwarded-for')
    if (forwarded) {
      const parts = forwarded.split(',').map((p) => p.trim()).filter(Boolean)
      ip = parts[parts.length - 1] ?? ''
    }
    // X-Real-IP is equally forgeable by a direct client, so it is only
    // trusted when the app is known to sit behind a stripping proxy.
    if (!ip) ip = req.headers.get('x-real-ip') ?? ''
  }
  // No real IP available — key by UA+endpoint to at least slow down scripts
  if (!ip || ip.length > 64) {
    const ua = trustProxy ? '' : (req.headers.get('user-agent') ?? '').slice(0, 64)
    return `${ua || 'unknown'}:${endpoint}`
  }
  return `${ip}:${endpoint}`
}

/**
 * Standard rate limits for auth endpoints.
 * - Login: 10 attempts per 15 min, then block 15 min
 * - Register: 5 per hour, then block 1 hour
 * - Forgot password: 5 per hour, then block 1 hour
 * - Reset password: 10 per hour
 * - Resend verification: 3 per hour
 */
export const RATE_LIMITS = {
  login: { max: 10, windowMs: 15 * 60 * 1000, blockMs: 15 * 60 * 1000 },
  register: { max: 5, windowMs: 60 * 60 * 1000, blockMs: 60 * 60 * 1000 },
  forgotPassword: { max: 5, windowMs: 60 * 60 * 1000, blockMs: 60 * 60 * 1000 },
  resetPassword: { max: 10, windowMs: 60 * 60 * 1000, blockMs: 30 * 60 * 1000 },
  resendVerification: { max: 3, windowMs: 60 * 60 * 1000, blockMs: 30 * 60 * 1000 },
  verifyEmail: { max: 20, windowMs: 60 * 60 * 1000 },
  booksSync: { max: 120, windowMs: 10 * 60 * 1000, blockMs: 10 * 60 * 1000 },
} as const

/**
 * Apply rate limit and return NextResponse-friendly error if exceeded.
 */
export function applyRateLimit(
  req: Request,
  endpoint: keyof typeof RATE_LIMITS,
): { ok: true } | { ok: false; retryAfter: number } {
  const key = getRateLimitKey(req, endpoint)
  const result = checkRateLimit(key, RATE_LIMITS[endpoint])
  if (!result.ok) {
    return { ok: false, retryAfter: result.retryAfter ?? 0 }
  }
  return { ok: true }
}

/**
 * Cleanup old entries periodically (called from any request).
 * Keeps memory bounded.
 */
export function cleanupRateLimits(): void {
  const now = Date.now()
  const maxAge = 2 * 60 * 60 * 1000 // 2 hours
  for (const [key, entry] of buckets.entries()) {
    const age = now - entry.firstRequestAt
    if (age > maxAge && (!entry.blockedUntil || entry.blockedUntil < now)) {
      buckets.delete(key)
    }
  }
}

// Auto-cleanup every 10 minutes (lazy — first call triggers setup)
let cleanupTimer: ReturnType<typeof setInterval> | null = null
export function startCleanupTimer(): void {
  if (cleanupTimer) return
  cleanupTimer = setInterval(cleanupRateLimits, 10 * 60 * 1000)
}
export function stopCleanupTimer(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer)
    cleanupTimer = null
  }
}

// Bootstrap cleanup timer only in long-running Node environments.
// Skip edge runtime and SSR (Next.js Node runtime) — serverless
// instances don't need persistent timers since state is per-request.
if (
  typeof globalThis !== 'undefined' &&
  typeof setInterval !== 'undefined' &&
  typeof process !== 'undefined' &&
  process.env.NEXT_RUNTIME === 'nodejs'
) {
  startCleanupTimer()
}
