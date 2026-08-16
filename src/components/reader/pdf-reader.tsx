'use client'

import { logger } from '@/lib/logger'
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
  const canvasRightRef = useRef<HTMLCanvasElement>(null)
  const docRef = useRef<import('pdfjs-dist').PDFDocumentProxy | null>(null)
  const loadingTaskRef = useRef<import('pdfjs-dist').PDFDocumentLoadingTask | null>(null)
  const renderTaskRef = useRef<import('pdfjs-dist').RenderTask | null>(null)
  const renderTaskRightRef = useRef<import('pdfjs-dist').RenderTask | null>(null)
  const onProgressRef = useRef(onProgress)
  const settings = useReaderStore((s) => s.settings)
  const [totalPages, setTotalPages] = useState(0)
  const [page, setPage] = useState(book.pdfPage ?? 1)
  const [pagesFlipped, setPagesFlipped] = useState(0)
  const [loading, setLoading] = useState(true)
  const [pageLoading, setPageLoading] = useState(false)
  const [scale, setScale] = useState(settings.twoPage ? 1.8 : 1.2)
  const [pageInput, setPageInput] = useState(String(page))
  const bookIdRef = useRef(book.id)
  const prevPageRef = useRef(book.pdfPage ?? 1)
  // Once the user adjusts zoom, toggling two-page mode keeps their scale
  // instead of snapping back to the default.
  const userScaleRef = useRef(false)

  // Sync state when book changes
  /* eslint-disable react-hooks/refs */
  if (book.id !== bookIdRef.current) {
    bookIdRef.current = book.id
    userScaleRef.current = false
    setPage(book.pdfPage ?? 1)
    setPageInput(String(book.pdfPage ?? 1))
    setScale(settings.twoPage ? 1.8 : 1.2)
    setTotalPages(0)
    setLoading(true)
    setPagesFlipped(0)
    prevPageRef.current = book.pdfPage ?? 1
  }
  /* eslint-enable react-hooks/refs */
  const twoPage = settings.twoPage
  // In two-page mode `page` is the left page; the right page is page+1.
  const hasRightPage = twoPage && page + 1 <= totalPages

  // eslint-disable-next-line react-hooks/refs
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
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
        logger.error('PDF load failed', e)
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
      } catch { logger.warn('PDF cleanup failed') }
      docRef.current = null
      loadingTaskRef.current = null
    }
  }, [book.id, book.blob])

  // Render a single PDF page onto the given canvas
  const renderPageOnto = useCallback(
    async (
      pageNum: number,
      canvas: HTMLCanvasElement,
      taskRef: { current: import('pdfjs-dist').RenderTask | null },
      renderScale: number,
    ) => {
      const doc = docRef.current
      if (!doc || !canvas) return
      // Cancel any in-flight render to avoid concurrent draws on the same canvas
      taskRef.current?.cancel()
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
        const renderTask: import('pdfjs-dist').RenderTask = pdfPage.render({
          canvasContext: ctx,
          viewport,
          canvas,
        })
        taskRef.current = renderTask
        await renderTask.promise
      } catch (e) {
        if ((e as { name?: string })?.name === 'RenderingCancelledException') return
        logger.error('PDF render failed', e)
      }
    },
    [settings.theme],
  )

  // Render current page(s)
  useEffect(() => {
    if (loading || !docRef.current) return
    setPageLoading(true)
    const run = async () => {
      await renderPageOnto(page, canvasRef.current!, renderTaskRef, scale)
      if (twoPage && page + 1 <= totalPages) {
        await renderPageOnto(page + 1, canvasRightRef.current!, renderTaskRightRef, scale)
      }
      setPageLoading(false)
    }
    run()
    const progress = totalPages > 0 ? page / totalPages : 0
    onProgressRef.current(progress, { pdfPage: page })
    setPageInput(String(page))
  }, [page, scale, loading, totalPages, twoPage, renderPageOnto])

  // Adapt scale when twoPage mode changes (unless the user zoomed manually)
  useEffect(() => {
    if (userScaleRef.current) return
    setScale(settings.twoPage ? 1.8 : 1.2)
  }, [settings.twoPage])

  const prev = useCallback(() => {
    const step = twoPage ? 2 : 1
    setPage((p) => Math.max(1, p - step))
  }, [twoPage])
  const next = useCallback(() => {
    const step = twoPage ? 2 : 1
    setPage((p) => {
      const nextP = p + step
      if (nextP > totalPages) {
        // Last odd page: advance by 1 to show the final page alone
        return Math.min(totalPages, p + 1)
      }
      return nextP
    })
  }, [totalPages, twoPage])

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
      if ((e.key === ' ' || e.key === 'PageDown' || e.key === 'PageUp') &&
        e.target instanceof Element && e.target.closest('button, a')) return
      if (e.key === 'ArrowLeft' || e.key === 'PageUp' || e.key === 'Backspace') prev()
      else if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
        if (e.key === ' ' || e.key === 'PageDown') e.preventDefault()
        next()
      }
      else if (e.key === '+' || e.key === '=') {
        userScaleRef.current = true
        setScale((s) => Math.min(3, s + 0.2))
      }
      else if (e.key === '-') {
        userScaleRef.current = true
        setScale((s) => Math.max(0.5, s - 0.2))
      }
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
          disabled={twoPage ? page <= 2 : page <= 1}
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
          disabled={twoPage ? page + 2 > totalPages : page >= totalPages}
          className="h-8 w-8"
          aria-label="Вперёд"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
        <div className="mx-1 h-4 w-px bg-border" />
        <Button
          variant="ghost"
          size="icon"
          onClick={() => {
            userScaleRef.current = true
            setScale((s) => Math.max(0.5, s - 0.2))
          }}
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
          onClick={() => {
            userScaleRef.current = true
            setScale((s) => Math.min(3, s + 0.2))
          }}
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
        <div className={`flex items-center justify-center ${twoPage ? 'gap-1' : ''}`}>
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
          {twoPage && hasRightPage && (
            <canvas
              ref={canvasRightRef}
              className="shadow-lg rounded-sm"
              style={{
                background:
                  settings.theme === 'dark' || settings.theme === 'contrast'
                    ? '#2a2a2a'
                    : '#ffffff',
              }}
            />
          )}
        </div>
      </div>
    </div>
  )
}
