'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ChevronLeft, ChevronRight, Loader2, ZoomIn, ZoomOut } from 'lucide-react'
import type { BookRecord } from '@/lib/library'
import { useReaderStore } from '@/store/reader-store'
import { initPdfWorker } from '@/lib/pdf-worker'
import { useReadingTracker } from '@/hooks/use-reading-tracker'

interface Props {
  book: BookRecord
  onProgress: (p: number, extra?: { pdfPage?: number }) => void
}

export function PdfReader({ book, onProgress }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const docRef = useRef<import('pdfjs-dist').PDFDocumentProxy | null>(null)
  const loadingTaskRef = useRef<import('pdfjs-dist').PDFDocumentLoadingTask | null>(null)
  const renderTaskRef = useRef<import('pdfjs-dist').RenderTask | null>(null)
  const onProgressRef = useRef(onProgress)
  const [totalPages, setTotalPages] = useState(0)
  const [page, setPage] = useState(book.pdfPage ?? 1)
  const [pagesFlipped, setPagesFlipped] = useState(0)
  const [loading, setLoading] = useState(true)
  const [pageLoading, setPageLoading] = useState(false)
  const [scale, setScale] = useState(1.2)
  const [pageInput, setPageInput] = useState(String(page))
  const bookIdRef = useRef(book.id)
  const prevPageRef = useRef(book.pdfPage ?? 1)

  // Sync state when book changes
  if (book.id !== bookIdRef.current) {
    bookIdRef.current = book.id
    setPage(book.pdfPage ?? 1)
    setPageInput(String(book.pdfPage ?? 1))
    setScale(1.2)
    setTotalPages(0)
    setLoading(true)
    setPagesFlipped(0)
    prevPageRef.current = book.pdfPage ?? 1
  }
  const settings = useReaderStore((s) => s.settings)

  onProgressRef.current = onProgress

  // Count only actual page turns, so the current page number is not logged
  // as "pages read" (a reader on page 300 would otherwise log 300 pages/5s)
  useEffect(() => {
    if (prevPageRef.current !== page) {
      prevPageRef.current = page
      setPagesFlipped((n) => n + 1)
    }
  }, [page])

  // Reading time tracking (pages visited)
  useReadingTracker(book.id, pagesFlipped)

  // Load PDF document
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    ;(async () => {
      try {
        const pdfjs = await import('pdfjs-dist')
        await initPdfWorker()
        const data = await book.blob.arrayBuffer()
        const loadingTask = pdfjs.getDocument({ data })
        loadingTaskRef.current = loadingTask
        const doc = await loadingTask.promise
        if (cancelled) return
        docRef.current = doc
        setTotalPages(doc.numPages)
        // Clamp the restored page — the saved page may exceed the page count
        setPage((p) => Math.max(1, Math.min(p, doc.numPages)))
        setPageInput((v) => String(Math.max(1, Math.min(Number(v) || 1, doc.numPages))))
        setLoading(false)
      } catch (e) {
        if (cancelled) return
        console.error('PDF load failed', e)
        setLoading(false)
      }
    })()
    return () => {
      cancelled = true
      try {
        renderTaskRef.current?.cancel()
        docRef.current?.cleanup()
        // Fully release the document and its worker
        loadingTaskRef.current?.destroy().catch(() => {})
      } catch { console.warn('PDF cleanup failed') }
      docRef.current = null
      loadingTaskRef.current = null
    }
  }, [book.id, book.blob])

  // Render current page
  const renderPage = useCallback(
    async (pageNum: number, renderScale: number) => {
      const doc = docRef.current
      const canvas = canvasRef.current
      if (!doc || !canvas) return
      // Cancel any in-flight render to avoid concurrent draws on the same canvas
      renderTaskRef.current?.cancel()
      setPageLoading(true)
      try {
        // Apply the theme background before the render starts, so there is
        // no white flash on dark/contrast themes
        const bg =
          settings.theme === 'dark' || settings.theme === 'contrast'
            ? '#2a2a2a'
            : '#ffffff'
        canvas.style.background = bg
        const pdfPage = await doc.getPage(pageNum)
        const viewport = pdfPage.getViewport({ scale: renderScale })
        // Apply device pixel ratio for crisp text
        const dpr = window.devicePixelRatio || 1
        canvas.width = viewport.width * dpr
        canvas.height = viewport.height * dpr
        canvas.style.width = `${viewport.width}px`
        canvas.style.height = `${viewport.height}px`
        const ctx = canvas.getContext('2d')!
        ctx.scale(dpr, dpr)
        const renderTask = pdfPage.render({
          canvasContext: ctx,
          viewport,
          canvas,
        } as any)
        renderTaskRef.current = renderTask
        await renderTask.promise
      } catch (e) {
        if ((e as { name?: string })?.name === 'RenderingCancelledException') return
        console.error('PDF render failed', e)
      } finally {
        setPageLoading(false)
      }
    },
    [settings.theme],
  )

  useEffect(() => {
    if (!loading && docRef.current) {
      renderPage(page, scale)
      const progress = totalPages > 0 ? page / totalPages : 0
      onProgressRef.current(progress, { pdfPage: page })
      setPageInput(String(page))
    }
  }, [page, scale, loading, totalPages, renderPage])

  const prev = useCallback(() => {
    setPage((p) => Math.max(1, p - 1))
  }, [])
  const next = useCallback(() => {
    setPage((p) => Math.min(totalPages, p + 1))
  }, [totalPages])

  const goToPage = useCallback(
    (n: number) => {
      if (n >= 1 && n <= totalPages) {
        setPage(n)
      }
    },
    [totalPages],
  )

  // Keyboard nav
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.target instanceof Element && e.target.closest('[role="dialog"]')) return
      if (e.key === 'ArrowLeft') prev()
      else if (e.key === 'ArrowRight') next()
      else if (e.key === '+' || e.key === '=') setScale((s) => Math.min(3, s + 0.2))
      else if (e.key === '-') setScale((s) => Math.max(0.5, s - 0.2))
    }
    const onGotoPage = (e: Event) => {
      const p = (e as CustomEvent<number>).detail
      if (typeof p === 'number') goToPage(p)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pdf-goto-page', onGotoPage)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pdf-goto-page', onGotoPage)
    }
  }, [prev, next, goToPage])

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className="relative flex flex-col items-center overflow-auto"
      style={{
        background: 'var(--reader-bg)',
        height: 'calc(100vh - 6.5rem)',
      }}
    >
      <div className="sticky top-2 z-10 flex items-center gap-2 rounded-full border bg-background/80 px-2 py-1 backdrop-blur shadow-sm">
        <Button
          variant="ghost"
          size="icon"
          onClick={prev}
          disabled={page <= 1}
          className="h-8 w-8"
          aria-label="Назад"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            goToPage(parseInt(pageInput, 10) || 1)
          }}
          className="flex items-center gap-1"
        >
          <Input
            value={pageInput}
            onChange={(e) => setPageInput(e.target.value)}
            className="h-8 w-12 text-center text-sm"
            type="number"
            min={1}
            max={totalPages}
          />
          <span className="text-xs text-muted-foreground">/ {totalPages}</span>
        </form>
        <Button
          variant="ghost"
          size="icon"
          onClick={next}
          disabled={page >= totalPages}
          className="h-8 w-8"
          aria-label="Вперёд"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
        <div className="mx-1 h-4 w-px bg-border" />
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setScale((s) => Math.max(0.5, s - 0.2))}
          className="h-8 w-8"
          aria-label="Уменьшить"
        >
          <ZoomOut className="h-4 w-4" />
        </Button>
        <span className="text-xs tabular-nums w-10 text-center">
          {Math.round(scale * 100)}%
        </span>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setScale((s) => Math.min(3, s + 0.2))}
          className="h-8 w-8"
          aria-label="Увеличить"
        >
          <ZoomIn className="h-4 w-4" />
        </Button>
      </div>

      <div className="relative flex justify-center py-4">
        {pageLoading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}
        <canvas
          ref={canvasRef}
          className="shadow-lg rounded-sm"
          style={{
            background:
              settings.theme === 'dark' || settings.theme === 'contrast'
                ? '#2a2a2a'
                : '#ffffff',
          }}
        />
      </div>
    </div>
  )
}
