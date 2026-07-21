let initialized = false

export async function initPdfWorker(): Promise<void> {
  if (initialized) return
  const pdfjs = await import('pdfjs-dist')
  // @ts-expect-error — worker URL for bundlers
  pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.mjs?url')).default
  initialized = true
}
