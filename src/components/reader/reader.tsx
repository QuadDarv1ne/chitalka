'use client'

import { useEffect, useState, useCallback } from 'react'
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
} from 'lucide-react'
import { useReaderStore } from '@/store/reader-store'
import { getBook, updateBook, type BookRecord } from '@/lib/library'
import { EpubReader } from './epub-reader'
import { TxtReader } from './txt-reader'
import { PdfReader } from './pdf-reader'
import { ReaderSettingsPanel } from './settings-panel'
import { TocPanel } from './toc-panel'
import { BookmarksPanel } from './bookmarks-panel'
import { HighlightsPanel } from './highlights-panel'
import { SearchDialog } from './search-dialog'
import { ShortcutsHelp } from './shortcuts-help'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { toast } from 'sonner'

type SidebarTab = 'toc' | 'bookmarks' | 'highlights'

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
  const [book, setBook] = useState<BookRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [progress, setProgress] = useState(0)
  const [activeTab, setActiveTab] = useState<SidebarTab>('toc')
  const [helpOpen, setHelpOpen] = useState(false)

  useEffect(() => {
    if (!currentBookId) return
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    getBook(currentBookId)
      .then((b) => {
        if (cancelled) return
        setBook(b ?? null)
        setProgress(b?.progress ?? 0)
        if (b) {
          updateBook(b.id, { lastOpenedAt: Date.now() })
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [currentBookId])

  const handleProgressChange = useCallback(
    async (p: number, extra?: { cfi?: string; textPosition?: number; pdfPage?: number }) => {
      setProgress(p)
      if (!book) return
      await updateBook(book.id, {
        progress: p,
        cfi: extra?.cfi ?? book.cfi,
        textPosition: extra?.textPosition ?? book.textPosition,
        pdfPage: extra?.pdfPage ?? book.pdfPage,
      })
    },
    [book],
  )

  // Global keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault()
        setSearchOpen(true)
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
        e.preventDefault()
        // Add bookmark at current position - just dispatch
        toast.info('Используйте панель закладок для добавления')
        setBookmarksOpen(true)
        setActiveTab('bookmarks')
      } else if (e.key === '?') {
        setHelpOpen(true)
      } else if (e.key === 'Escape') {
        setHelpOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setSearchOpen, setBookmarksOpen])

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
    setBookmarksOpen(false)
    setTocOpen(false)
    if (tab === 'toc') setTocOpen(true)
    else if (tab === 'bookmarks') setBookmarksOpen(true)
    else if (tab === 'highlights') {
      // Use tocOpen sheet but with highlights content
      setTocOpen(true)
    }
    setSettingsOpen(false)
  }

  return (
    <div className="relative flex min-h-screen flex-col">
      {/* Top Bar */}
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
        </div>

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSearchOpen(true)}
            aria-label="Поиск"
            title="Поиск (Ctrl+F)"
          >
            <Search className="h-4 w-4" />
          </Button>
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
            onClick={() => setHelpOpen(true)}
            aria-label="Горячие клавиши"
            title="Горячие клавиши (?)"
            className="hidden sm:flex"
          >
            <Keyboard className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {/* Reader body */}
      <div className="flex-1">
        {book.format === 'epub' ? (
          <EpubReader book={book} onProgress={handleProgressChange} />
        ) : book.format === 'pdf' ? (
          <PdfReader book={book} onProgress={handleProgressChange} />
        ) : (
          <TxtReader book={book} onProgress={handleProgressChange} />
        )}
      </div>

      {/* Bottom progress bar */}
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
              {activeTab === 'highlights' ? 'Выделения' : 'Оглавление'}
            </SheetTitle>
          </SheetHeader>
          {activeTab === 'highlights' ? (
            <HighlightsPanel book={book} onNavigate={() => setTocOpen(false)} />
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
          <BookmarksPanel book={book} onNavigate={() => setBookmarksOpen(false)} />
        </SheetContent>
      </Sheet>

      {/* Search Dialog */}
      <SearchDialog book={book} />

      {/* Shortcuts Help */}
      <ShortcutsHelp open={helpOpen} onOpenChange={setHelpOpen} />
    </div>
  )
}
