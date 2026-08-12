/** Words per page for TXT/MD/FB2 pagination */
export const PAGE_WORDS = 350

/** Rough estimate of bytes per word for Russian UTF-8 text (avg word + space). */
const BYTES_PER_WORD = 7

/**
 * Estimate the remaining reading time (minutes) for a book.
 * Works best for text formats; falls back to a size-based estimate otherwise.
 */
export function estimateRemainingMinutes(
  format: BookFormat,
  sizeBytes: number,
  progress: number,
  wordsPerMinute: number,
): number {
  // Only text-like formats have a meaningful word count from file size.
  const textFormats = new Set(['txt', 'md', 'fb2', 'html'])
  if (!textFormats.has(format)) return 0

  const totalWords = Math.max(0, Math.floor(sizeBytes / BYTES_PER_WORD))
  const remaining = totalWords * Math.max(0, Math.min(1, 1 - progress))
  const minutes = Math.round(remaining / Math.max(1, wordsPerMinute))
  return minutes
}

type BookFormat = 'epub' | 'txt' | 'md' | 'html' | 'pdf' | 'fb2' | 'mp3'

/** Format a minutes count into a short human-readable string. */
export function formatMinutes(minutes: number): string {
  if (minutes <= 0) return ''
  if (minutes < 60) return `${minutes} мин`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m > 0 ? `${h} ч ${m} мин` : `${h} ч`
}
