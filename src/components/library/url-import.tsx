'use client'

import { useState, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Link2, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { detectFormat } from '@/lib/book-parser'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImported: (files: File[]) => void
}

const MAX_FILE_SIZE = 500 * 1024 * 1024 // matches library.tsx

/**
 * Import a book from a direct file URL.
 * Works with hosts that allow cross-origin downloads (archive.org, GitHub
 * raw, many static hosts). Sites that block CORS cannot be fetched from the
 * browser — the error is surfaced so the user understands why.
 */
export function UrlImportDialog({ open, onOpenChange, onImported }: Props) {
  const [url, setUrl] = useState('')
  const [downloading, setDownloading] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const xhrRef = useRef<XMLHttpRequest | null>(null)

  const handleOpenChange = (v: boolean) => {
    if (!v) {
      setUrl('')
      setProgress(null)
      if (xhrRef.current) {
        xhrRef.current.abort()
        xhrRef.current = null
      }
    }
    onOpenChange(v)
  }

  const handleDownload = async () => {
    const trimmed = url.trim()
    if (!trimmed || downloading) return
    let parsed: URL
    try {
      parsed = new URL(trimmed)
    } catch {
      toast.error('Некорректный URL')
      return
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      toast.error('Поддерживаются только http/https ссылки')
      return
    }
    setDownloading(true)
    setProgress(0)

    try {
      // Use XMLHttpRequest for progress tracking instead of fetch
      const xhr = new XMLHttpRequest()
      xhrRef.current = xhr

      xhr.onprogress = (e) => {
        if (e.lengthComputable && e.total > 0) {
          setProgress(Math.round((e.loaded / e.total) * 50)) // first 50% is download
        }
      }

      const response = await new Promise<Blob>((resolve, reject) => {
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(new Blob([xhr.response]))
          } else {
            reject(new Error(`Сервер ответил: HTTP ${xhr.status}`))
          }
        }
        xhr.onerror = () => reject(new TypeError('Ошибка сети'))
        xhr.open('GET', parsed.toString())
        xhr.responseType = 'blob'
        xhr.send()
      })

      setProgress(50)

      if (response.size === 0) throw new Error('Файл пустой')
      if (response.size > MAX_FILE_SIZE) {
        throw new Error('Файл слишком большой (макс. 500 МБ)')
      }

      // Filename: Content-Disposition header, then the URL path
      let name = ''
      const cd = xhr.getResponseHeader('content-disposition')
      if (cd) {
        const m = cd.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i)
        if (m) name = decodeURIComponent(m[1].replace(/"/g, '').trim())
      }
      if (!name) {
        name = decodeURIComponent(parsed.pathname.split('/').pop() || '').trim()
      }
      if (!name || name === '/') {
        throw new Error('Не удалось определить имя файла по ссылке')
      }
      if (!detectFormat(name)) {
        throw new Error(
          `Формат файла «${name}» не поддерживается (нужен EPUB, PDF, FB2, TXT, MD, HTML или MP3)`,
        )
      }

      setProgress(75)
      const file = new File([response], name, { type: response.type })
      onImported([file])
      handleOpenChange(false)
      toast.success('Файл скачан, добавляем в библиотеку…')
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Не удалось скачать файл'
      if (e instanceof TypeError) {
        toast.error(
          'Сервер заблокировал загрузку (CORS) или нет соединения. Попробуйте прямую ссылку на файл.',
        )
      } else {
        toast.error(msg)
      }
    } finally {
      setDownloading(false)
      setProgress(null)
      xhrRef.current = null
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="h-5 w-5 text-muted-foreground" />
            Добавить книгу по ссылке
          </DialogTitle>
          <DialogDescription>
            Скачайте книгу из интернета прямо в библиотеку. Ссылка должна
            вести напрямую на файл (EPUB, PDF, FB2, TXT, MD, HTML, MP3).
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            handleDownload()
          }}
          className="flex flex-col gap-3"
        >
          <Input
            autoFocus
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/book.epub"
            type="url"
            inputMode="url"
            autoComplete="url"
            disabled={downloading}
          />
          {downloading && progress !== null && (
            <div className="space-y-1">
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground text-center">
                {progress < 50 ? 'Скачивание…' : 'Обработка…'} {progress}%
              </p>
            </div>
          )}
          <Button type="submit" disabled={downloading || !url.trim()} className="gap-1.5">
            {downloading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Link2 className="h-4 w-4" />
            )}
            {downloading ? 'Скачивание…' : 'Скачать и добавить'}
          </Button>
        </form>
        <p className="text-xs text-muted-foreground">
          Не все сайты разрешают загрузку из браузера (ограничения CORS).
          Хорошо работают прямые ссылки на файлы (archive.org, GitHub, Google Drive
          в режиме «прямой доступ»).
        </p>
      </DialogContent>
    </Dialog>
  )
}