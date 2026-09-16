/**
 * pdf.js runtime assets.
 *
 * The worker fetches character maps and the standard fonts over HTTP while a
 * page is rendered. Without them a PDF with Cyrillic CID-encoded fonts paints
 * nothing at all — which is exactly what a generated cover then turns into.
 * scripts/postinstall.mjs copies both directories out of pdfjs-dist into
 * public/pdfjs, the same way the worker itself is copied.
 */
export const PDF_WORKER_SRC = '/pdf.worker.min.mjs'
export const PDF_CMAP_URL = '/pdfjs/cmaps/'
export const PDF_STANDARD_FONT_URL = '/pdfjs/standard_fonts/'

/** Options every getDocument() call needs to resolve fonts correctly. */
export function pdfAssetOptions() {
  return {
    cMapUrl: PDF_CMAP_URL,
    cMapPacked: true,
    standardFontDataUrl: PDF_STANDARD_FONT_URL,
  }
}

let initialized = false
import { logger } from '@/lib/logger'

export async function initPdfWorker(): Promise<void> {
  if (initialized) return
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = PDF_WORKER_SRC
  initialized = true
  // If the worker asset is missing/stale, re-allow init so a later call retries
  const probe = await fetch(PDF_WORKER_SRC, { method: 'HEAD' }).catch(() => null)
  if (!probe?.ok) {
    logger.warn(
      'PDF worker asset missing at /pdf.worker.min.mjs — run "bun install" or copy pdfjs-dist/build/pdf.worker.min.mjs to public/',
    )
    initialized = false
  }
}
