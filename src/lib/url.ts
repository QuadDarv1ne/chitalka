import 'server-only'

/**
 * Resolve the public base URL for links sent in emails.
 *
 * Never trusts the client-supplied `Host`/`x-forwarded-host` headers —
 * an attacker could use them to point reset/verify links at their own site
 * and steal the token (email-link poisoning).
 *
 * - In production: NEXT_PUBLIC_APP_URL is REQUIRED.
 * - In development: falls back to localhost (mock emails are never delivered).
 * - The Host header is only consulted when TRUST_PROXY=true AND the app runs
 *   behind a reverse proxy that strips incoming X-Forwarded-Host
 *   (Caddy/nginx by default pass it through, so prefer NEXT_PUBLIC_APP_URL).
 */
export function getAppBaseUrl(req?: Request): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (configured) return configured.replace(/\/+$/, '')

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'NEXT_PUBLIC_APP_URL is required in production — email links would otherwise be vulnerable to Host-header injection',
    )
  }

  if (process.env.TRUST_PROXY === 'true' && req) {
    const host = req.headers.get('x-forwarded-host') || req.headers.get('host')
    if (host && host.length <= 253) {
      const proto = req.headers.get('x-forwarded-proto')?.includes('https')
        ? 'https'
        : 'http'
      return `${proto}://${host}`
    }
  }

  return 'http://localhost:3000'
}
