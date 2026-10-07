import type { BookRecord } from '@/lib/library'

/**
 * Canonical file-name → reader-format mapping.
 *
 * This lives in its own pure module (no 'use client', no browser APIs) so the
 * exact same rules run on both the client and the server. Previously the
 * collection API route kept a hand-copied duplicate of this logic, which had
 * already silently dropped `.cbz` — a comic placed in the books/ folder was
 * offered for neither download nor import. Keeping a single source of truth
 * makes that class of drift impossible.
 */
export function detectFormat(filename: string): BookRecord['format'] | null {
  const lower = filename.toLowerCase()
  if (lower.endsWith('.epub')) return 'epub'
  if (lower.endsWith('.pdf')) return 'pdf'
  if (lower.endsWith('.fb2')) return 'fb2'
  if (lower.endsWith('.md')) return 'md'
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'html'
  if (lower.endsWith('.txt')) return 'txt'
  if (lower.endsWith('.mp3') || lower.endsWith('.mp3.zip')) return 'mp3'
  if (lower.endsWith('.cbz')) return 'cbz'
  return null
}
