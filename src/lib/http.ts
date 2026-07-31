import 'server-only'

/**
 * Read and validate a JSON request body.
 * Rejects non-JSON content types and oversized bodies.
 * Returns the parsed body, or null when the request is invalid.
 */
export async function readJsonBody<T = unknown>(
  req: Request,
  maxBytes = 256 * 1024,
): Promise<T | null> {
  const contentType = req.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) return null

  const contentLength = Number(req.headers.get('content-length') ?? 0)
  if (Number.isFinite(contentLength) && contentLength > maxBytes) return null

  try {
    const raw = await req.text()
    if (raw.length > maxBytes) return null
    if (!raw.trim()) return null
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}
