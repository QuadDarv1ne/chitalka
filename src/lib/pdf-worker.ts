let initialized = false

export async function initPdfWorker(): Promise<void> {
  if (initialized) return
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'
  initialized = true
  // If the worker asset is missing/stale, re-allow init so a later call retries
  const probe = await fetch('/pdf.worker.min.mjs', { method: 'HEAD' }).catch(() => null)
  if (!probe?.ok) {
    console.warn(
      'PDF worker asset missing at /pdf.worker.min.mjs — run "bun install" or copy pdfjs-dist/build/pdf.worker.min.mjs to public/',
    )
    initialized = false
  }
}
