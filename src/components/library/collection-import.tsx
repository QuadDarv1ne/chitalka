'use client'

import { logger } from '@/lib/logger'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Loader2, Download, RefreshCw, FolderOpen, Search } from 'lucide-react'
import { saveBook, getAllBooks, type BookRecord } from '@/lib/library'
import { hashFileHead } from './library'
import {
  detectFormat,
  parseEpubMeta,
  parseTextMeta,
  parsePdfMeta,
  parseFb2Meta,
  parseFb2Content,
  parseAudioMeta,
} from '@/lib/book-parser'

interface CollectionFile {
  name: string
  size: number
  format: string
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  userId?: string | null
  onImported: () => void
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} ГБ`
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / 1024 / 1024)} МБ`
  return `${Math.round(bytes / 1024)} КБ`
}

const FORMAT_LABELS: Record<string, string> = {
  epub: 'EPUB',
  pdf: 'PDF',
  fb2: 'FB2',
  txt: 'TXT',
  md: 'Markdown',
  html: 'HTML',
  mp3: 'Аудиокнига',
}

export function CollectionImport({ open, onOpenChange, userId, onImported }: Props) {
  const [files, setFiles] = useState<CollectionFile[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [error, setError] = useState<string | null>(null)
  const importCancelled = useRef(false)

  const filteredFiles = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return files
    return files.filter((f) => f.name.toLowerCase().includes(q))
  }, [files, search])

  const loadManifest = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/books/manifest')
      const data = await res.json().catch(() => ({ files: [] }))
      const list = (data.files ?? []) as CollectionFile[]
      setFiles(list)
      // Select all by default
      setSelected(new Set(list.map((f) => f.name)))
    } catch (e) {
      logger.error('Failed to load collection', e)
      setError('Не удалось загрузить список файлов')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) {
      importCancelled.current = false
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSearch('')
      loadManifest()
    }
  }, [open, loadManifest])

  const toggleFile = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const toggleAll = () => {
    const allSelected = filteredFiles.length > 0 && filteredFiles.every((f) => selected.has(f.name))
    setSelected((prev) => {
      const next = new Set(prev)
      if (allSelected) {
        for (const f of filteredFiles) next.delete(f.name)
      } else {
        for (const f of filteredFiles) next.add(f.name)
      }
      return next
    })
  }

  const handleImport = async () => {
    const toImport = files.filter((f) => selected.has(f.name))
    if (toImport.length === 0) return

    setImporting(true)
    setError(null)
    importCancelled.current = false
    let imported = 0
    setProgress({ done: 0, total: toImport.length })

    try {
      // Fetch existing hashes once to dedupe
      const existing = await getAllBooks(userId)
      const existingHashes = new Set(
        await Promise.all(
          existing.map(async (b) => {
            try {
              return await hashFileHead(b.blob)
            } catch {
              return `${b.title}\u0000${b.size}`
            }
          }),
        ),
      )

      // Process sequentially to avoid memory spikes from large files
      for (const file of toImport) {
        if (importCancelled.current) break
        try {
          const res = await fetch(`/api/books/download/${encodeURIComponent(file.name)}`)
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          const blob = await res.blob()

          const format = detectFormat(file.name)
          if (!format) {
            setProgress((p) => ({ ...p, done: p.done + 1 }))
            continue
          }

          // Convert Blob to File so existing parsers (which take File) work
          const asFile = new File([blob], file.name, { type: blob.type })

          // FB2 is stored as converted plain text — dedupe against the
          // stored representation, otherwise the same book always imports twice
          let dedupeBlob: Blob = blob
          if (format === 'fb2') {
            const textContent = await parseFb2Content(asFile)
            if (!textContent) {
              setProgress((p) => ({ ...p, done: p.done + 1 }))
              continue
            }
            dedupeBlob = new Blob([textContent], { type: 'text/plain' })
          }

          const hex = await hashFileHead(dedupeBlob)
          if (existingHashes.has(hex)) {
            setProgress((p) => ({ ...p, done: p.done + 1 }))
            continue
          }

          let meta: { title: string; author: string; cover?: string; description?: string; format: string }
          let storeBlob: Blob = blob
          if (format === 'epub') {
            meta = await parseEpubMeta(asFile)
          } else if (format === 'pdf') {
            meta = await parsePdfMeta(asFile)
          } else if (format === 'fb2') {
            meta = await parseFb2Meta(asFile)
            storeBlob = dedupeBlob
          } else if (format === 'mp3') {
            meta = parseAudioMeta(file.name)
          } else {
            meta = await parseTextMeta(asFile, format as 'txt' | 'md' | 'html')
          }

          const book: BookRecord = {
            id: crypto.randomUUID(),
            title: meta.title,
            author: meta.author,
            format: format as BookRecord['format'],
            size: blob.size,
            cover: meta.cover,
            description: meta.description,
            blob: storeBlob,
            addedAt: Date.now(),
            userId: userId ?? null,
          }
          await saveBook(book)
          existingHashes.add(hex)
          imported++
        } catch (e) {
          logger.error('Import failed:', file.name, e)
        }
        setProgress((p) => ({ ...p, done: p.done + 1 }))
      }

      if (imported > 0) onImported()
    } finally {
      setImporting(false)
    }

    if (importCancelled.current) return
  }

  const canImport = selected.size > 0 && !importing

  return (
    <Dialog open={open} onOpenChange={(o) => !importing && onOpenChange(o)}>
      <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderOpen className="h-5 w-5" />
            Импорт из коллекции
          </DialogTitle>
          <DialogDescription>
            Файлы загружаются с сервера и сохраняются локально в вашей библиотеке.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по файлам..."
            className="pl-9"
            disabled={loading}
          />
        </div>

        <div className="flex items-center justify-between px-1">
          <Button variant="ghost" size="sm" onClick={toggleAll} className="text-xs" disabled={filteredFiles.length === 0}>
            {filteredFiles.length > 0 && filteredFiles.every((f) => selected.has(f.name))
              ? 'Снять все'
              : 'Выбрать все'}
          </Button>
          {search.trim() && (
            <span className="text-xs text-muted-foreground">
              Показано {filteredFiles.length} из {files.length}
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={loadManifest}
            className="text-xs"
            disabled={loading}
            aria-label="Обновить список"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto rounded-lg border">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-10 gap-2">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Загрузка списка...</p>
            </div>
          ) : files.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 gap-2 text-center px-4">
              <p className="text-sm text-muted-foreground">
                {error ?? 'В коллекции нет файлов'}
              </p>
            </div>
          ) : filteredFiles.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 gap-2 text-center px-4">
              <p className="text-sm text-muted-foreground">Ничего не найдено</p>
            </div>
          ) : (
            <div className="divide-y">
              {filteredFiles.map((file) => {
                const checked = selected.has(file.name)
                const formatLabel = FORMAT_LABELS[file.format] ?? file.format.toUpperCase()
                return (
                  <label
                    key={file.name}
                    className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-muted/50 transition-colors"
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={() => toggleFile(file.name)}
                      aria-label={file.name}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate" title={file.name}>
                        {file.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatLabel} · {formatSize(file.size)}
                      </p>
                    </div>
                  </label>
                )
              })}
            </div>
          )}
        </div>

        {error && <p className="text-sm text-destructive px-1">{error}</p>}

        {importing && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Импорт {progress.done} / {progress.total}...
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={importing}>
            Закрыть
          </Button>
          <Button onClick={handleImport} disabled={!canImport}>
            {importing ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Импорт...
              </>
            ) : (
              <>
                <Download className="h-4 w-4 mr-2" />
                Импортировать ({selected.size})
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
