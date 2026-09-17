'use client'

import type { BookRecord } from '@/lib/library'
import { initPdfWorker, pdfAssetOptions } from '@/lib/pdf-worker'
import { decodeTextBytes } from '@/lib/text-encoding'
import { readFirstEntryHead, unzip } from '@/lib/zip-utils'
import {
  mergeAudioTags,
  parseId3v1,
  parseId3v2,
  type AudioTags,
} from '@/lib/id3'
import { scanFb2Meta } from '@/lib/fb2-scan'
import { logger } from '@/lib/logger'

export interface ParsedBook {
  title: string
  author: string
  cover?: string
  description?: string
  format: 'epub' | 'txt' | 'md' | 'html' | 'pdf' | 'fb2' | 'mp3' | 'cbz'
}

export function detectFormat(filename: string): BookRecord['format'] | null {
  const lower = filename.toLowerCase()
  if (lower.endsWith('.epub')) return 'epub'
  if (lower.endsWith('.pdf')) return 'pdf'
  if (lower.endsWith('.fb2')) return 'fb2'
  if (lower.endsWith('.md')) return 'md'
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'html'
  if (lower.endsWith('.txt')) return 'txt'
  if (lower.endsWith('.mp3') || lower.endsWith('.mp3.zip')) return 'mp3'
  if (lower.endsWith('.cbz')) return 'cbz'
  return null
}

/**
 * Lightweight EPUB metadata parser.
 * Reads META-INF/container.xml → OPF rootfile → extracts title/author/cover.
 */
export async function parseEpubMeta(
  file: File | Blob,
): Promise<ParsedBook> {
  const defaultResult: ParsedBook = {
    title: 'Без названия',
    author: 'Неизвестный автор',
    format: 'epub',
  }
  try {
    const arrayBuffer = await file.arrayBuffer()
    // Use shared unzip utility
    const entries = await unzip(arrayBuffer)
    const containerXml = await readText(entries['META-INF/container.xml'])
    if (!containerXml) return defaultResult
    const opfPath = extractOpfPath(containerXml)
    if (!opfPath) return defaultResult
    const opfText = await readText(entries[opfPath])
    if (!opfText) return defaultResult
    const meta = parseOpf(opfText)
    // Try cover
    let cover: string | undefined
    const coverId = findCoverId(opfText)
    if (coverId && meta.manifest[coverId]) {
      const coverPath = resolvePath(opfPath, meta.manifest[coverId])
      const coverEntry = entries[coverPath]
      if (coverEntry) {
        // Blob uses only the view's bytes (not the whole ZIP buffer)
        const blob = new Blob([coverEntry.slice()])
        cover = await blobToDataURL(blob)
      }
    }
    return {
      title: meta.title || defaultResult.title,
      author: meta.author || defaultResult.author,
      cover,
      format: 'epub',
    }
  } catch (e) {
    logger.warn('EPUB parse failed', e)
    return defaultResult
  }
}

async function readText(data?: Uint8Array): Promise<string | null> {
  if (!data) return null
  // Use decodeTextBytes to handle BOM, XML encoding declarations,
  // and fallback from UTF-8 to windows-1251 for Russian legacy files
  // Create a clean ArrayBuffer view to avoid SharedArrayBuffer issues
  const buffer = new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  return decodeTextBytes(buffer.buffer as ArrayBuffer)
}

function extractOpfPath(containerXml: string): string | null {
  const m = containerXml.match(/full-path="([^"]+)"/)
  return m ? m[1] : null
}

interface OpfMeta {
  title: string
  author: string
  manifest: Record<string, string> // id -> href
}

function parseOpf(opfText: string): OpfMeta {
  const title = opfText.match(/<dc:title[^>]*>([^<]+)<\/dc:title>/i)?.[1]?.trim() || ''
  const author = opfText.match(/<dc:creator[^>]*>([^<]+)<\/dc:creator>/i)?.[1]?.trim() || ''
  const manifest: Record<string, string> = {}
  const manifestRegex = /<item\b[^>]*>/gi
  let m: RegExpExecArray | null
  while ((m = manifestRegex.exec(opfText)) !== null) {
    const item = m[0]
    const id = item.match(/id="([^"]+)"/)?.[1]
    const href = item.match(/href="([^"]+)"/)?.[1]
    if (!id || !href) continue
    try {
      manifest[id] = decodeURIComponent(href)
    } catch {
      // Malformed percent-encoding in href — skip this item, keep parsing
      continue
    }
  }
  return { title, author, manifest }
}

function findCoverId(opfText: string): string | null {
  // 1) explicit <meta name="cover" content="id"/>
  const m1 = opfText.match(/<meta[^>]*name=["']cover["'][^>]*content=["']([^"']+)["']/i)
  if (m1) return m1[1]
  // 2) image item whose id or href mentions "cover" (attribute order independent)
  const itemRegex = /<item\b[^>]*>/gi
  let m: RegExpExecArray | null
  while ((m = itemRegex.exec(opfText)) !== null) {
    const item = m[0]
    if (!/media-type=["']image\//i.test(item)) continue
    const id = item.match(/id=["']([^"']+)["']/i)?.[1]
    const href = item.match(/href=["']([^"']+)["']/i)?.[1]
    if (!id || !href) continue
    if (/cover/i.test(id) || /cover/i.test(href)) return id
  }
  // 3) Common cover filenames (case-insensitive) — fallback for EPUBs
  //    that don't declare a cover in meta but have a file named cover.jpg, cover.png, etc.
  const coverFilenames = [
    'cover.jpg', 'cover.jpeg', 'cover.png', 'cover.gif',
    'Cover.jpg', 'Cover.jpeg', 'Cover.png', 'Cover.gif',
    'Obrázok_1.jpg', 'обложка.jpg', 'oblozhka.jpg',
    'cover_image.jpg', 'cover-image.jpg', 'book_cover.jpg',
  ]
  const manifestRegex = /<item\b[^>]*>/gi
  let m2: RegExpExecArray | null
  while ((m2 = manifestRegex.exec(opfText)) !== null) {
    const item = m2[0]
    if (!/media-type=["']image\//i.test(item)) continue
    const href = item.match(/href=["']([^"']+)["']/i)?.[1]
    if (href && coverFilenames.some((name) => href.toLowerCase().endsWith(name.toLowerCase()))) {
      return item.match(/id=["']([^"']+)["']/i)?.[1] ?? null
    }
  }
  // 4) First image item as last resort
  const allItemsRegex = /<item\b[^>]*>/gi
  let m3: RegExpExecArray | null
  while ((m3 = allItemsRegex.exec(opfText)) !== null) {
    const item = m3[0]
    if (/media-type=["']image\//i.test(item)) {
      return item.match(/id=["']([^"']+)["']/i)?.[1] ?? null
    }
  }
  return null
}

function resolvePath(opfPath: string, href: string): string {
  const base = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : ''
  const stack: string[] = []
  for (const part of (base + href).split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') stack.pop()
    else stack.push(part)
  }
  return stack.join('/')
}

function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

/**
 * FB2 metadata parser. FB2 is XML; we extract title, author, annotation, cover binary.
 */
export async function parseFb2Meta(file: File): Promise<ParsedBook> {
  const defaultResult: ParsedBook = {
    title: cleanBookFilename(file.name),
    author: 'Неизвестный автор',
    format: 'fb2',
  }
  try {
    const text = decodeTextBytes(await file.arrayBuffer())
    // Use DOMParser to parse XML
    const parser = new DOMParser()
    // Strip XML declaration to avoid issues
    const cleaned = text.replace(/^<\?xml[^>]*\?>/, '')
    const doc = parser.parseFromString(cleaned, 'application/xml')

    // Check for parse errors
    const parseError = doc.querySelector('parsererror')
    if (parseError) {
      // A single unescaped ampersand makes the whole document invalid XML,
      // which is common in files downloaded from Russian libraries. The
      // metadata is still recoverable by scanning the source text.
      logger.warn('FB2 is not well-formed XML — falling back to text scan')
      return { ...defaultResult, ...scanFb2Meta(text), format: 'fb2' }
    }

    const getTitle = () => {
      const t = doc.querySelector('book-title') || doc.querySelector('title-info > book-title')
      return t?.textContent?.trim() || ''
    }
    const getAuthor = () => {
      const authorEl = doc.querySelector('author') || doc.querySelector('title-info > author')
      if (!authorEl) return ''
      const first = authorEl.querySelector('first-name')?.textContent?.trim() || ''
      const last = authorEl.querySelector('last-name')?.textContent?.trim() || ''
      const mid = authorEl.querySelector('middle-name')?.textContent?.trim() || ''
      return [last, first, mid].filter(Boolean).join(' ').trim() || authorEl.textContent?.trim() || ''
    }
    const getDescription = () => {
      const ann = doc.querySelector('annotation') || doc.querySelector('title-info > annotation')
      if (!ann) return ''
      return ann.textContent?.trim().replace(/\s+/g, ' ').slice(0, 500) || ''
    }
    const getCover = async (): Promise<string | undefined> => {
      try {
        // 1) Standard FB2 coverpage
        const coverEl = doc.querySelector('coverpage > image')
        if (coverEl) {
          const href =
            coverEl.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ||
            coverEl.getAttribute('href') ||
            coverEl.getAttribute('l:href')
          if (href) {
            const id = href.replace(/^#/, '')
            const binary = doc.querySelector(`binary[id="${id}"]`)
            if (binary) {
              const contentType = binary.getAttribute('content-type') || 'image/jpeg'
              const data = binary.textContent?.replace(/\s/g, '') || ''
              return `data:${contentType};base64,${data}`
            }
          }
        }
        // 2) Fallback: look for <body > image elements with href starting with #
        //    Some FB2 files embed images in body that serve as covers
        const body = doc.querySelector('body')
        if (body) {
          const images = body.querySelectorAll('image')
          for (const img of images) {
            const href =
              img.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ||
              img.getAttribute('href') ||
              img.getAttribute('l:href')
            if (href && href.startsWith('#')) {
              const id = href.replace(/^#/, '')
              const binary = doc.querySelector(`binary[id="${id}"]`)
              if (binary) {
                const contentType = binary.getAttribute('content-type') || 'image/jpeg'
                const data = binary.textContent?.replace(/\s/g, '') || ''
                return `data:${contentType};base64,${data}`
              }
            }
          }
        }
        return undefined
      } catch {
        return undefined
      }
    }

    const title = getTitle() || defaultResult.title
    const author = getAuthor() || defaultResult.author
    const description = getDescription()
    const cover = await getCover()
    return { title, author, cover, description, format: 'fb2' }
  } catch (e) {
    logger.warn('FB2 parse failed', e)
    return defaultResult
  }
}

/**
 * FB2 → plain text converter. Reads <body> <section> <p> elements,
 * preserving chapter boundaries for pagination.
 *
 * NOTE: Uses DOMParser which is browser-only. Must only be called in
 * client components or with 'use client' directive.
 */
export async function parseFb2Content(file: File): Promise<string> {
  // Guard against server-side execution — DOMParser is not available there
  if (typeof DOMParser === 'undefined') {
    logger.warn('parseFb2Content called on server — DOMParser unavailable')
    return ''
  }
  try {
    const text = decodeTextBytes(await file.arrayBuffer())
    const parser = new DOMParser()
    const cleaned = text.replace(/^<\?xml[^>]*\?>/, '')
    const doc = parser.parseFromString(cleaned, 'application/xml')

    // Try to detect FB2 namespaces
    const body = doc.querySelector('body') || doc.getElementsByTagName('body')[0]
    if (!body) return ''

    const result: string[] = []

    const isLocal = (el: Element, name: string) => el.localName === name

    const processSection = (section: Element, level: number) => {
      // Section title
      const title = Array.from(section.children).find((c) => isLocal(c, 'title'))
      if (title) {
        const titleText = Array.from(title.querySelectorAll('p'))
          .map((p) => p.textContent?.trim())
          .filter(Boolean)
          .join(' ')
        if (titleText) {
          const prefix = level === 0 ? '## ' : '### '
          result.push(`${prefix}${titleText}\n`)
        }
      }

      // Paragraphs (direct children only)
      const paragraphs = Array.from(section.children).filter((c) => isLocal(c, 'p'))
      for (const p of paragraphs) {
        const pText = p.textContent?.trim().replace(/\s+/g, ' ')
        if (pText) result.push(pText)
      }

      // Sub-sections
      const subsections = Array.from(section.children).filter((c) => isLocal(c, 'section'))
      for (const sub of subsections) {
        result.push('')
        processSection(sub, level + 1)
      }
    }

    // Get top-level sections
    const topSections = Array.from(body.children).filter((c) => isLocal(c, 'section'))
    if (topSections.length === 0) {
      // No sections — just paragraphs in body
      const paragraphs = Array.from(body.children).filter((c) => isLocal(c, 'p'))
      for (const p of paragraphs) {
        const pText = p.textContent?.trim().replace(/\s+/g, ' ')
        if (pText) result.push(pText)
      }
    } else {
      for (const section of topSections) {
        processSection(section, 0)
        result.push('')
      }
    }

    return result.join('\n\n')
  } catch (e) {
    logger.error('FB2 content parse failed', e)
    return ''
  }
}

export async function parseTextMeta(file: File, format: 'txt' | 'md' | 'html' | 'cbz'): Promise<ParsedBook> {
  const head = await file.slice(0, 4096).arrayBuffer()
  const text = decodeTextBytes(head)
  // For markdown, try first H1
  const h1 = text.match(/^#\s+(.+)$/m)
  const title = h1 ? h1[1].trim() : file.name.replace(/\.[^.]+$/, '')
  return {
    title,
    author: 'Локальный файл',
    format,
  }
}

/**
 * Turn a book filename into a human readable title.
 * Library dumps use underscores as word separators and carry trailing format
 * or catalogue markers (".a6", ".a4", "_1234567"), none of which belong in a
 * title shown to the reader.
 */
export function cleanBookFilename(filename: string): string {
  let name = filename
  // Strip extension(s) such as .pdf, .mp3.zip, .fb2.zip
  name = name.replace(/\.(pdf|epub|fb2|txt|md|html?|cbz|mp3)(\.zip)?$/i, '')
  // Archive/library suffixes: ".a4", ".a6", " (1)", "_2"
  name = name.replace(/\.[a-z]\d$/i, '')
  name = name.replace(/\s*\((?:\d+|copy|копия)\)$/i, '')
  // Long digit runs are catalogue ids, not part of a title
  name = name.replace(/[_\s]\d{5,}\b/g, '')
  name = name.replace(/_/g, ' ')
  name = name.replace(/\s{2,}/g, ' ')
  name = name.replace(/^[\s.\-–—]+|[\s.\-–—]+$/g, '')
  return name.trim()
}

/**
 * Sanitize a text value coming from a PDF info dictionary.
 * Returns '' for values that carry no information (empty, placeholder, or the
 * same string as the filename), because exporters routinely write the file
 * name or the producing application into /Title.
 */
function sanitizePdfInfoValue(value: unknown, fallbackTitle: string): string {
  if (value === undefined || value === null) return ''
  const text = String(value)
    .replace(/\u0000/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (text.length < 2) return ''
  // Nothing but punctuation/digits
  if (!/[\p{L}]/u.test(text)) return ''
  const noise = /^(?:microsoft|adobe|acrobat|word|canva|latex|libreoffice|openoffice|wkhtmltopdf|mozilla|pdfjs|unknown|untitled|без названия)/i
  if (noise.test(text)) return ''
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
  const candidate = norm(text)
  const fallback = norm(fallbackTitle)
  if (!candidate || !fallback) return text
  // Identical to, or a substring of, the filename — no new information.
  if (candidate === fallback || fallback.includes(candidate) || candidate.includes(fallback)) return ''
  return text
}

/**
 * Render page 1 as a cover image.
 * Kept separate from metadata reading so that a rendering failure (missing
 * font, oversized canvas, encrypted content) never costs the title.
 */
async function renderPdfCover(doc: PdfDocumentLike): Promise<string | undefined> {
  const page = await doc.getPage(1)
  const viewport = page.getViewport({ scale: 1.0 })
  const canvas = document.createElement('canvas')
  const maxThumbWidth = 400
  const scale = Math.min(1, maxThumbWidth / viewport.width)
  const scaledViewport = page.getViewport({ scale })
  canvas.width = Math.max(1, Math.floor(scaledViewport.width))
  canvas.height = Math.max(1, Math.floor(scaledViewport.height))
  const ctx = canvas.getContext('2d')
  if (!ctx) return undefined
  await page.render({ canvasContext: ctx, viewport: scaledViewport, canvas } as never).promise
  // PNG keeps Cyrillic text crisp on scanned/text-heavy covers
  return canvas.toDataURL('image/png', 0.92)
}

interface PdfDocumentLike {
  getPage(n: number): Promise<{
    getViewport(o: { scale: number }): { width: number; height: number }
    render(o: unknown): { promise: Promise<void> }
  }>
}

/**
 * PDF metadata parser using pdfjs-dist.
 * Extracts title from info dict, generates a cover from the first page.
 */
export async function parsePdfMeta(file: File): Promise<ParsedBook> {
  const fallbackTitle = cleanBookFilename(file.name)
  const defaultResult: ParsedBook = {
    title: fallbackTitle,
    author: 'Неизвестный автор',
    format: 'pdf',
  }
  try {
    const pdfjs = await import('pdfjs-dist')
    await initPdfWorker()
    const data = await file.arrayBuffer()
    const loadingTask = pdfjs.getDocument({ data, ...pdfAssetOptions() })
    // Protected documents reject the very first request; asking for the
    // password once keeps them readable instead of silently dropping them.
    loadingTask.onPassword = (updatePassword: (p: string) => void, reason: number) => {
      const incorrect =
        (pdfjs as unknown as { PasswordResponses?: { PASSWORD_INCORRECT?: number } })
          .PasswordResponses?.PASSWORD_INCORRECT
      const message =
        reason === incorrect
          ? 'Пароль не подошёл. Попробуйте ещё раз:'
          : 'Файл защищён паролем. Введите пароль:'
      const password = window.prompt(message, '')
      if (!password) throw new Error('Password required')
      updatePassword(password)
    }
    try {
      const doc = await loadingTask.promise
      const info = await readPdfInfo(doc)

      let title = defaultResult.title
      let author = defaultResult.author
      const infoTitle = sanitizePdfInfoValue(info.Title, fallbackTitle)
      if (infoTitle) title = infoTitle
      const infoAuthor = sanitizePdfInfoValue(info.Author, '')
      if (infoAuthor) author = infoAuthor

      let cover: string | undefined
      try {
        cover = await renderPdfCover(doc)
      } catch (e) {
        logger.warn('PDF cover render failed', e)
      }

      return { title, author, cover, format: 'pdf' }
    } finally {
      await loadingTask.destroy().catch(() => {})
    }
  } catch (e) {
    logger.warn('PDF parse failed', e)
    return defaultResult
  }
}

/** Read /Title and /Author, treating a failure as "no info" rather than an error. */
async function readPdfInfo(
  doc: unknown,
): Promise<{ Title?: unknown; Author?: unknown }> {
  try {
    const meta = await (
      doc as { getMetadata(): Promise<{ info?: Record<string, unknown> } | null> }
    ).getMetadata()
    return (meta?.info ?? {}) as { Title?: unknown; Author?: unknown }
  } catch (e) {
    logger.warn('PDF info read failed', e)
    return {}
  }
}

/**
 * Guess title and author from an audiobook filename such as
 *   "Author_Title.mp3.zip" or "Author. Title.mp3"
 * Used as a fallback when the file carries no ID3 tags.
 */
export function audioMetaFromFilename(filename: string): ParsedBook {
  // Strip extension(s)
  const base = filename.replace(/\.mp3\.zip$/i, '').replace(/\.mp3$/i, '')
  let author = 'Неизвестный автор'
  let title = base

  // Pattern: "Firstname_Lastname._Series._Title" → author = "Firstname Lastname", title = rest
  const dotSpace = base.match(/^(.+?)\._(.+)$/)
  if (dotSpace) {
    author = dotSpace[1].replace(/_/g, ' ').trim()
    title = dotSpace[2].replace(/_/g, ' ').trim()
  } else {
    // Support Cyrillic characters in names
    const underscore = base.match(/^([А-Яа-яЁёA-Za-z\s\p{L}]+?)_(.+)$/u)
    if (underscore) {
      author = underscore[1].trim()
      title = underscore[2].replace(/_/g, ' ').trim()
    }
  }

  // Clean up: remove trailing dots
  title = title.replace(/\.$/, '').trim()
  author = author.replace(/\.$/, '').trim()

  return { title, author, format: 'mp3' }
}

/** Enough bytes to hold an ID3v2 tag with a front-cover picture. */
const AUDIO_TAG_BYTES = 512 * 1024
/** ID3v1 sits in the very last 128 bytes of a file. */
const AUDIO_TAIL_BYTES = 256

/**
 * Audio book metadata parser.
 * Reads the ID3 tags of the file — or of its first track when the audiobook is
 * a ZIP of tracks — and falls back to the filename when there are no tags.
 */
export async function parseAudioMeta(file: File): Promise<ParsedBook> {
  const fromName = audioMetaFromFilename(file.name)
  try {
    const tags = await readAudioTags(file)
    return {
      // TALB (album) names the book, TIT2 names the track/chapter
      title: tags.title || tags.album || fromName.title,
      author: tags.author || fromName.author,
      cover: tags.cover,
      format: 'mp3',
    }
  } catch (e) {
    logger.warn('Audio metadata parse failed', e)
    return fromName
  }
}

async function readAudioTags(file: File): Promise<AudioTags> {
  try {
    // Sniffed rather than taken from the extension: a re-parse runs on a stored
    // blob whose name we no longer know, and "audiobook.zip" and "book.mp3"
    // are indistinguishable by name once the name is gone.
    const head4 = new Uint8Array(await file.slice(0, 4).arrayBuffer())
    const isZip = head4[0] === 0x50 && head4[1] === 0x4b && head4[2] === 0x03 && head4[3] === 0x04

    if (isZip) {
      // Only the first track is needed, and only its head
      const head = await readFirstEntryHead(
        await file.arrayBuffer(),
        (name: string) => /\.mp3$/i.test(name),
        AUDIO_TAG_BYTES,
      )
      if (!head) return {}
      const tags = parseId3v2(head.data)
      // In a multi-track archive TIT2 names the chapter while TALB names the
      // book; a single file has no such distinction.
      if (head.matches > 1 && tags.album) return { ...tags, title: tags.album }
      return tags
    }

    const head = new Uint8Array(await file.slice(0, AUDIO_TAG_BYTES).arrayBuffer())
    const tags = parseId3v2(head)
    if (tags.title && tags.author) return tags
    const tail = new Uint8Array(
      await file.slice(Math.max(0, file.size - AUDIO_TAIL_BYTES)).arrayBuffer(),
    )
    return mergeAudioTags(tags, parseId3v1(tail))
  } catch (e) {
    logger.warn('Audio tags read failed', e)
    return {}
  }
}

export interface AudioTrack {
  name: string
  blob: Blob
  size: number
}

/**
 * Extract images from a CBZ file (Comic Book ZIP).
 * Returns images sorted by filename (natural sort).
 */
export async function extractCbzImages(file: File | Blob): Promise<{ name: string; blob: Blob }[]> {
  const buffer = await file.arrayBuffer()
  const entries = await unzip(buffer)

  // Collect image files (skip directories, metadata, etc.)
  const imageEntries: { name: string; data: Uint8Array }[] = []
  const imageExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif'])
  
  for (const [name, data] of Object.entries(entries)) {
    if (!name.endsWith('/')) {
      const ext = name.slice(name.lastIndexOf('.')).toLowerCase()
      if (imageExtensions.has(ext)) {
        imageEntries.push({ name, data })
      }
    }
  }

  // Natural sort by filename
  const naturalCompare = (a: string, b: string) => {
    const aParts = a.match(/(\d+|\D+)/g) || [a]
    const bParts = b.match(/(\d+|\D+)/g) || [b]
    for (let i = 0; i < Math.min(aParts.length, bParts.length); i++) {
      const aNum = /^\d+$/.test(aParts[i])
      const bNum = /^\d+$/.test(bParts[i])
      if (aNum && bNum) {
        const diff = parseInt(aParts[i], 10) - parseInt(bParts[i], 10)
        if (diff !== 0) return diff
      } else {
        const cmp = aParts[i].localeCompare(bParts[i])
        if (cmp !== 0) return cmp
      }
    }
    return aParts.length - bParts.length
  }

  imageEntries.sort((a, b) => naturalCompare(a.name, b.name))

  return imageEntries.map((img) => ({
    name: img.name,
    blob: new Blob([img.data.slice()], { type: 'image/' + img.name.slice(img.name.lastIndexOf('.') + 1).toLowerCase() }),
  }))
}

export async function extractAudioTracks(file: File | Blob): Promise<AudioTrack[]> {
  const buffer = await file.arrayBuffer()
  const entries = await unzip(buffer)

  // Only collect .mp3 files (skip directories, images, etc.)
  const mp3Entries: { name: string; data: Uint8Array }[] = []
  for (const [name, data] of Object.entries(entries)) {
    if (name.toLowerCase().endsWith('.mp3') && !name.endsWith('/')) {
      mp3Entries.push({ name, data })
    }
  }

  // Natural sort by filename (so track2.mp3 comes before track10.mp3)
  const naturalCompare = (a: string, b: string) => {
    const aParts = a.match(/(\d+|\D+)/g) || [a]
    const bParts = b.match(/(\d+|\D+)/g) || [b]
    for (let i = 0; i < Math.min(aParts.length, bParts.length); i++) {
      const aNum = /^\d+$/.test(aParts[i])
      const bNum = /^\d+$/.test(bParts[i])
      if (aNum && bNum) {
        const diff = parseInt(aParts[i], 10) - parseInt(bParts[i], 10)
        if (diff !== 0) return diff
      } else {
        const cmp = aParts[i].localeCompare(bParts[i])
        if (cmp !== 0) return cmp
      }
    }
    return aParts.length - bParts.length
  }

  mp3Entries.sort((a, b) => naturalCompare(a.name, b.name))

  return mp3Entries.map((t) => ({
    name: t.name,
    blob: new Blob([t.data.slice()], { type: 'audio/mpeg' }),
    size: t.data.byteLength,
  }))
}
