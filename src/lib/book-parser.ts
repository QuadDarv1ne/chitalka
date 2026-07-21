'use client'

import type { BookRecord } from '@/lib/library'
import { initPdfWorker } from '@/lib/pdf-worker'

export interface ParsedBook {
  title: string
  author: string
  cover?: string
  description?: string
  format: 'epub' | 'txt' | 'md' | 'html' | 'pdf' | 'fb2'
}

export function detectFormat(filename: string): BookRecord['format'] | null {
  const lower = filename.toLowerCase()
  if (lower.endsWith('.epub')) return 'epub'
  if (lower.endsWith('.pdf')) return 'pdf'
  if (lower.endsWith('.fb2')) return 'fb2'
  if (lower.endsWith('.md')) return 'md'
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'html'
  if (lower.endsWith('.txt')) return 'txt'
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
        const blob = new Blob([coverEntry.buffer as ArrayBuffer])
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
  // Minimal unzip — only stored (0) and deflated (8)
  const view = new DataView(buffer)
  const entries: ZipEntry = {}
  let offset = 0
  // Need inflate for deflated data — use browser DecompressionStream
  while (offset < buffer.byteLength - 4) {
    const sig = view.getUint32(offset, true)
    if (sig !== 0x04034b50) break
    const compressionMethod = view.getUint16(offset + 8, true)
    const compressedSize = view.getUint32(offset + 18, true)
    const uncompressedSize = view.getUint32(offset + 22, true)
    const filenameLen = view.getUint16(offset + 26, true)
    const extraLen = view.getUint16(offset + 28, true)
    const filename = new TextDecoder().decode(
      new Uint8Array(buffer, offset + 30, filenameLen),
    )
    const dataStart = offset + 30 + filenameLen + extraLen
    const compressedData = new Uint8Array(buffer, dataStart, compressedSize)
    if (compressionMethod === 0) {
      entries[filename] = compressedData
    } else if (compressionMethod === 8) {
      // Use DecompressionStream (deflate-raw)
      const blob = new Blob([compressedData])
      const ds = new DecompressionStream('deflate-raw')
      const stream = blob.stream().pipeThrough(ds)
      const decompressed = await new Response(stream).arrayBuffer()
      entries[filename] = new Uint8Array(decompressed)
    }
    offset = dataStart + compressedSize
    if (compressedSize === 0 && uncompressedSize === 0) {
      // sometimes a directory entry — just continue
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
    if (id && href) manifest[id] = decodeURIComponent(href)
  }
  return { title, author, manifest }
}

function findCoverId(opfText: string): string | null {
  const m1 = opfText.match(/<meta[^>]*name="cover"[^>]*content="([^"]+)"/i)
  if (m1) return m1[1]
  const m2 = opfText.match(/<item[^>]*id="(cover[^"]*)"[^>]*href="([^"]+)"[^>]*media-type="image\/[^"]+"/i)
  if (m2) return m2[1]
  return null
}

function resolvePath(opfPath: string, href: string): string {
  const dir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : ''
  return (dir + href).replace(/^\.\//, '')
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
    const text = await file.text()
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
        const coverEl = doc.querySelector('coverpage > image') || doc.querySelector('image[l\\:href]')
        const href = coverEl?.getAttribute('l:href') || coverEl?.getAttribute('xlink:href') || coverEl?.getAttribute('href')
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
    const text = await file.text()
    const parser = new DOMParser()
    const cleaned = text.replace(/^<\?xml[^>]*\?>/, '')
    const doc = parser.parseFromString(cleaned, 'application/xml')

    // Try to detect FB2 namespaces
    const body = doc.querySelector('body') || doc.getElementsByTagName('body')[0]
    if (!body) return ''

    const result: string[] = []

    const processSection = (section: Element, level: number) => {
      // Section title
      const title = section.querySelector(':scope > title')
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
      const paragraphs = Array.from(section.children).filter(
        (c) => c.tagName.toLowerCase() === 'p',
      )
      for (const p of paragraphs) {
        const pText = p.textContent?.trim().replace(/\s+/g, ' ')
        if (pText) result.push(pText)
      }

      // Sub-sections
      const subsections = Array.from(section.children).filter(
        (c) => c.tagName.toLowerCase() === 'section',
      )
      for (const sub of subsections) {
        result.push('')
        processSection(sub, level + 1)
      }
    }

    // Get top-level sections
    const topSections = Array.from(body.children).filter(
      (c) => c.tagName.toLowerCase() === 'section',
    )
    if (topSections.length === 0) {
      // No sections — just paragraphs in body
      const paragraphs = Array.from(body.children).filter(
        (c) => c.tagName.toLowerCase() === 'p',
      )
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
  const text = await file.slice(0, 4096).text()
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
    const doc = await pdfjs.getDocument({ data }).promise
    const meta = await doc.getMetadata().catch(() => null)
    let title = defaultResult.title
    let author = defaultResult.author
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
  } catch (e) {
    console.warn('PDF parse failed', e)
    return defaultResult
  }
}
