'use client'

import type { BookRecord } from '@/lib/library'
import { initPdfWorker } from '@/lib/pdf-worker'
import { decodeTextBytes } from '@/lib/text-encoding'

export interface ParsedBook {
  title: string
  author: string
  cover?: string
  description?: string
  format: 'epub' | 'txt' | 'md' | 'html' | 'pdf' | 'fb2' | 'mp3'
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
    // Use JSZip-style approach via DOM unzip
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
    console.warn('EPUB parse failed', e)
    return defaultResult
  }
}

interface ZipEntry {
  [path: string]: Uint8Array
}

async function unzip(buffer: ArrayBuffer): Promise<ZipEntry> {
  // Minimal unzip — only stored (0) and deflated (8), with safety caps
  const view = new DataView(buffer)
  const entries: ZipEntry = {}
  let offset = 0
  const MAX_ENTRIES = 10000
  const MAX_ENTRY_SIZE = 64 * 1024 * 1024 // 64 MB per entry
  while (offset < buffer.byteLength - 4 && Object.keys(entries).length < MAX_ENTRIES) {
    const sig = view.getUint32(offset, true)
    if (sig !== 0x04034b50) break
    const flags = view.getUint16(offset + 6, true)
    const compressionMethod = view.getUint16(offset + 8, true)
    let compressedSize = view.getUint32(offset + 18, true)
    let uncompressedSize = view.getUint32(offset + 22, true)
    const filenameLen = view.getUint16(offset + 26, true)
    const extraLen = view.getUint16(offset + 28, true)
    const filename = new TextDecoder().decode(
      new Uint8Array(buffer, offset + 30, filenameLen),
    )
    const dataStart = offset + 30 + filenameLen + extraLen
    const usesDataDescriptor = (flags & 0x8) !== 0

    if (usesDataDescriptor && compressedSize === 0 && uncompressedSize === 0) {
      // Bit 3: sizes live in the data descriptor after the data — scan for it
      const scanEnd = Math.min(buffer.byteLength, dataStart + MAX_ENTRY_SIZE)
      let descPos = -1
      for (let i = dataStart; i < scanEnd - 4; i++) {
        if (view.getUint32(i, true) === 0x08074b50) {
          descPos = i
          break
        }
      }
      if (descPos === -1) {
        // No descriptor found — a corrupt entry. Resume scanning for the
        // next local file header so later entries (e.g. container.xml) survive.
        let next = -1
        for (let i = dataStart; i < scanEnd - 4; i++) {
          if (view.getUint32(i, true) === 0x04034b50) {
            next = i
            break
          }
        }
        if (next === -1) break
        offset = next
        continue
      }
      compressedSize = view.getUint32(descPos + 4, true)
      uncompressedSize = view.getUint32(descPos + 8, true)
      // The descriptor with the 0x08074b50 signature is 16 bytes
      // (sig + CRC + compressed size + uncompressed size). Jumping
      // past only 12 bytes would land mid-descriptor and drop every
      // subsequent entry from the archive.
      offset = descPos + 16
    } else {
      offset = dataStart + compressedSize
    }

    // Safety caps (zip-bomb protection)
    if (compressedSize > MAX_ENTRY_SIZE || uncompressedSize > MAX_ENTRY_SIZE) continue

    try {
      if (compressionMethod === 0) {
        entries[filename] = new Uint8Array(buffer, dataStart, compressedSize)
      } else if (compressionMethod === 8) {
        // Use DecompressionStream (deflate-raw)
        const compressedData = new Uint8Array(buffer, dataStart, compressedSize)
        const blob = new Blob([compressedData])
        const ds = new DecompressionStream('deflate-raw')
        const stream = blob.stream().pipeThrough(ds)
        const decompressed = await new Response(stream).arrayBuffer()
        entries[filename] = new Uint8Array(decompressed)
      }
    } catch (e) {
      // A corrupt entry must not abort the whole archive
      console.warn('EPUB: failed to read entry', filename, e)
    }
  }
  return entries
}

async function readText(data?: Uint8Array): Promise<string | null> {
  if (!data) return null
  return new TextDecoder('utf-8').decode(data)
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
    title: file.name.replace(/\.fb2$/i, ''),
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
    if (parseError) return defaultResult

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
        // Find cover image reference
        const coverEl = doc.querySelector('coverpage > image')
        if (!coverEl) return undefined
        const href =
          coverEl.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ||
          coverEl.getAttribute('href') ||
          coverEl.getAttribute('l:href')
        if (!href) return undefined
        const id = href.replace(/^#/, '')
        // Find binary with matching id
        const binary = doc.querySelector(`binary[id="${id}"]`)
        if (!binary) return undefined
        const contentType = binary.getAttribute('content-type') || 'image/jpeg'
        const data = binary.textContent?.replace(/\s/g, '') || ''
        return `data:${contentType};base64,${data}`
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
    console.warn('FB2 parse failed', e)
    return defaultResult
  }
}

/**
 * FB2 → plain text converter. Reads <body> <section> <p> elements,
 * preserving chapter boundaries for pagination.
 */
export async function parseFb2Content(file: File): Promise<string> {
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
    console.error('FB2 content parse failed', e)
    return ''
  }
}

export async function parseTextMeta(file: File, format: 'txt' | 'md' | 'html'): Promise<ParsedBook> {
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
 * PDF metadata parser using pdfjs-dist.
 * Extracts title from info dict, generates a cover from the first page.
 */
export async function parsePdfMeta(file: File): Promise<ParsedBook> {
  const defaultResult: ParsedBook = {
    title: file.name.replace(/\.pdf$/i, ''),
    author: 'Неизвестный автор',
    format: 'pdf',
  }
  try {
    const pdfjs = await import('pdfjs-dist')
    await initPdfWorker()
    const data = await file.arrayBuffer()
    const loadingTask = pdfjs.getDocument({ data })
    const doc = await loadingTask.promise
    let title = defaultResult.title
    let author = defaultResult.author
    try {
      const meta = await doc.getMetadata().catch(() => null)
      if (meta?.info) {
        const info = meta.info as any
        if (info.Title) title = String(info.Title)
        if (info.Author) author = String(info.Author)
      }
      // Render first page as cover
      let cover: string | undefined
      try {
        const page = await doc.getPage(1)
        const viewport = page.getViewport({ scale: 0.5 })
        const canvas = document.createElement('canvas')
        canvas.width = viewport.width
        canvas.height = viewport.height
        const ctx = canvas.getContext('2d')!
        await page.render({ canvasContext: ctx, viewport, canvas } as any).promise
        cover = canvas.toDataURL('image/jpeg', 0.7)
      } catch (e) {
        console.warn('PDF cover render failed', e)
      }
      return { title, author, cover, format: 'pdf' }
    } finally {
      await loadingTask.destroy().catch(() => {})
    }
  } catch (e) {
    console.warn('PDF parse failed', e)
    return defaultResult
  }
}

/**
 * Audio book metadata parser.
 * Extracts title/author from filename patterns like:
 *   "Author_Title.mp3.zip" or "Author_Title.mp3"
 */
export function parseAudioMeta(filename: string): ParsedBook {
  // Strip extension(s)
  const base = filename.replace(/\.mp3\.zip$/i, '').replace(/\.mp3$/i, '')
  // Common patterns: "Author_Title" or "Author. Title"
  // Try splitting on first underscore, dot-space, or just underscore
  let author = 'Неизвестный автор'
  let title = base

  // Pattern: "Firstname_Lastname._Series._Title" → author = "Firstname Lastname", title = rest
  const dotSpace = base.match(/^(.+?)\._(.+)$/)
  if (dotSpace) {
    author = dotSpace[1].replace(/_/g, ' ').trim()
    title = dotSpace[2].replace(/_/g, ' ').trim()
  } else {
    const underscore = base.match(/^([A-Za-zА-Яа-яЁё\s]+?)_(.+)$/)
    if (underscore) {
      author = underscore[1].trim()
      title = underscore[2].replace(/_/g, ' ').trim()
    }
  }

  // Clean up: decode transliteration hints, remove trailing dots
  title = title.replace(/\.$/, '').trim()
  author = author.replace(/\.$/, '').trim()

  return { title, author, format: 'mp3' }
}

export interface AudioTrack {
  name: string
  blob: Blob
  size: number
}

/**
 * Extract MP3 tracks from a .mp3.zip archive.
 * Returns tracks sorted by filename (natural sort).
 */
export async function extractAudioTracks(file: File | Blob): Promise<AudioTrack[]> {
  const buffer = await file.arrayBuffer()
  const view = new DataView(buffer)
  const tracks: { name: string; data: Uint8Array }[] = []
  let offset = 0
  const MAX_ENTRY_SIZE = 512 * 1024 * 1024 // 512 MB per entry (audio files can be large)

  while (offset < buffer.byteLength - 4 && tracks.length < 10000) {
    const sig = view.getUint32(offset, true)
    if (sig !== 0x04034b50) break
    const flags = view.getUint16(offset + 6, true)
    const compressionMethod = view.getUint16(offset + 8, true)
    let compressedSize = view.getUint32(offset + 18, true)
    let uncompressedSize = view.getUint32(offset + 22, true)
    const filenameLen = view.getUint16(offset + 26, true)
    const extraLen = view.getUint16(offset + 28, true)
    const filename = new TextDecoder().decode(
      new Uint8Array(buffer, offset + 30, filenameLen),
    )
    const dataStart = offset + 30 + filenameLen + extraLen
    const usesDataDescriptor = (flags & 0x8) !== 0

    if (usesDataDescriptor && compressedSize === 0 && uncompressedSize === 0) {
      const scanEnd = Math.min(buffer.byteLength, dataStart + MAX_ENTRY_SIZE)
      let descPos = -1
      for (let i = dataStart; i < scanEnd - 4; i++) {
        if (view.getUint32(i, true) === 0x08074b50) {
          descPos = i
          break
        }
      }
      if (descPos === -1) {
        let next = -1
        for (let i = dataStart; i < scanEnd - 4; i++) {
          if (view.getUint32(i, true) === 0x04034b50) {
            next = i
            break
          }
        }
        if (next === -1) break
        offset = next
        continue
      }
      compressedSize = view.getUint32(descPos + 4, true)
      uncompressedSize = view.getUint32(descPos + 8, true)
      offset = descPos + 16
    } else {
      offset = dataStart + compressedSize
    }

    if (compressedSize > MAX_ENTRY_SIZE || uncompressedSize > MAX_ENTRY_SIZE) continue

    // Only collect .mp3 files (skip directories, images, etc.)
    if (!filename.toLowerCase().endsWith('.mp3')) continue
    // Skip directory entries
    if (filename.endsWith('/')) continue

    try {
      let data: Uint8Array
      if (compressionMethod === 0) {
        data = new Uint8Array(buffer, dataStart, compressedSize)
      } else if (compressionMethod === 8) {
        const compressedData = new Uint8Array(buffer, dataStart, compressedSize)
        const blob = new Blob([compressedData])
        const ds = new DecompressionStream('deflate-raw')
        const stream = blob.stream().pipeThrough(ds)
        const decompressed = await new Response(stream).arrayBuffer()
        data = new Uint8Array(decompressed)
      } else {
        continue
      }
      tracks.push({ name: filename, data })
    } catch (e) {
      console.warn('Audio: failed to read entry', filename, e)
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

  tracks.sort((a, b) => naturalCompare(a.name, b.name))

  return tracks.map((t) => ({
    name: t.name,
    // .slice() returns a fresh Uint8Array<ArrayBuffer>, which is a valid BlobPart
    blob: new Blob([t.data.slice()], { type: 'audio/mpeg' }),
    size: t.data.byteLength,
  }))
}
