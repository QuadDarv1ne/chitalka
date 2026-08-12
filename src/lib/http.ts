import 'server-only'

/**
 * Coerce a client-supplied value into a valid Date, or null.
 * Accepts ISO strings, Date instances and Unix epoch milliseconds —
 * the client sends numeric timestamps in sync/import payloads.
 */
export function toDate(value: unknown): Date | null {
  let date: Date | null = null
  if (typeof value === 'number' && Number.isFinite(value)) {
    date = new Date(value)
  } else if (typeof value === 'string' && value.trim()) {
    date = new Date(value)
  } else if (value instanceof Date) {
    date = new Date(value.getTime())
  }
  if (!date || Number.isNaN(date.getTime())) return null
  return date
}

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
