'use client'

import { logger } from '@/lib/logger'
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
  FolderOpen,
  Info,
  CalendarDays,
  HardDrive,
  BookOpenCheck,
  Target,
  Flame,
  Check,
  Star,
  RotateCcw,
  Dices,
  Link2,
  Heart,
  Pencil,
  RefreshCw,
  AlertTriangle,
  Plus,
} from 'lucide-react'
import {
  getAllBooks,
  getBook,
  saveBook,
  deleteBook,
  updateBook,
  reassignBooksToUser,
  hashFileHead,
  toggleFavorite,
  getAllTags,
  type BookRecord,
} from '@/lib/library'
import {
  detectFormat,
  parseEpubMeta,
  parseTextMeta,
  parsePdfMeta,
  parseFb2Meta,
  parseFb2Content,
  parseAudioMeta,
  type ParsedBook as ParsedMeta,
} from '@/lib/book-parser'
import {
  useReaderStore,
  type Theme,
  type Bookmark,
  type Highlight,
  type ReadingSession,
  localDateString,
} from '@/store/reader-store'
import { getWordsPerMinute } from '@/store/reader-store'
import { missingMetadata } from '@/lib/meta-status'
import { estimateRemainingMinutes, formatMinutes } from '@/lib/constants'
import { useAuth } from '@/hooks/use-auth'
import { useBookSync, useServerBookSync } from '@/hooks/use-book-sync'
import { toast } from 'sonner'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { motion, AnimatePresence } from 'framer-motion'
import { exportLibraryBackup, parseLibraryBackup, downloadBookFile } from '@/lib/export-utils'
import { UserMenu } from '@/components/auth/user-menu'
import { CollectionImport } from './collection-import'
import { UrlImportDialog } from './url-import'

type SortKey = 'recent' | 'title' | 'added' | 'progress' | 'rating'
type FormatFilter = 'all' | 'epub' | 'pdf' | 'txt' | 'md' | 'fb2' | 'html' | 'mp3' | 'cbz'
type StatusFilter = 'all' | 'reading' | 'finished'
type FavoriteFilter = 'all' | 'favorites'

const MAX_FILE_SIZE = 500 * 1024 * 1024 // 500 MB (includes large audiobooks)

const FORMAT_BADGES: Record<string, { label: string; color: string }> = {
  epub: { label: 'EPUB', color: 'bg-green-600 text-white' },
  pdf: { label: 'PDF', color: 'bg-red-600 text-white' },
  txt: { label: 'TXT', color: 'bg-blue-600 text-white' },
  md: { label: 'MD', color: 'bg-purple-600 text-white' },
  html: { label: 'HTML', color: 'bg-orange-600 text-white' },
  fb2: { label: 'FB2', color: 'bg-cyan-600 text-white' },
  mp3: { label: 'MP3', color: 'bg-amber-600 text-white' },
  cbz: { label: 'CBZ', color: 'bg-pink-600 text-white' },
}

const isFinished = (progress?: number) => progress !== undefined && progress >= 0.99

// Russian plural agreement: 1 книга, 2 книги, 5 книг.
function plural(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return forms[0]
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1]
  return forms[2]
}

function formatCount(n: number, forms: [string, string, string]): string {
  return `${n} ${plural(n, forms)}`
}

export function Library() {
  const [books, setBooks] = useState<BookRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortKey>('recent')
  const [formatFilter, setFormatFilter] = useState<FormatFilter>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [favoriteFilter, setFavoriteFilter] = useState<FavoriteFilter>('all')
  const [tagFilter, setTagFilter] = useState<string>('all')
  const [allTags, setAllTags] = useState<string[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<BookRecord | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [collectionOpen, setCollectionOpen] = useState(false)
  const [urlImportOpen, setUrlImportOpen] = useState(false)
  const [detailsTarget, setDetailsTarget] = useState<BookRecord | null>(null)
  const dragDepth = useRef(0)
  const fileInput = useRef<HTMLInputElement>(null)
  const openBook = useReaderStore((s) => s.openBook)
  const setView = useReaderStore((s) => s.setView)
  const setTheme = useReaderStore((s) => s.setTheme)
  const theme = useReaderStore((s) => s.settings.theme)
  const highlights = useReaderStore((s) => s.highlights)
  const notes = useReaderStore((s) => s.notes)
  const sessions = useReaderStore((s) => s.sessions)
  const settings = useReaderStore((s) => s.settings)
  const bookmarks = useReaderStore((s) => s.bookmarks)
  const removeBookData = useReaderStore((s) => s.removeBookData)
  const restoreData = useReaderStore((s) => s.restoreData)
  const { user } = useAuth()
  const userId = user?.id ?? null
  const restoreInput = useRef<HTMLInputElement>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [all, tags] = await Promise.all([
        getAllBooks(userId),
        getAllTags(userId),
      ])
      setBooks(all)
      setAllTags(tags)
    } catch (e) {
      logger.error(e)
      toast.error('Не удалось загрузить библиотеку')
    } finally {
      setLoading(false)
    }
  }, [userId])

  // Sync book progress to server (when user is verified)
  useBookSync(books)

  // Pull server-side book metadata into local IndexedDB
  useServerBookSync(refresh)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh()
  }, [refresh])

  // When user logs in, reassign anonymous books to their account (one-time)
  const reassignedRef = useRef(false)

  // "/" focuses the search field from anywhere (unless already typing in a field)
  const searchRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return
      const el = document.activeElement as HTMLElement | null
      const tag = el?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || el?.isContentEditable) return
      if (!searchRef.current) return
      e.preventDefault()
      searchRef.current.focus()
      searchRef.current.select()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  useEffect(() => {
    if (!user) {
      // Reset so the next login reassigns books imported while logged out
      reassignedRef.current = false
      return
    }
    if (reassignedRef.current) return
    reassignedRef.current = true
    ;(async () => {
      try {
        const count = await reassignBooksToUser(null, user.id)
        if (count > 0) {
          toast.success(`Привязано книг к аккаунту: ${count}`)
          refresh()
        }
      } catch (e) {
        logger.error('Failed to reassign books', e)
      }
    })()
  }, [user?.id, refresh, user])

  const importFiles = useCallback(
    async (list: File[]) => {
      let imported = 0
      let skipped = 0
      let failed = 0
      // Show a loading toast to give feedback during batch import
      const toastId = toast.loading(
        `Импорт ${list.length} файл(ов)…`,
        { duration: Infinity },
      )
      try {
        // Fetch existing books once so the loop below doesn't hit IndexedDB per file
        const existing = await getAllBooks(userId)
        // Dedupe by a short hash of the file head (cheap, avoids title+size collisions)
        const existingHashes = new Set(
          await Promise.all(existing.map(async (b) => {
            try {
              return await hashFileHead(b.blob)
            } catch {
              return `${b.title}\u0000${b.size}`
            }
          })),
        )
        // Import files with bounded concurrency (3 at a time)
        const queue = [...list]
        const workers = Array.from({ length: Math.min(3, queue.length) }, async () => {
          while (queue.length > 0) {
            const file = queue.shift()!
            if (file.size > MAX_FILE_SIZE) {
              toast.error(`Файл слишком большой (макс. ${Math.round(MAX_FILE_SIZE / 1024 / 1024)} МБ): ${file.name}`)
              failed++
              continue
            }
            const format = detectFormat(file.name)
            if (!format) {
              toast.error(`Формат не поддерживается: ${file.name}`)
              failed++
              continue
            }
            try {
              // FB2 is stored as converted plain text, so dedupe against the
              // converted text — hashing the raw XML head never matches the
              // stored blob and the same book always imports twice.
              let dedupeBlob: Blob = file
              if (format === 'fb2') {
                const textContent = await parseFb2Content(file)
                if (!textContent) {
                  toast.error(`Не удалось извлечь текст: ${file.name}`)
                  failed++
                  continue
                }
                dedupeBlob = new Blob([textContent], { type: 'text/plain' })
              }
              const headHash = await hashFileHead(dedupeBlob)
              if (existingHashes.has(headHash)) {
                skipped++
                continue
              }
              let meta
              let blob: Blob = file
              if (format === 'epub') {
                meta = await parseEpubMeta(file)
              } else if (format === 'pdf') {
                meta = await parsePdfMeta(file)
              } else if (format === 'fb2') {
                meta = await parseFb2Meta(file)
                blob = dedupeBlob
              } else if (format === 'mp3') {
                meta = await parseAudioMeta(file)
              } else {
                meta = await parseTextMeta(file, format)
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
                parsedAt: Date.now(),
                // Kept so a later re-parse can fall back to the same file
                // name the metadata was originally derived from.
                sourceName: file.name,
                userId,
              }
              await saveBook(book)
              existingHashes.add(headHash)
              imported++
            } catch (e) {
              logger.error(e)
              toast.error(`Ошибка импорта: ${file.name}`)
              failed++
            }
          }
        })
        await Promise.all(workers)
      } catch (e) {
        logger.error(e)
        toast.error('Ошибка при чтении библиотеки')
      }
      if (imported > 0) {
        toast.success(`Импортировано книг: ${imported}`, { id: toastId })
        await refresh()
      } else if (skipped > 0) {
        toast.info(`Пропущено дубликатов: ${skipped}`, { id: toastId })
      } else if (failed > 0) {
        toast.error('Ничего не импортировано', { id: toastId })
      }
    },
    [refresh, userId],
  )

  const handleFiles = useCallback(
    (files: FileList | File[]) => {
      void importFiles(Array.from(files))
    },
    [importFiles],
  )

  // Open a random book — prefers unread / in-progress books so the
  // Random book button is useful beyond the first week of use.
  const openRandomBook = useCallback(() => {
    if (books.length === 0) return
    const unfinished = books.filter((b) => (b.progress ?? 0) < 0.99)
    const pool = unfinished.length > 0 ? unfinished : books
    const pick = pool[Math.floor(Math.random() * pool.length)]
    if (pick) openBook(pick.id)
  }, [books, openBook])

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

  const handleRate = useCallback(async (id: string, rating: number) => {
    await updateBook(id, { rating }).catch((e) => logger.error('Rating save failed', e))
    setBooks((prev) => prev.map((b) => (b.id === id ? { ...b, rating } : b)))
    toast.success(rating > 0 ? `Оценка: ${rating} из 5` : 'Рейтинг удалён')
  }, [])

  const handleToggleFavorite = useCallback(async (id: string, title: string) => {
    try {
      const isFav = await toggleFavorite(id)
      setBooks((prev) => prev.map((b) => (b.id === id ? { ...b, favorite: isFav } : b)))
      toast.success(isFav ? `${title} добавлена в избранное` : `${title} удалена из избранного`)
    } catch (e) {
      logger.error('Favorite toggle failed', e)
      toast.error('Ошибка изменения избранного')
    }
  }, [])

  const handleResetProgress = useCallback(
    async (id: string, title: string) => {
      await updateBook(id, {
        progress: 0,
        cfi: undefined,
        textPosition: undefined,
        pdfPage: undefined,
        cbzPage: undefined,
        audioTrack: undefined,
        audioTime: undefined,
        lastOpenedAt: undefined,
      }).catch((e) => logger.error('Progress reset failed', e))
      setBooks((prev) => prev.map((b) => (b.id === id ? { ...b, progress: 0, lastOpenedAt: undefined } : b)))
      toast.success(`Прогресс сброшен: ${title}`)
    },
    [],
  )

  /**
   * Re-run the parser on a stored blob.
   *
   * Metadata is parsed once at import time, so a book imported before a parser
   * was fixed keeps its broken title forever. The blob is still on disk, so the
   * fields can be recovered without asking the user to re-add the file.
   */
  const handleReparseMeta = useCallback(async (id: string) => {
    try {
      const stored = await getBook(id)
      if (!stored) {
        toast.error('Файл книги не найден в хранилище')
        return
      }
      // Parsers fall back to the file name when the file has no tags, so the
      // re-parse must see the original name — the current title may already
      // have been human-edited and is not a parseable file name.
      const asFile = new File([stored.blob], stored.sourceName ?? stored.title, {
        type: stored.blob.type,
      })
      let meta: ParsedMeta
      if (stored.format === 'epub') {
        meta = await parseEpubMeta(stored.blob)
      } else if (stored.format === 'pdf') {
        meta = await parsePdfMeta(asFile)
      } else if (stored.format === 'fb2') {
        // FB2 is stored as converted plain text (the original XML is not
        // kept), so there is nothing in the blob for the parser to read —
        // say so instead of silently producing the title back from the name.
        toast.info(
          'FB2 хранится как извлечённый текст — метаданные не перечитать',
          {
            description: 'Чтобы обновить название и обложку, добавьте исходный .fb2 файл заново',
          },
        )
        return
      } else if (stored.format === 'mp3') {
        meta = await parseAudioMeta(asFile)
      } else {
        toast.info('Для этого формата перечитывать нечего')
        return
      }

      const patch: Partial<BookRecord> = {}
      if (meta.title) patch.title = meta.title
      if (meta.author) patch.author = meta.author
      if (meta.cover) patch.cover = meta.cover
      if (meta.description) patch.description = meta.description
      if (Object.keys(patch).length === 0) {
        // Empty result is the usual reason a card still shows a filename as its
        // title, so say what was looked for instead of failing silently.
        toast.info('Новых данных в файле не найдено', {
          description: 'Нет ни тегов, ни обложки — название осталось из имени файла',
        })
        return
      }
      // The file was parsed with the current parsers either way; stamping the
      // date keeps "imported before the parsers were fixed" detectable.
      patch.parsedAt = Date.now()
      await updateBook(id, patch)
      setBooks((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)))
      setDetailsTarget((prev) => (prev && prev.id === id ? { ...prev, ...patch } : prev))
      const what = [patch.title && 'название', patch.author && 'автор', patch.cover && 'обложка']
        .filter(Boolean)
        .join(', ')
      toast.success(`Метаданные обновлены: ${what}`)
    } catch (e) {
      logger.error('Metadata reparse failed', e)
      toast.error('Не удалось перечитать метаданные')
    }
  }, [])

  const handleRestore = useCallback(
    async (files: FileList | null) => {
      const file = files?.[0]
      if (!file) return
      try {
        const backup = await parseLibraryBackup(file)
        restoreData({
          settings: backup.settings,
          bookmarks: backup.bookmarks,
          highlights: backup.highlights,
          notes: backup.notes ?? [],
          sessions: backup.sessions,
        })
        let serverImported = 0
        if (user?.emailVerified) {
          const res = await fetch('/api/user/import', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ backup }),
          })
          const data = await res.json().catch(() => ({}))
          if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
          serverImported = data.imported ?? 0
        }
        toast.success(
          `Восстановлено: закладок ${backup.bookmarks.length}, выделений ${backup.highlights.length}${serverImported ? `, книг на сервере ${serverImported}` : ''}`,
        )
        await refresh()
      } catch (e) {
        logger.error(e)
        toast.error(e instanceof Error ? e.message : 'Ошибка восстановления')
      }
    },
    [refresh, restoreData, user],
  )

  const filtered = useMemo(() => books
    .filter((b) => formatFilter === 'all' || b.format === formatFilter)
    .filter((b) => {
      if (statusFilter === 'finished') return isFinished(b.progress)
      if (statusFilter === 'reading') return (b.progress ?? 0) > 0 && !isFinished(b.progress)
      return true
    })
    .filter((b) => {
      if (favoriteFilter === 'favorites') return b.favorite
      return true
    })
    .filter((b) => {
      if (tagFilter !== 'all') return b.tags?.includes(tagFilter)
      return true
    })
    .filter(
      (b) =>
        b.title.toLowerCase().includes(search.toLowerCase()) ||
        b.author.toLowerCase().includes(search.toLowerCase()),
    )
    .sort((a, b) => {
      if (sort === 'title') return a.title.localeCompare(b.title, 'ru')
      if (sort === 'added') return b.addedAt - a.addedAt
      if (sort === 'progress') return (b.progress ?? 0) - (a.progress ?? 0)
      if (sort === 'rating') return (b.rating ?? 0) - (a.rating ?? 0)
      return (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0)
    }), [books, formatFilter, statusFilter, favoriteFilter, tagFilter, search, sort])

  const stats = {
    total: books.length,
    // "В чтении" = books actually started but not finished. Counting every
    // ever-opened book (the previous `recent`) overstated real progress.
    reading: books.filter((b) => (b.progress ?? 0) > 0 && !isFinished(b.progress)).length,
    recent: books.filter((b) => b.lastOpenedAt).length,
    totalPages: sessions.reduce((s, sess) => s + sess.pages, 0),
    totalMinutes: sessions.reduce((s, sess) => s + sess.minutes, 0),
    highlights: highlights.length,
  }

  // Active search constraints, each removable on its own. Also drives the
  // "filters on" indicator of the filter button and the empty-state reset.
  const activeFilters = useMemo(() => {
    const list: { key: string; label: string; clear: () => void }[] = []
    if (search.trim())
      list.push({ key: 'search', label: `Поиск: «${search.trim()}»`, clear: () => setSearch('') })
    if (formatFilter !== 'all')
      list.push({
        key: 'format',
        label: `Формат: ${formatFilter.toUpperCase()}`,
        clear: () => setFormatFilter('all'),
      })
    if (statusFilter !== 'all')
      list.push({
        key: 'status',
        label: statusFilter === 'reading' ? 'В процессе чтения' : 'Завершённые',
        clear: () => setStatusFilter('all'),
      })
    if (favoriteFilter !== 'all')
      list.push({ key: 'favorite', label: 'Только избранные', clear: () => setFavoriteFilter('all') })
    if (tagFilter !== 'all')
      list.push({ key: 'tag', label: `Тег: ${tagFilter}`, clear: () => setTagFilter('all') })
    return list
  }, [search, formatFilter, statusFilter, favoriteFilter, tagFilter])

  const clearAllFilters = useCallback(() => {
    setSearch('')
    setFormatFilter('all')
    setStatusFilter('all')
    setFavoriteFilter('all')
    setTagFilter('all')
  }, [])

  const filtersOn = activeFilters.length > 0

  // Daily reading goal widget (header): today's minutes vs the goal.
  const todayDate = localDateString(new Date())
  const todayMinutes = sessions
    .filter((s) => s.date === todayDate)
    .reduce((sum, s) => sum + s.minutes, 0)
  const goalMinutes = settings.dailyGoalMinutes
  const goalDone = todayMinutes >= goalMinutes

  // Reading streak: consecutive days with at least one session.
  const streak = useMemo(() => {
    let count = 0
    const today = new Date()
    for (let i = 0; i < 365; i++) {
      const d = new Date(today)
      d.setDate(d.getDate() - i)
      const has = sessions.some((s) => s.date === localDateString(d))
      if (has) count++
      else if (i === 0) continue
      else break
    }
    return count
  }, [sessions])

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
            <p className="text-sm font-medium">Отпустите файлы для загрузки</p>
            <p className="text-sm text-muted-foreground">EPUB, PDF, FB2, TXT, Markdown, HTML, MP3</p>
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
                ref={searchRef}
                placeholder="Поиск по названию или автору..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  // Esc clears the query but keeps the field focused
                  if (e.key === 'Escape' && search) {
                    e.stopPropagation()
                    setSearch('')
                  }
                }}
                className="pl-9 pr-16"
                aria-label="Поиск по библиотеке"
              />
              {search ? (
                <button
                  onClick={() => setSearch('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label="Очистить поиск"
                >
                  <X className="h-4 w-4" />
                </button>
              ) : (
                <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded border bg-muted px-1.5 font-mono text-[10px] text-muted-foreground sm:block">
                  /
                </kbd>
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

            <Button
              variant="outline"
              size="icon"
              onClick={openRandomBook}
              disabled={books.length === 0}
              aria-label="Случайная книга"
              title="Случайная книга"
            >
              <Dices className="h-4 w-4" />
            </Button>

            <Button
              variant="outline"
              size="icon"
              onClick={() => setUrlImportOpen(true)}
              aria-label="Добавить по ссылке"
              title="Добавить книгу по ссылке"
            >
              <Link2 className="h-4 w-4" />
            </Button>

            {/* Daily goal pill — shows today's progress vs goal, click → stats */}
            {books.length > 0 && (
              <Button
                variant={goalDone ? 'default' : 'outline'}
                size="sm"
                onClick={() => setView('stats')}
                className="gap-1.5 tabular-nums hidden sm:flex"
                title={`Цель: ${todayMinutes} из ${goalMinutes} мин${streak > 0 ? ` · Серия ${streak} дн.` : ''}`}
              >
                {goalDone ? (
                  <Check className="h-3.5 w-3.5" />
                ) : (
                  <Target className="h-3.5 w-3.5" />
                )}
                {todayMinutes}/{goalMinutes}
                {streak > 0 && <Flame className="h-3.5 w-3.5 text-orange-500" />}
              </Button>
            )}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="relative"
                  aria-label={
                    filtersOn ? `Фильтры (${activeFilters.length} активно)` : 'Фильтры и сортировка'
                  }
                >
                  <SortDesc className="h-4 w-4" />
                  {filtersOn && (
                    <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium text-primary-foreground">
                      {activeFilters.length}
                    </span>
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>Сортировка</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={sort}
                  onValueChange={(v) => setSort(v as SortKey)}
                >
                  <DropdownMenuRadioItem value="recent">
                    Недавно открытые
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="added">
                    По дате добавления
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="title">
                    По названию
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="progress">
                    По прогрессу чтения
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="rating">
                    По оценке
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Формат</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={formatFilter}
                  onValueChange={(v) => setFormatFilter(v as FormatFilter)}
                >
                  <DropdownMenuRadioItem value="all">
                    Все форматы ({books.length})
                  </DropdownMenuRadioItem>
                  {(['epub', 'pdf', 'fb2', 'txt', 'md', 'html', 'mp3', 'cbz'] as FormatFilter[]).map(
                    (f) =>
                      formatCounts[f] ? (
                        <DropdownMenuRadioItem key={f} value={f}>
                          {f.toUpperCase()} ({formatCounts[f]})
                        </DropdownMenuRadioItem>
                      ) : null,
                  )}
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Избранное</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={favoriteFilter}
                  onValueChange={(v) => setFavoriteFilter(v as FavoriteFilter)}
                >
                  <DropdownMenuRadioItem value="all">Все книги</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="favorites">
                    <Heart className="h-4 w-4 mr-2" /> Избранные
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Теги</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={tagFilter}
                  onValueChange={(v) => setTagFilter(v)}
                >
                  <DropdownMenuRadioItem value="all">
                    Все книги ({books.length})
                  </DropdownMenuRadioItem>
                  {allTags.map((tag) => {
                    const count = books.filter((b) => b.tags?.includes(tag)).length
                    return count > 0 ? (
                      <DropdownMenuRadioItem key={tag} value={tag}>
                        {tag} ({count})
                      </DropdownMenuRadioItem>
                    ) : null
                  })}
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Статус</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={statusFilter}
                  onValueChange={(v) => setStatusFilter(v as StatusFilter)}
                >
                  <DropdownMenuRadioItem value="all">Все книги</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="reading">В процессе чтения</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="finished">Завершённые</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => restoreInput.current?.click()}
                >
                  <UploadCloud className="h-4 w-4 mr-2" />
                  Восстановить из копии (JSON)
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={async () => {
                    try {
                      await exportLibraryBackup(
                        () => getAllBooks(userId),
                        settings,
                        bookmarks,
                        highlights,
                        notes,
                        sessions,
                      )
                      toast.success('Резервная копия создана')
                    } catch (e) {
                      logger.error(e)
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

            <Button variant="outline" onClick={() => setCollectionOpen(true)} className="gap-2">
              <FolderOpen className="h-4 w-4" />
              <span className="hidden sm:inline">Коллекция</span>
            </Button>

            <Button onClick={() => fileInput.current?.click()} className="gap-2">
              <Upload className="h-4 w-4" />
              <span className="hidden sm:inline">Добавить книгу</span>
            </Button>
            <input
              ref={fileInput}
              type="file"
              accept=".epub,.pdf,.fb2,.txt,.md,.html,.htm,.mp3,.mp3.zip,.cbz"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) handleFiles(e.target.files)
                e.target.value = ''
              }}
            />
            <input
              ref={restoreInput}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) handleRestore(e.target.files)
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
            onClearFilters={clearAllFilters}
            filterCount={activeFilters.length}
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
                  <LibraryIcon className="h-4 w-4" /> {formatCount(stats.total, ['книга', 'книги', 'книг'])}
                </span>
                <span className="flex items-center gap-1.5">
                  <BookMarked className="h-4 w-4" /> {formatCount(stats.reading, ['книга', 'книги', 'книг'])} в чтении
                </span>
                <span className="hidden md:flex items-center gap-1.5">
                  <FileType className="h-4 w-4" /> {formatCount(stats.highlights, ['выделение', 'выделения', 'выделений'])}
                </span>
              </div>
              {/* Removable chips: every active constraint is visible and
                  individually clearable, so a stale filter never hides the
                  library silently. */}
              {activeFilters.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  {activeFilters.map((f) => (
                    <button
                      key={f.key}
                      onClick={f.clear}
                      className="inline-flex items-center gap-1 rounded-full border bg-muted px-2.5 py-1 text-xs text-foreground transition-colors hover:border-destructive/40 hover:bg-destructive/10 focus-visible:ring-2 focus-visible:ring-ring outline-none"
                      aria-label={`Сбросить фильтр: ${f.label}`}
                      title="Сбросить фильтр"
                    >
                      {f.label}
                      <X className="h-3 w-3 opacity-60" />
                    </button>
                  ))}
                  {activeFilters.length > 1 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={clearAllFilters}
                      className="h-6 px-2 text-xs text-muted-foreground"
                    >
                      Сбросить все
                    </Button>
                  )}
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 md:gap-6">
              {filtered.map((book) => (
                <BookCard
                  key={book.id}
                  book={book}
                  onOpen={() => openBook(book.id)}
                  onDelete={() => setDeleteTarget(book)}
                  onDetails={() => setDetailsTarget(book)}
                  onFavorite={() => handleToggleFavorite(book.id, book.title)}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* Footer */}
      <footer className="border-t mt-auto">
        <div className="container mx-auto px-4 md:px-8 py-4 text-xs text-muted-foreground">
          Все книги хранятся локально в вашем браузере. Поддерживаются EPUB, PDF, FB2, TXT, Markdown, HTML, MP3.
          Перетащите файлы в окно для загрузки или добавьте книгу по прямой ссылке.
        </div>
      </footer>

      {/* Delete confirmation */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && !deleting && setDeleteTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Удалить книгу?</DialogTitle>
            <DialogDescription>
              {deleteTarget?.title} будет удалена из библиотеки вместе с закладками,
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

      {/* Collection import */}
      <CollectionImport
        open={collectionOpen}
        onOpenChange={setCollectionOpen}
        userId={userId}
        onImported={refresh}
      />

      {/* Import from URL */}
      <UrlImportDialog
        open={urlImportOpen}
        onOpenChange={setUrlImportOpen}
        onImported={importFiles}
      />

      {/* Book details — re-derive from live state so rating/progress changes show instantly */}
      <BookDetailsDialog
        book={books.find((b) => b.id === detailsTarget?.id) ?? detailsTarget}
        sessions={sessions}
        bookmarks={bookmarks}
        highlights={highlights}
        onClose={() => setDetailsTarget(null)}
        onOpen={() => {
          if (detailsTarget) {
            setDetailsTarget(null)
            openBook(detailsTarget.id)
          }
        }}
        onRate={(rating) => {
          if (detailsTarget) handleRate(detailsTarget.id, rating)
        }}
        onResetProgress={() => {
          if (detailsTarget) handleResetProgress(detailsTarget.id, detailsTarget.title)
        }}
        onDownload={() => {
          if (detailsTarget) downloadBookFile(detailsTarget)
        }}
        onMarkAsRead={() => {
          if (detailsTarget) {
            updateBook(detailsTarget.id, {
              progress: 1,
              lastOpenedAt: Date.now(),
            }).then(() => {
              setBooks((prev) =>
                prev.map((b) =>
                  b.id === detailsTarget.id
                    ? { ...b, progress: 1, lastOpenedAt: Date.now() }
                    : b
                )
              )
              toast.success(`${detailsTarget.title} отмечена как прочитанная`)
              setDetailsTarget(null)
            }).catch((e) => {
              logger.error('Mark as read failed', e)
              toast.error('Ошибка сохранения')
            })
          }
        }}
        onSaveMeta={(title, author) => {
          if (!detailsTarget) return
          const id = detailsTarget.id
          updateBook(id, { title, author })
            .then(() => {
              setBooks((prev) => prev.map((b) => (b.id === id ? { ...b, title, author } : b)))
              toast.success('Метаданные сохранены')
            })
            .catch((e) => {
              logger.error('Metadata save failed', e)
              toast.error('Ошибка сохранения')
            })
        }}
        onReparseMeta={() => {
          if (detailsTarget) return handleReparseMeta(detailsTarget.id)
        }}
        onSaveTags={(tags) => {
          if (!detailsTarget) return
          const id = detailsTarget.id
          updateBook(id, { tags })
            .then(() => {
              setBooks((prev) => prev.map((b) => (b.id === id ? { ...b, tags } : b)))
              setDetailsTarget((prev) => (prev && prev.id === id ? { ...prev, tags } : prev))
            })
            .catch((e) => {
              logger.error('Tags save failed', e)
              toast.error('Ошибка сохранения')
            })
        }}
      />
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
  const readingSpeed = useReaderStore((s) => s.settings.readingSpeed)
  const wpm = getWordsPerMinute(readingSpeed)
  const remaining = estimateRemainingMinutes(book.format, book.size, progress, wpm)
  const remainingLabel = formatMinutes(remaining)

  return (
    <button
      onClick={onClick}
      className="group flex items-center gap-3 rounded-lg border p-3 hover:shadow-md transition-all text-left w-full"
    >
      <div className="h-16 w-12 bg-muted rounded overflow-hidden flex-shrink-0">
        {book.cover ? (
          <img
            src={book.cover}
            alt={book.title}
            className="h-full w-full object-cover"
            loading="lazy"
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
        <div className="mt-1 flex items-center justify-between">
          {remainingLabel && (
            <p className="text-xs text-muted-foreground/80">
              Осталось: {remainingLabel}
            </p>
          )}
          {book.rating && (
            <span className="text-xs text-amber-500">
              {'★'.repeat(book.rating)}{'☆'.repeat(5 - book.rating)}
            </span>
          )}
        </div>
      </div>
    </button>
  )
})

const BookCard = memo(function BookCard({
  book,
  onOpen,
  onDelete,
  onDetails,
  onFavorite,
}: {
  book: BookRecord
  onOpen: () => void
  onDelete: () => void
  onDetails: () => void
  onFavorite: () => void
}) {
  const badge = FORMAT_BADGES[book.format]
  const stars = book.rating ? '★'.repeat(book.rating) + '☆'.repeat(5 - book.rating) : ''
  const finished = isFinished(book.progress)

  return (
    <Card className="group relative overflow-hidden p-0 cursor-pointer hover:shadow-lg transition-all hover:-translate-y-1 duration-200" onClick={onOpen}>
      <div className="aspect-[2/3] relative bg-muted overflow-hidden">
        {book.cover ? (
          <img
            src={book.cover}
            alt={book.title}
            // Covers are large data URLs; with hundreds of books the grid
            // must not decode every image on mount.
            loading="lazy"
            decoding="async"
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
        <div className="absolute top-2 left-2 flex flex-col items-start gap-1">
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${badge.color}`}>
            {badge.label}
          </span>
          {finished && (
            <span className="rounded px-1.5 py-0.5 text-[10px] font-bold bg-green-600 text-white flex items-center gap-1">
              <Check className="h-3 w-3" /> Прочитана
            </span>
          )}
        </div>
        {book.progress !== undefined && book.progress > 0 && (
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/20">
            <div
              className={`h-full ${finished ? 'bg-green-500' : 'bg-primary'}`}
              style={{ width: `${Math.round(book.progress * 100)}%` }}
            />
          </div>
        )}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
          <Button size="sm" variant="secondary">
            <BookOpen className="h-4 w-4 mr-1.5" /> Открыть
          </Button>
        </div>
        <div className="absolute top-2 right-2 flex items-center gap-1">
          <button
            onClick={(e) => {
              e.stopPropagation()
              onFavorite()
            }}
            className={`h-8 w-8 rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center hover:bg-amber-500 ${
              book.favorite ? 'opacity-100 !bg-amber-500' : ''
            }`}
            aria-label={book.favorite ? 'Удалить из избранного' : 'Добавить в избранное'}
            title={book.favorite ? 'Удалить из избранного' : 'Добавить в избранное'}
          >
            <Heart className={`h-4 w-4 ${book.favorite ? 'fill-current' : ''}`} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation()
              onDetails()
            }}
            className="h-8 w-8 rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center hover:bg-primary"
            aria-label="Подробнее"
            title="Информация о книге"
          >
            <Info className="h-4 w-4" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation()
              onDelete()
            }}
            className="h-8 w-8 rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center hover:bg-destructive"
            aria-label="Удалить"
            title="Удалить книгу"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="p-3">
        <h3 className="font-medium text-sm line-clamp-2 leading-snug" title={book.title}>
          {book.title}
        </h3>
        <p className="text-xs text-muted-foreground mt-1 line-clamp-1">
          {book.author}
        </p>
        {stars && (
          <p className="text-xs mt-1 text-amber-500" title={`${book.rating} из 5`}>
            {stars}
          </p>
        )}
        {book.tags && book.tags.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1 overflow-hidden max-h-[1.5rem]">
            {book.tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center rounded-full bg-secondary px-1.5 py-0.5 text-[10px] text-secondary-foreground"
              >
                {tag}
              </span>
            ))}
            {book.tags.length > 3 && (
              <span className="text-[10px] text-muted-foreground self-center">
                +{book.tags.length - 3}
              </span>
            )}
          </div>
        )}
      </div>
    </Card>
  )
})

const EmptyState = memo(function EmptyState({
  hasBooks,
  onImport,
  onClearFilters,
  filterCount,
}: {
  hasBooks: boolean
  onImport: () => void
  onClearFilters: () => void
  filterCount: number
}) {
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
          ? filterCount > 0
            ? `Сейчас активно ${formatCount(filterCount, ['фильтр', 'фильтра', 'фильтров'])}. Отключите их, чтобы снова увидеть все книги.`
            : 'Попробуйте изменить поисковый запрос.'
          : 'Добавьте свои книги в форматах EPUB, PDF, TXT, Markdown или HTML. Все файлы сохраняются локально в браузере.'}
      </p>
      {/* Both empty states offer the way out as an action, not just advice —
          otherwise a filtered-to-zero library is a dead end. */}
      {hasBooks ? (
        filterCount > 0 && (
          <Button onClick={onClearFilters} size="lg" variant="outline" className="gap-2">
            <RotateCcw className="h-5 w-5" /> Сбросить {formatCount(filterCount, ['фильтр', 'фильтра', 'фильтров'])}
          </Button>
        )
      ) : (
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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`
}

function BookDetailsDialog({
  book,
  sessions,
  bookmarks,
  highlights,
  onClose,
  onOpen,
  onRate,
  onResetProgress,
  onDownload,
  onMarkAsRead,
  onSaveMeta,
  onReparseMeta,
  onSaveTags,
}: {
  book: BookRecord | null
  sessions: ReadingSession[]
  bookmarks: Bookmark[]
  highlights: Highlight[]
  onClose: () => void
  onOpen: () => void
  onRate: (rating: number) => void
  onResetProgress: () => void
  onDownload: () => void
  onMarkAsRead: () => void
  onSaveMeta: (title: string, author: string) => void
  onReparseMeta: () => void
  onSaveTags: (tags: string[]) => void
}) {
  const [hoverRating, setHoverRating] = useState(0)
  const [editing, setEditing] = useState(false)
  const [draftTitle, setDraftTitle] = useState('')
  const [draftAuthor, setDraftAuthor] = useState('')
  const [reparsing, setReparsing] = useState(false)
  const [newTag, setNewTag] = useState('')
  if (!book) return null

  const bookSessions = sessions.filter((s) => s.bookId === book.id)
  const totalMinutes = bookSessions.reduce((sum, s) => sum + s.minutes, 0)
  const totalPages = bookSessions.reduce((sum, s) => sum + s.pages, 0)
  const bookBookmarks = bookmarks.filter((b) => b.bookId === book.id)
  const bookHighlights = highlights.filter((h) => h.bookId === book.id)
  const progress = book.progress ?? 0
  const finished = isFinished(book.progress)
  const badge = FORMAT_BADGES[book.format]
  // Parsers fall back to the file name when a file carries no metadata; saying
  // so lets the reader fix it instead of wondering why the title is a slug.
  const missing = missingMetadata(book)

  const startEditing = () => {
    setDraftTitle(book.title)
    setDraftAuthor(book.author)
    setEditing(true)
  }

  const submitEdit = () => {
    const title = draftTitle.trim()
    const author = draftAuthor.trim()
    if (!title && !author) return
    onSaveMeta(title || book.title, author || book.author)
    setEditing(false)
  }

  const reparse = async () => {
    setReparsing(true)
    try {
      await onReparseMeta()
    } finally {
      setReparsing(false)
    }
  }

  const addTag = () => {
    const tag = newTag.trim().toLowerCase()
    if (!tag) return
    const existing = book.tags ?? []
    if (existing.includes(tag)) return
    onSaveTags([...existing, tag])
    setNewTag('')
  }

  const removeTag = (tag: string) => {
    const existing = book.tags ?? []
    onSaveTags(existing.filter((t) => t !== tag))
  }

  return (
    <Dialog open={!!book} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Info className="h-5 w-5 text-muted-foreground" />
            Информация о книге
          </DialogTitle>
        </DialogHeader>
        <div className="flex gap-4">
          {/* Cover */}
          <div className="h-32 w-24 rounded-lg overflow-hidden flex-shrink-0 bg-muted">
            {book.cover ? (
              <img
                src={book.cover}
                alt={book.title}
                loading="lazy"
                decoding="async"
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center">
                <FileText className="h-10 w-10 text-muted-foreground/50" />
              </div>
            )}
          </div>
          {/* Info */}
          <div className="flex-1 min-w-0">
            {editing ? (
              <div className="space-y-2">
                <Input
                  value={draftTitle}
                  onChange={(e) => setDraftTitle(e.target.value)}
                  placeholder="Название"
                  aria-label="Название"
                  className="h-8 text-sm"
                />
                <Input
                  value={draftAuthor}
                  onChange={(e) => setDraftAuthor(e.target.value)}
                  placeholder="Автор"
                  aria-label="Автор"
                  className="h-8 text-sm"
                />
                <div className="flex gap-2">
                  <Button size="sm" variant="default" className="h-7 text-xs" onClick={submitEdit}>
                    <Check className="h-3.5 w-3.5 mr-1" /> Сохранить
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    onClick={() => setEditing(false)}
                  >
                    <X className="h-3.5 w-3.5 mr-1" /> Отмена
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <h3 className="font-semibold text-base leading-snug" title={book.title}>
                  {book.title}
                </h3>
                <p className="text-sm text-muted-foreground mt-0.5">{book.author}</p>
              </>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${badge.color}`}>
                {badge.label}
              </span>
              {finished && (
                <span className="rounded px-1.5 py-0.5 text-[10px] font-bold bg-green-600 text-white flex items-center gap-1">
                  <Check className="h-3 w-3" /> Прочитана
                </span>
              )}
              <div className="flex items-center gap-0.5">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    onClick={() => onRate(star === book.rating ? 0 : star)}
                    onMouseEnter={() => setHoverRating(star)}
                    onMouseLeave={() => setHoverRating(0)}
                    className="p-0.5 transition-transform hover:scale-110 focus:outline-none"
                    aria-label={`Оценить на ${star} из 5`}
                    title={`${star} из 5`}
                  >
                    <Star
                      className={`h-4 w-4 ${
                        star <= (hoverRating || book.rating || 0)
                          ? 'fill-amber-400 text-amber-400'
                          : 'text-muted-foreground/40'
                      }`}
                    />
                  </button>
                ))}
                {book.rating !== undefined && book.rating > 0 && (
                  <span className="text-xs text-muted-foreground ml-1">({book.rating})</span>
                )}
              </div>
            </div>
            {progress > 0 && (
              <div className="mt-3">
                <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                  <span>Прогресс чтения</span>
                  <span className="tabular-nums">{Math.round(progress * 100)}%</span>
                </div>
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className={`h-full ${finished ? 'bg-green-500' : 'bg-primary'}`}
                    style={{ width: `${Math.round(progress * 100)}%` }}
                  />
                </div>
              </div>
            )}
            {missing.any && !editing && (
              <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-500">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>
                  {missing.title && !missing.author
                    ? 'Название взято из имени файла — в книге оно не записано.'
                    : 'Часть данных не считалась из файла — их можно ввести вручную.'}
                </span>
              </p>
            )}
            {!editing && (
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={startEditing}
                >
                  <Pencil className="h-3.5 w-3.5 mr-1" /> Исправить
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={reparse}
                  disabled={reparsing}
                  title="Прочитать название, автора и обложку из файла заново"
                >
                  <RefreshCw className={`h-3.5 w-3.5 mr-1 ${reparsing ? 'animate-spin' : ''}`} />
                  {reparsing ? 'Читаю…' : 'Перечитать метаданные'}
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* Description */}
        {book.description && (
          <div className="mt-2">
            <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Описание</p>
            <p className="text-sm leading-relaxed line-clamp-5 whitespace-pre-wrap">
              {book.description}
            </p>
          </div>
        )}

        {/* Tags */}
        <div className="mt-2">
          <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1.5">Теги</p>
          <div className="flex flex-wrap gap-1.5">
            {(book.tags ?? []).map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground"
              >
                {tag}
                <button
                  onClick={() => removeTag(tag)}
                  className="rounded-full p-0.5 hover:bg-muted"
                  aria-label={`Удалить тег ${tag}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
          <div className="mt-1.5 flex gap-1.5">
            <Input
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              placeholder="Новый тег"
              aria-label="Новый тег"
              className="h-7 flex-1 text-xs"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addTag()
                }
              }}
            />
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs"
              onClick={addTag}
              disabled={!newTag.trim()}
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* Metadata grid */}
        <div className="mt-2 grid grid-cols-2 gap-3 text-sm">
          <div className="flex items-center gap-2 text-muted-foreground">
            <HardDrive className="h-4 w-4" />
            <span>{formatBytes(book.size)}</span>
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            <CalendarDays className="h-4 w-4" />
            <span>
              {new Date(book.addedAt).toLocaleDateString('ru-RU', {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
            </span>
          </div>
          {book.lastOpenedAt && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <BookOpenCheck className="h-4 w-4" />
              <span>
                Читали: {new Date(book.lastOpenedAt).toLocaleDateString('ru-RU')}
              </span>
            </div>
          )}
        </div>

        {/* Reading stats */}
        {(totalMinutes > 0 || totalPages > 0) && (
          <div className="mt-2 grid grid-cols-4 gap-2 rounded-lg border p-3 text-center">
            <div>
              <p className="text-lg font-bold tabular-nums">{totalMinutes}</p>
              <p className="text-[10px] text-muted-foreground">минут</p>
            </div>
            <div>
              <p className="text-lg font-bold tabular-nums">{totalPages}</p>
              <p className="text-[10px] text-muted-foreground">страниц</p>
            </div>
            <div>
              <p className="text-lg font-bold tabular-nums">{bookBookmarks.length}</p>
              <p className="text-[10px] text-muted-foreground">закладок</p>
            </div>
            <div>
              <p className="text-lg font-bold tabular-nums">{bookHighlights.length}</p>
              <p className="text-[10px] text-muted-foreground">выделений</p>
            </div>
          </div>
        )}

        <div className="flex justify-between gap-2 mt-2">
          <div className="flex gap-2">
            {progress > 0 && !finished && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  onResetProgress()
                  onClose()
                }}
                className="gap-1.5 text-xs text-muted-foreground hover:text-foreground"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Сбросить прогресс
              </Button>
            )}
            {progress > 0 && progress < 0.99 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  onMarkAsRead()
                  onClose()
                }}
                className="gap-1.5 text-xs bg-green-50 hover:bg-green-100 text-green-700 border-green-200 hover:border-green-300"
              >
                <Check className="h-3.5 w-3.5" />
                Прочитана
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={onDownload}
              className="gap-1.5 text-xs text-muted-foreground hover:text-foreground"
              title="Сохранить оригинальный файл книги"
            >
              <Download className="h-3.5 w-3.5" />
              Скачать файл
            </Button>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              Закрыть
            </Button>
            <Button onClick={onOpen} className="gap-1.5">
              <BookOpen className="h-4 w-4" />
              Открыть книгу
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
