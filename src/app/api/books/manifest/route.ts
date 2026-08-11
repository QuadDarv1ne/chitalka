import { logger } from '@/lib/logger'
import { NextResponse } from 'next/server'
import fs from 'node:fs'
import path from 'node:path'

export const dynamic = 'force-dynamic'

const BOOKS_DIR = path.join(process.cwd(), 'books')

export interface CollectionFile {
  name: string
  size: number
  format: string
}

/** Map a file name to a reader format (same rules as client detectFormat). */
function detectFormat(filename: string): string | null {
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

export async function GET() {
  try {
    const files = fs.readdirSync(BOOKS_DIR, { withFileTypes: true })
    const list: CollectionFile[] = files
      .filter((f) => f.isFile())
      .map((f) => {
        const size = fs.statSync(path.join(BOOKS_DIR, f.name)).size
        return {
          name: f.name,
          size,
          format: detectFormat(f.name),
        }
      })
      .filter((f): f is CollectionFile => f.format !== null)
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'))

    return NextResponse.json({ files: list })
  } catch (e) {
    logger.error('Manifest error', e)
    return NextResponse.json({ files: [] })
  }
}
