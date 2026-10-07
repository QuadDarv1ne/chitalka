import { logger } from '@/lib/logger'
import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { detectFormat } from '@/lib/format'
import fs from 'node:fs'
import path from 'node:path'

export const dynamic = 'force-dynamic'

const BOOKS_DIR = path.join(process.cwd(), 'books')

export interface CollectionFile {
  name: string
  size: number
  format: string
}

export async function GET() {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })
  }

  try {
    const files = fs.readdirSync(BOOKS_DIR, { withFileTypes: true })
    const list: CollectionFile[] = []
    for (const f of files) {
      if (!f.isFile()) continue
      const format = detectFormat(f.name)
      if (!format) continue
      const size = fs.statSync(path.join(BOOKS_DIR, f.name)).size
      list.push({ name: f.name, size, format })
    }
    list.sort((a, b) => a.name.localeCompare(b.name, 'ru'))

    return NextResponse.json({ files: list })
  } catch (e) {
    logger.error('Manifest error', e)
    return NextResponse.json({ files: [] })
  }
}
