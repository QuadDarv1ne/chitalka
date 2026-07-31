import 'server-only'

/**
 * Resolve the public base URL for links sent in emails.
 *
 * Never trusts the client-supplied `Origin` header — an attacker could use
 * it to point reset/verify links at their own site and steal the token.
 * Prefers NEXT_PUBLIC_APP_URL; falls back to the server-validated Host header.
 */
export function getAppBaseUrl(req: Request): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (configured) return configured.replace(/\/+$/, '')

  const host = req.headers.get('x-forwarded-host') || req.headers.get('host')
  if (host && host.length <= 253) {
    const proto = req.headers.get('x-forwarded-proto')?.includes('https')
      ? 'https'
      : 'http'
    return `${proto}://${host}`
  }

  return 'http://localhost:3000'
}
