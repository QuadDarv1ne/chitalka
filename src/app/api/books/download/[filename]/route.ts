import { logger } from '@/lib/logger'
import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import fs from 'node:fs'
import path from 'node:path'

export const dynamic = 'force-dynamic'

const BOOKS_DIR = path.join(process.cwd(), 'books')

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ filename: string }> },
) {
  const { filename } = await params

  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })
  }

  // Prevent path traversal — only allow filenames without slashes
  if (!filename || filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
    return NextResponse.json({ error: 'Invalid filename' }, { status: 400 })
  }

  const filePath = path.join(BOOKS_DIR, filename)

  try {
    const stat = fs.statSync(filePath)
    if (!stat.isFile()) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }

    // Determine content type
    const lower = filename.toLowerCase()
    let contentType = 'application/octet-stream'
    if (lower.endsWith('.pdf')) contentType = 'application/pdf'
    else if (lower.endsWith('.epub')) contentType = 'application/epub+zip'
    else if (lower.endsWith('.mp3.zip') || lower.endsWith('.zip')) contentType = 'application/zip'
    else if (lower.endsWith('.mp3')) contentType = 'audio/mpeg'
    else if (lower.endsWith('.txt')) contentType = 'text/plain'
    else if (lower.endsWith('.fb2')) contentType = 'application/x-fictionbook+xml'
    else if (lower.endsWith('.html') || lower.endsWith('.htm')) contentType = 'text/html'
    else if (lower.endsWith('.md')) contentType = 'text/markdown'

    // Stream instead of buffering: audiobook archives run past 100 MB, and a
    // readFileSync of each request would hold the whole file in memory.
    const stream = fs.createReadStream(filePath)
    const body = new ReadableStream({
      start(controller) {
        stream.on('data', (chunk) => {
          controller.enqueue(
            typeof chunk === 'string' ? new TextEncoder().encode(chunk) : new Uint8Array(chunk),
          )
        })
        stream.on('end', () => controller.close())
        stream.on('error', (e) => controller.error(e))
      },
      cancel() {
        stream.destroy()
      },
    })

    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(stat.size),
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        // Authenticated content behind a cookie session — 'public' would let
        // shared/proxy caches serve one user's download to another.
        'Cache-Control': 'private, max-age=3600',
      },
    })
  } catch (e) {
    logger.error('Download error', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
