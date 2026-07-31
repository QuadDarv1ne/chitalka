'use client'

import { memo, useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  BookOpen,
  Upload,
  Search,
  Trash2,
  FileText,
  BookMarked,
  Library as LibraryIcon,
  Sun,
  Moon,
  Coffee,
  Contrast,
  SortDesc,
  BarChart3,
  FileType,
  X,
  UploadCloud,
  Download,
  Loader2,
} from 'lucide-react'
import {
  getAllBooks,
  saveBook,
  deleteBook,
  reassignBooksToUser,
  type BookRecord,
} from '@/lib/library'
import {
  detectFormat,
  parseEpubMeta,
  parseTextMeta,
  parsePdfMeta,
  parseFb2Meta,
  parseFb2Content,
} from '@/lib/book-parser'
import { useReaderStore, type Theme } from '@/store/reader-store'
import { useAuth } from '@/hooks/use-auth'
import { useBookSync } from '@/hooks/use-book-sync'
import { toast } from 'sonner'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { motion, AnimatePresence } from 'framer-motion'
import { exportLibraryBackup } from '@/lib/export-utils'
import { UserMenu } from '@/components/auth/user-menu'

type SortKey = 'recent' | 'title' | 'added'
type FormatFilter = 'all' | 'epub' | 'pdf' | 'txt' | 'md' | 'fb2' | 'html'

const MAX_FILE_SIZE = 200 * 1024 * 1024 // 200 MB

export function Library() {
  const [books, setBooks] = useState<BookRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortKey>('recent')
  const [formatFilter, setFormatFilter] = useState<FormatFilter>('all')
  const [dragOver, setDragOver] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<BookRecord | null>(null)
  const [deleting, setDeleting] = useState(false)
  const dragDepth = useRef(0)
  const fileInput = useRef<HTMLInputElement>(null)
  const openBook = useReaderStore((s) => s.openBook)
  const setView = useReaderStore((s) => s.setView)
  const setTheme = useReaderStore((s) => s.setTheme)
  const theme = useReaderStore((s) => s.settings.theme)
  const highlights = useReaderStore((s) => s.highlights)
  const sessions = useReaderStore((s) => s.sessions)
  const settings = useReaderStore((s) => s.settings)
  const bookmarks = useReaderStore((s) => s.bookmarks)
  const removeBookData = useReaderStore((s) => s.removeBookData)
  const { user } = useAuth()
  const userId = user?.id ?? null

  // Sync book progress to server (when user is verified)
  useBookSync(books)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const all = await getAllBooks(userId)
      setBooks(all)
    } catch (e) {
      console.error(e)
      toast.error('Не удалось загрузить библиотеку')
    } finally {
      setLoading(false)
    }
  }, [userId])

  useEffect(() => {
    refresh()
  }, [refresh])

  // When user logs in, reassign anonymous books to their account (one-time)
  const reassignedRef = useRef(false)
  useEffect(() => {
    if (!user) {
      // Reset so the next login reassigns books imported while logged out
      reassignedRef.current = false
      return
    }
    if (reassignedRef.current) return
    reassignedRef.current = true
    ;(async () => {
      const count = await reassignBooksToUser(null, user.id)
      if (count > 0) {
        toast.success(`Привязано книг к аккаунту: ${count}`)
        refresh()
      }
    })()
  }, [user?.id, refresh, user])

  const handleFiles = useCallback(
    async (files: FileList) => {
      const list = Array.from(files)
      let imported = 0
      let skipped = 0
      for (const file of list) {
        if (file.size > MAX_FILE_SIZE) {
          toast.error(`Файл слишком большой (макс. ${Math.round(MAX_FILE_SIZE / 1024 / 1024)} МБ): ${file.name}`)
          continue
        }
        const format = detectFormat(file.name)
        if (!format) {
          toast.error(`Формат не поддерживается: ${file.name}`)
          continue
        }
        try {
          let meta
          let blob: Blob = file
          if (format === 'epub') {
            meta = await parseEpubMeta(file)
          } else if (format === 'pdf') {
            meta = await parsePdfMeta(file)
          } else if (format === 'fb2') {
            meta = await parseFb2Meta(file)
            // Convert FB2 to text and store as text blob for TxtReader
            const textContent = await parseFb2Content(file)
            if (textContent) {
              blob = new Blob([textContent], { type: 'text/plain' })
            }
          } else {
            meta = await parseTextMeta(file, format)
          }
          // Skip duplicates already in the library (same title + size)
          const existing = await getAllBooks(userId)
          if (existing.some((b) => b.title === meta.title && b.size === file.size)) {
            skipped++
            continue
          }
          const book: BookRecord = {
            id: crypto.randomUUID(),
            title: meta.title,
            author: meta.author,
            format,
            size: file.size,
            cover: meta.cover,
            description: meta.description,
            blob,
            addedAt: Date.now(),
            userId,
          }
          await saveBook(book)
          imported++
        } catch (e) {
          console.error(e)
          toast.error(`Ошибка импорта: ${file.name}`)
        }
      }
      if (imported > 0) {
        toast.success(`Импортировано книг: ${imported}`)
        await refresh()
      } else if (skipped > 0) {
        toast.info(`Пропущено дубликатов: ${skipped}`)
      }
    },
    [refresh, userId],
  )

  const handleDelete = useCallback(
    async (id: string, title: string) => {
      setDeleting(true)
      try {
        await deleteBook(id)
        removeBookData(id)
        toast.success(`Удалено: ${title}`)
        await refresh()
      } finally {
        setDeleting(false)
        setDeleteTarget(null)
      }
    },
    [refresh, removeBookData],
  )

  const filtered = useMemo(() => books
    .filter((b) => formatFilter === 'all' || b.format === formatFilter)
    .filter(
      (b) =>
        b.title.toLowerCase().includes(search.toLowerCase()) ||
        b.author.toLowerCase().includes(search.toLowerCase()),
    )
    .sort((a, b) => {
      if (sort === 'title') return a.title.localeCompare(b.title, 'ru')
      if (sort === 'added') return b.addedAt - a.addedAt
      return (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0)
    }), [books, formatFilter, search, sort])

  const stats = {
    total: books.length,
    recent: books.filter((b) => b.lastOpenedAt).length,
    totalPages: sessions.reduce((s, sess) => s + sess.pages, 0),
    totalMinutes: sessions.reduce((s, sess) => s + sess.minutes, 0),
    highlights: highlights.length,
  }

  const formatCounts = books.reduce(
    (acc, b) => {
      acc[b.format] = (acc[b.format] ?? 0) + 1
      return acc
    },
    {} as Record<string, number>,
  )

  // Continue reading: most recent opened book with progress
  const continueReading = useMemo(
    () =>
      books
        .filter((b) => b.lastOpenedAt && (b.progress ?? 0) > 0 && (b.progress ?? 0) < 0.99)
        .sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0))
        .slice(0, 4),
    [books],
  )

  return (
    <div
      className="flex min-h-screen flex-col"
      onDragEnter={(e) => {
        e.preventDefault()
        dragDepth.current += 1
        setDragOver(true)
      }}
      onDragOver={(e) => {
        e.preventDefault()
      }}
      onDragLeave={(e) => {
        e.preventDefault()
        dragDepth.current = Math.max(0, dragDepth.current - 1)
        if (dragDepth.current === 0) setDragOver(false)
      }}
      onDragEnd={(e) => {
        e.preventDefault()
        dragDepth.current = 0
        setDragOver(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        dragDepth.current = 0
        setDragOver(false)
        if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files)
      }}
    >
      {/* Drag overlay */}
      <AnimatePresence>
        {dragOver && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-primary/10 backdrop-blur-sm pointer-events-none"
          >
            <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-primary bg-background p-12">
              <UploadCloud className="h-12 w-12 text-primary" />
              <p className="text-lg font-medium">Отпустите файлы для загрузки</p>
              <p className="text-sm text-muted-foreground">EPUB, PDF, FB2, TXT, Markdown, HTML</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto flex h-16 items-center gap-2 md:gap-4 px-4 md:px-8">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <BookOpen className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-semibold leading-none">Читалка</h1>
              <p className="text-xs text-muted-foreground mt-0.5">Локальная библиотека</p>
            </div>
          </div>

          <div className="flex flex-1 items-center gap-2 md:gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Поиск по названию или автору..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 pr-9"
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            <Button
              variant="outline"
              size="icon"
              onClick={() => setView('stats')}
              aria-label="Статистика"
              title="Статистика чтения"
            >
              <BarChart3 className="h-4 w-4" />
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon">
                  <SortDesc className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Сортировка</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => setSort('recent')}>
                  Недавно открытые
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setSort('added')}>
                  По дате добавления
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setSort('title')}>
                  По названию
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Формат</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => setFormatFilter('all')}>
                  Все форматы
                </DropdownMenuItem>
                {(['epub', 'pdf', 'fb2', 'txt', 'md', 'html'] as FormatFilter[]).map((f) => (
                  <DropdownMenuItem key={f} onClick={() => setFormatFilter(f)}>
                    {f.toUpperCase()} {formatCounts[f] ? `(${formatCounts[f]})` : ''}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={async () => {
                    try {
                      await exportLibraryBackup(
                        () => getAllBooks(userId),
                        settings,
                        bookmarks,
                        highlights,
                        sessions,
                      )
                      toast.success('Резервная копия создана')
                    } catch (e) {
                      console.error(e)
                      toast.error('Ошибка экспорта')
                    }
                  }}
                >
                  <Download className="h-4 w-4 mr-2" />
                  Сохранить копию (JSON)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <ThemeSwitcher value={theme} onChange={setTheme} />

            <UserMenu />

            <Button onClick={() => fileInput.current?.click()} className="gap-2">
              <Upload className="h-4 w-4" />
              <span className="hidden sm:inline">Добавить книгу</span>
            </Button>
            <input
              ref={fileInput}
              type="file"
              accept=".epub,.pdf,.fb2,.txt,.md,.html,.htm"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) handleFiles(e.target.files)
                e.target.value = ''
              }}
            />
          </div>
        </div>
      </header>

      {/* Content */}
      <div className="container mx-auto flex-1 px-4 md:px-8 py-8">
        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="aspect-[2/3] animate-pulse rounded-lg bg-muted" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            hasBooks={books.length > 0}
            onImport={() => fileInput.current?.click()}
          />
        ) : (
          <>
            {/* Continue Reading section */}
            {continueReading.length > 0 && (
              <div className="mb-10">
                <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <BookOpen className="h-5 w-5" />
                  Продолжить чтение
                </h2>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {continueReading.map((book) => (
                    <ContinueReadingCard
                      key={book.id}
                      book={book}
                      onClick={() => openBook(book.id)}
                    />
                  ))}
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <LibraryIcon className="h-4 w-4" /> {stats.total} книг
                </span>
                <span className="flex items-center gap-1.5">
                  <BookMarked className="h-4 w-4" /> {stats.recent} в чтении
                </span>
                <span className="hidden md:flex items-center gap-1.5">
                  <FileType className="h-4 w-4" /> {stats.highlights} выделений
                </span>
              </div>
              {formatFilter !== 'all' && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setFormatFilter('all')}
                  className="gap-1 text-xs"
                >
                  <X className="h-3 w-3" />
                  Сбросить фильтр: {formatFilter.toUpperCase()}
                </Button>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 md:gap-6">
              {filtered.map((book) => (
                <BookCard
                  key={book.id}
                  book={book}
                  onOpen={() => openBook(book.id)}
                  onDelete={() => setDeleteTarget(book)}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* Footer */}
      <footer className="border-t mt-auto">
        <div className="container mx-auto px-4 md:px-8 py-4 text-xs text-muted-foreground">
          Все книги хранятся локально в вашем браузере. Поддерживаются EPUB, PDF, FB2, TXT, Markdown, HTML.
          Перетащите файлы в окно для загрузки.
        </div>
      </footer>

      {/* Delete confirmation */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && !deleting && setDeleteTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Удалить книгу?</DialogTitle>
            <DialogDescription>
              «{deleteTarget?.title}» будет удалена из библиотеки вместе с закладками,
              выделениями и статистикой чтения. Это действие нельзя отменить.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              disabled={deleting}
            >
              Отмена
            </Button>
            <Button
              variant="destructive"
              disabled={deleting}
              onClick={() => deleteTarget && handleDelete(deleteTarget.id, deleteTarget.title)}
            >
              {deleting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Удалить
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

const ContinueReadingCard = memo(function ContinueReadingCard({
  book,
  onClick,
}: {
  book: BookRecord
  onClick: () => void
}) {
  const progress = book.progress ?? 0
  return (
    <button
      onClick={onClick}
      className="group flex items-center gap-3 rounded-lg border p-3 hover:shadow-md transition-all text-left"
    >
      <div className="h-16 w-12 bg-muted rounded overflow-hidden flex-shrink-0">
        {book.cover ? (
          <img
            src={book.cover}
            alt={book.title}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <FileText className="h-6 w-6 text-muted-foreground/50" />
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium line-clamp-1">{book.title}</p>
        <p className="text-xs text-muted-foreground line-clamp-1">{book.author}</p>
        <div className="mt-1.5 flex items-center gap-2">
          <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-primary"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
          <span className="text-xs tabular-nums text-muted-foreground">
            {Math.round(progress * 100)}%
          </span>
        </div>
      </div>
    </button>
  )
})

const BookCard = memo(function BookCard({
  book,
  onOpen,
  onDelete,
}: {
  book: BookRecord
  onOpen: () => void
  onDelete: () => void
}) {
  const formatBadge: Record<string, { label: string; color: string }> = {
    epub: { label: 'EPUB', color: 'bg-green-600 text-white' },
    pdf: { label: 'PDF', color: 'bg-red-600 text-white' },
    txt: { label: 'TXT', color: 'bg-blue-600 text-white' },
    md: { label: 'MD', color: 'bg-purple-600 text-white' },
    html: { label: 'HTML', color: 'bg-orange-600 text-white' },
    fb2: { label: 'FB2', color: 'bg-cyan-600 text-white' },
  }
  const badge = formatBadge[book.format]

  return (
    <Card className="group relative overflow-hidden p-0 cursor-pointer hover:shadow-lg transition-all hover:-translate-y-1 duration-200" onClick={onOpen}>
      <div className="aspect-[2/3] relative bg-muted overflow-hidden">
        {book.cover ? (
          <img
            src={book.cover}
            alt={book.title}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-4 text-center bg-gradient-to-br from-primary/5 to-primary/10">
            <FileText className="h-12 w-12 text-muted-foreground/60" />
            <span className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
              {book.format}
            </span>
          </div>
        )}
        <div className={`absolute top-2 left-2 rounded px-1.5 py-0.5 text-[10px] font-bold ${badge.color}`}>
          {badge.label}
        </div>
        {book.progress !== undefined && book.progress > 0 && (
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/20">
            <div
              className="h-full bg-primary"
              style={{ width: `${Math.round(book.progress * 100)}%` }}
            />
          </div>
        )}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
          <Button size="sm" variant="secondary">
            <BookOpen className="h-4 w-4 mr-1.5" /> Открыть
          </Button>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
          className="absolute top-2 right-2 h-8 w-8 rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center hover:bg-destructive"
          aria-label="Удалить"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
      <div className="p-3">
        <h3 className="font-medium text-sm line-clamp-2 leading-snug" title={book.title}>
          {book.title}
        </h3>
        <p className="text-xs text-muted-foreground mt-1 line-clamp-1">
          {book.author}
        </p>
      </div>
    </Card>
  )
})

const EmptyState = memo(function EmptyState({ hasBooks, onImport }: { hasBooks: boolean; onImport: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-muted mb-6">
        <BookOpen className="h-10 w-10 text-muted-foreground" />
      </div>
      <h2 className="text-2xl font-semibold mb-2">
        {hasBooks ? 'Ничего не найдено' : 'Библиотека пуста'}
      </h2>
      <p className="text-muted-foreground max-w-md mb-6">
        {hasBooks
          ? 'Попробуйте изменить поисковый запрос или сбросить фильтры.'
          : 'Добавьте свои книги в форматах EPUB, PDF, TXT, Markdown или HTML. Все файлы сохраняются локально в браузере.'}
      </p>
      {!hasBooks && (
        <Button onClick={onImport} size="lg" className="gap-2">
          <Upload className="h-5 w-5" /> Добавить первую книгу
        </Button>
      )}
    </div>
  )
})

const ThemeSwitcher = memo(function ThemeSwitcher({ value, onChange }: { value: Theme; onChange: (t: Theme) => void }) {
  const themes: { key: Theme; label: string; icon: React.ReactNode }[] = [
    { key: 'light', label: 'Светлая', icon: <Sun className="h-4 w-4" /> },
    { key: 'sepia', label: 'Сепия', icon: <Coffee className="h-4 w-4" /> },
    { key: 'dark', label: 'Тёмная', icon: <Moon className="h-4 w-4" /> },
    { key: 'contrast', label: 'Контраст', icon: <Contrast className="h-4 w-4" /> },
  ]
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon">
          {themes.find((t) => t.key === value)?.icon}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {themes.map((t) => (
          <DropdownMenuItem key={t.key} onClick={() => onChange(t.key)}>
            <span className="flex items-center gap-2">
              {t.icon} {t.label}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
})
