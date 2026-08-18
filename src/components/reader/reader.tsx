'use client'

import { logger } from '@/lib/logger'
import { useEffect, useState, useCallback, useRef } from 'react'
import { Button } from '@/components/ui/button'
import {
  ArrowLeft,
  List,
  Settings2,
  BookmarkPlus,
  Search,
  Highlighter,
  Loader2,
  Keyboard,
  StickyNote,
  Maximize2,
  Minimize2,
} from 'lucide-react'
import { useReaderStore } from '@/store/reader-store'
import { getBook, updateBook, flushBookWrites, type BookRecord } from '@/lib/library'
import { syncBooksToServer } from '@/hooks/use-book-sync'
import { useAuth } from '@/hooks/use-auth'
import { estimateRemainingMinutes, formatMinutes } from '@/lib/constants'
import { getWordsPerMinute, type ReadingSpeed } from '@/store/reader-store'
import { EpubReader } from './epub-reader'
import { TxtReader } from './txt-reader'
import { PdfReader } from './pdf-reader'
import { AudioReader } from './audio-reader'
import { HtmlReader } from './html-reader'
import { CbzReader } from './cbz-reader'
import { ReaderSettingsPanel } from './settings-panel'
import { TocPanel } from './toc-panel'
import { BookmarksPanel } from './bookmarks-panel'
import { HighlightsPanel } from './highlights-panel'
import { NotesPanel } from './notes-panel'
import { BookRating } from './book-rating'
import { SearchDialog } from './search-dialog'
import { ShortcutsHelp } from './shortcuts-help'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { toast } from 'sonner'

type SidebarTab = 'toc' | 'bookmarks' | 'highlights' | 'notes'

export function Reader() {
  const currentBookId = useReaderStore((s) => s.currentBookId)
  const closeBook = useReaderStore((s) => s.closeBook)
  const setView = useReaderStore((s) => s.setView)
  const tocOpen = useReaderStore((s) => s.tocOpen)
  const setTocOpen = useReaderStore((s) => s.setTocOpen)
  const settingsOpen = useReaderStore((s) => s.settingsOpen)
  const setSettingsOpen = useReaderStore((s) => s.setSettingsOpen)
  const bookmarksOpen = useReaderStore((s) => s.sidebarOpen)
  const setBookmarksOpen = useReaderStore((s) => s.setSidebarOpen)
  const setSearchOpen = useReaderStore((s) => s.setSearchOpen)
  const { user } = useAuth()
  const [book, setBook] = useState<BookRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [progress, setProgress] = useState(0)
  const [activeTab, setActiveTab] = useState<SidebarTab>('toc')
  const [helpOpen, setHelpOpen] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  // Position state fills in after the book loads (useState(book?.x) only
  // sees book===null on first render)
  const [currentCfi, setCurrentCfi] = useState<string | undefined>(undefined)
  const [currentTextPosition, setCurrentTextPosition] = useState<number | undefined>(undefined)
  const [currentPdfPage, setCurrentPdfPage] = useState<number | undefined>(undefined)
  const [estimatedRemainingMinutes, setEstimatedRemainingMinutes] = useState<number | null>(null)

  useEffect(() => {
    if (!currentBookId) return
    let cancelled = false
    getBook(currentBookId)
      .then((b) => {
        if (cancelled) return
        setBook(b ?? null)
        setProgress(b?.progress ?? 0)
        setCurrentCfi(b?.cfi)
        setCurrentTextPosition(b?.textPosition)
        setCurrentPdfPage(b?.pdfPage)
        if (b) {
          updateBook(b.id, { lastOpenedAt: Date.now() }).catch(() => {})
          // Calculate estimated remaining reading time
          const readingSpeed = useReaderStore.getState().settings.readingSpeed as ReadingSpeed
          const wpm = getWordsPerMinute(readingSpeed)
          const remaining = estimateRemainingMinutes(b.format, b.size, b.progress ?? 0, wpm)
          setEstimatedRemainingMinutes(remaining)
        }
      })
      .catch((e) => {
        // IndexedDB can fail transiently (corrupt DB, private mode, quota).
        // Surface the failure to the user instead of spinning forever.
        logger.error('Failed to load book', e)
        if (!cancelled) {
          setBook(null)
          setLoading(false)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [currentBookId])

  // Push the final progress to the server when the reader closes or the tab
  // is hidden/closed — progress made while the library was unmounted is not lost.
  const bookIdRef = useRef<string | null>(null)
  const bookFormatRef = useRef<BookRecord['format']>('txt')
  const bookMetaRef = useRef<{ format: BookRecord['format']; size: number }>({
    format: 'txt',
    size: 0,
  })
  useEffect(() => {
    bookIdRef.current = book?.id ?? null
    bookFormatRef.current = book?.format ?? 'txt'
    if (book) bookMetaRef.current = { format: book.format, size: book.size }
  }, [book?.id, book])
  useEffect(() => {
    const flushSync = () => {
      const id = bookIdRef.current
      if (!id || !user?.emailVerified) return
      ;(async () => {
        try {
          // Wait for queued updateBook writes so the synced progress is fresh
          await flushBookWrites(id)
          const b = await getBook(id)
          if (b) await syncBooksToServer([b])
        } catch (e) {
          logger.error('Final sync failed', e)
        }
      })()
    }
    window.addEventListener('pagehide', flushSync)
    return () => {
      window.removeEventListener('pagehide', flushSync)
      flushSync()
    }
  }, [user])

  const handleProgressChange = useCallback(
    async (
      p: number,
      extra?: { cfi?: string; textPosition?: number; pdfPage?: number; audioTrack?: number; audioTime?: number },
    ) => {
      setProgress(p)
      if (extra?.cfi !== undefined) setCurrentCfi(extra.cfi)
      if (extra?.textPosition !== undefined) setCurrentTextPosition(extra.textPosition)
      if (extra?.pdfPage !== undefined) setCurrentPdfPage(extra.pdfPage)
      // Use ref to avoid stale closure — prevents saving progress for
      // the wrong book when the user switches books quickly.
      const bookId = bookIdRef.current
      if (!bookId) return
      await updateBook(bookId, {
        progress: p,
        cfi: extra?.cfi,
        textPosition: extra?.textPosition,
        pdfPage: extra?.pdfPage,
        audioTrack: extra?.audioTrack,
        audioTime: extra?.audioTime,
      }).catch((e) => logger.error('Progress save failed', e))
      // Keep the "Осталось" estimate live as the user reads
      const { format, size } = bookMetaRef.current
      const readingSpeed = useReaderStore.getState().settings.readingSpeed as ReadingSpeed
      const wpm = getWordsPerMinute(readingSpeed)
      const remaining = estimateRemainingMinutes(format, size, p, wpm)
      setEstimatedRemainingMinutes(remaining)
    },
    [],
  )

  // Fullscreen reading mode. Uses the browser Fullscreen API so the OS-level
  // chrome (tab bar, scrollbars) also disappears — a real immersive view.
  const toggleFullscreen = useCallback(() => {
    if (typeof document === 'undefined') return
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {})
    } else {
      document.documentElement.requestFullscreen().catch(() => {
        // Fullscreen API can be rejected (e.g. permissions) — ignore quietly
      })
    }
  }, [])

  // Track the real fullscreen state (user can exit via Esc / F11 too)
  useEffect(() => {
    const onFsChange = () => setFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onFsChange)
    return () => document.removeEventListener('fullscreenchange', onFsChange)
  }, [])

  // Global keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      // Don't hijack keys while a dialog/sheet (search, settings, TOC) is open
      if (e.target instanceof Element && e.target.closest('[role="dialog"]')) return
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault()
        // Audio books have no full-text search — the toolbar button is
        // hidden for mp3, so the shortcut must not open an empty dialog.
        if (bookFormatRef.current !== 'mp3') setSearchOpen(true)
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
        e.preventDefault()
        // Dispatch a custom event so any reader can add a bookmark at current position
        window.dispatchEvent(new CustomEvent('reader:add-bookmark'))
        setBookmarksOpen(true)
        setActiveTab('bookmarks')
      } else if ((e.metaKey || e.ctrlKey) && (e.key === '=' || e.key === '+')) {
        e.preventDefault()
        const { settings, updateSettings } = useReaderStore.getState()
        updateSettings({ fontSize: Math.min(28, settings.fontSize + 1) })
      } else if ((e.metaKey || e.ctrlKey) && (e.key === '-' || e.key === '_')) {
        e.preventDefault()
        const { settings, updateSettings } = useReaderStore.getState()
        updateSettings({ fontSize: Math.max(12, settings.fontSize - 1) })
      } else if ((e.metaKey || e.ctrlKey) && e.key === '0') {
        e.preventDefault()
        useReaderStore.getState().updateSettings({ fontSize: 18 })
      } else if (e.key === 'f' && !e.metaKey && !e.ctrlKey) {
        toggleFullscreen()
      } else if (e.key === '?') {
        setHelpOpen(true)
      } else if (e.key === 'Escape') {
        setHelpOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setSearchOpen, setBookmarksOpen])

  // Ctrl+B bookmark handler — saves the current position like the panel button does
  useEffect(() => {
    const onAddBookmark = () => {
      if (!book) return
      const { bookmarks, addBookmark } = useReaderStore.getState()
      const marks = bookmarks.filter((m) => m.bookId === book.id)
      addBookmark({
        bookId: book.id,
        cfi: currentCfi ?? book.cfi,
        textPosition: currentTextPosition ?? book.textPosition,
        pdfPage: currentPdfPage ?? book.pdfPage,
        label: `Закладка ${marks.length + 1} · ${new Date().toLocaleString('ru-RU', {
          day: 'numeric',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
        })}`,
      })
      toast.success('Закладка добавлена')
    }
    window.addEventListener('reader:add-bookmark', onAddBookmark)
    return () => window.removeEventListener('reader:add-bookmark', onAddBookmark)
  }, [book, currentCfi, currentTextPosition, currentPdfPage])

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!book) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground">Книга не найдена</p>
        <Button onClick={closeBook}>Вернуться в библиотеку</Button>
      </div>
    )
  }

  const openSidebar = (tab: SidebarTab) => {
    setActiveTab(tab)
    // Close all panels first, then open the requested one
    const shouldOpenSidebar = tab === 'bookmarks'
    const shouldOpenToc = tab === 'toc' || tab === 'highlights' || tab === 'notes'
    setBookmarksOpen(shouldOpenSidebar)
    setTocOpen(shouldOpenToc)
    setSettingsOpen(false)
  }

  return (
    <div className="relative flex min-h-screen flex-col">
      {/* Top Bar — hidden in fullscreen for immersive reading */}
      {!fullscreen && (
      <header
        className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b px-3 backdrop-blur"
        style={{ background: 'color-mix(in srgb, var(--reader-bg) 88%, transparent)' }}
      >
        <Button variant="ghost" size="sm" onClick={closeBook} className="gap-1.5">
          <ArrowLeft className="h-4 w-4" />
          <span className="hidden sm:inline">Библиотека</span>
        </Button>

        <div className="flex-1 min-w-0 px-2">
          <p className="truncate text-sm font-medium" style={{ color: 'var(--reader-fg)' }}>
            {book.title}
          </p>
          <p className="truncate text-xs opacity-70" style={{ color: 'var(--reader-fg)' }}>
            {book.author}
          </p>
          <BookRating bookId={book.id} currentRating={book.rating} />
        </div>

        <div className="flex items-center gap-1">
          {book.format !== 'mp3' && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setSearchOpen(true)}
              aria-label="Поиск"
              title="Поиск (Ctrl+F)"
            >
              <Search className="h-4 w-4" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => openSidebar('toc')}
            aria-label="Оглавление"
            title="Оглавление"
          >
            <List className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => openSidebar('bookmarks')}
            aria-label="Закладки"
            title="Закладки"
          >
            <BookmarkPlus className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => openSidebar('highlights')}
            aria-label="Выделения"
            title="Выделения"
          >
            <Highlighter className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => openSidebar('notes')}
            aria-label="Заметки"
            title="Заметки"
          >
            <StickyNote className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              setSettingsOpen(!settingsOpen)
              setTocOpen(false)
              setBookmarksOpen(false)
            }}
            aria-label="Настройки"
            title="Настройки"
          >
            <Settings2 className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleFullscreen}
            aria-label={fullscreen ? 'Выйти из полноэкранного режима' : 'Полноэкранный режим'}
            title={fullscreen ? 'Выйти из полноэкранного режима (F)' : 'Полноэкранный режим (F)'}
            className="hidden sm:flex"
          >
            {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setHelpOpen(true)}
            aria-label="Горячие клавиши"
            title="Горячие клавиши (?)"
            className="hidden sm:flex"
          >
            <Keyboard className="h-4 w-4" />
          </Button>
        </div>
      </header>
      )}

      {/* Reader body */}
      <div className="flex-1">
        {book.format === 'epub' ? (
          <EpubReader book={book} onProgress={handleProgressChange} />
        ) : book.format === 'pdf' ? (
          <PdfReader book={book} onProgress={handleProgressChange} />
        ) : book.format === 'mp3' ? (
          <AudioReader book={book} onProgress={handleProgressChange} />
        ) : book.format === 'html' ? (
          <HtmlReader book={book} onProgress={handleProgressChange} />
        ) : book.format === 'cbz' ? (
          <CbzReader book={book} onProgress={handleProgressChange} />
        ) : (
          <TxtReader book={book} onProgress={handleProgressChange} />
        )}
      </div>

      {/* Floating exit-fullscreen button */}
      {fullscreen && (
        <Button
          variant="outline"
          size="icon"
          onClick={toggleFullscreen}
          className="fixed right-4 top-4 z-50 h-10 w-10 rounded-full shadow-lg"
          aria-label="Выйти из полноэкранного режима"
          title="Выйти из полноэкранного режима (F)"
        >
          <Minimize2 className="h-4 w-4" />
        </Button>
      )}

      {/* Bottom progress bar — hidden in fullscreen for immersive reading */}
      {!fullscreen && (
      <footer
        className="sticky bottom-0 z-30 flex h-12 items-center gap-3 border-t px-4 backdrop-blur"
        style={{ background: 'color-mix(in srgb, var(--reader-bg) 88%, transparent)' }}
      >
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setView('stats')}
          className="text-xs gap-1.5"
          style={{ color: 'var(--reader-fg)' }}
        >
          <span className="tabular-nums">{Math.round(progress * 100)}%</span>
        </Button>
        <div className="flex-1 h-1.5 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden">
          <div
            className="h-full bg-primary transition-all"
            style={{ width: `${Math.max(2, progress * 100)}%` }}
          />
        </div>
        {estimatedRemainingMinutes !== null && estimatedRemainingMinutes > 0 && (
          <span className="text-xs tabular-nums" style={{ color: 'var(--reader-fg)' }}>
            Осталось: {formatMinutes(estimatedRemainingMinutes)}
          </span>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setHelpOpen(true)}
          className="text-xs hidden sm:flex"
          style={{ color: 'var(--reader-fg)' }}
        >
          ?
        </Button>
      </footer>
      )}

      {/* Settings Sheet */}
      <Sheet open={settingsOpen} onOpenChange={setSettingsOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Настройки чтения</SheetTitle>
          </SheetHeader>
          <ReaderSettingsPanel />
        </SheetContent>
      </Sheet>

      {/* TOC Sheet (also used for highlights) */}
      <Sheet open={tocOpen} onOpenChange={setTocOpen}>
        <SheetContent side="left" className="w-full sm:max-w-md overflow-y-auto">
            <SheetHeader>
              <SheetTitle>
                {activeTab === 'highlights' ? 'Выделения' : activeTab === 'notes' ? 'Заметки' : 'Оглавление'}
              </SheetTitle>
            </SheetHeader>
          {activeTab === 'highlights' ? (
            <HighlightsPanel book={book} onNavigate={() => setTocOpen(false)} />
          ) : activeTab === 'notes' ? (
            <NotesPanel book={book} />
          ) : (
            <TocPanel book={book} onNavigate={() => setTocOpen(false)} />
          )}
        </SheetContent>
      </Sheet>

      {/* Bookmarks Sheet */}
      <Sheet open={bookmarksOpen} onOpenChange={setBookmarksOpen}>
        <SheetContent side="left" className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Закладки</SheetTitle>
          </SheetHeader>
          <BookmarksPanel
            book={book}
            currentCfi={currentCfi}
            currentTextPosition={currentTextPosition}
            currentPdfPage={currentPdfPage}
            onNavigate={() => setBookmarksOpen(false)}
          />
        </SheetContent>
      </Sheet>

      {/* Search Dialog */}
      <SearchDialog book={book} />

      {/* Shortcuts Help */}
      <ShortcutsHelp open={helpOpen} onOpenChange={setHelpOpen} />
    </div>
  )
}
