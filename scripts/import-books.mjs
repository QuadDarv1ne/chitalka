/**
 * CLI script to import all books from the books/ folder into the library.
 * Uses the /api/books/manifest and /api/books/download endpoints.
 * Saves parsed metadata to import-metadata.json for reference.
 *
 * Usage: node scripts/import-books.mjs
 * Requires: running dev server on localhost:3000
 */

import https from 'node:https'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BASE_URL = 'http://localhost:3000'
const BOOKS_DIR = path.join(__dirname, '..', 'books')
const OUTPUT_FILE = path.join(__dirname, '..', 'import-metadata.json')

const FORMAT_LABELS = {
  epub: 'EPUB',
  pdf: 'PDF',
  fb2: 'FB2',
  txt: 'TXT',
  md: 'Markdown',
  html: 'HTML',
  mp3: 'Аудиокнига',
}

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http
    client.get(url, (res) => {
      let data = ''
      res.on('data', (chunk) => (data += chunk))
      res.on('end', () => {
        try {
          resolve(JSON.parse(data))
        } catch (e) {
          reject(new Error(`JSON parse error: ${e.message} (${data.slice(0, 200)})`))
        }
      })
    }).on('error', reject)
  })
}

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http
    client.get(url, (res) => {
      if (res.statusCode >= 400) {
        res.resume()
        return reject(new Error(`HTTP ${res.statusCode}`))
      }
      const ws = fs.createWriteStream(destPath)
      res.pipe(ws)
      ws.on('finish', () => {
        ws.close()
        resolve()
      })
      ws.on('error', (e) => {
        fs.unlink(destPath, () => {})
        reject(e)
      })
      res.on('error', (e) => {
        fs.unlink(destPath, () => {})
        reject(e)
      })
    }).on('error', (e) => {
      fs.unlink(destPath, () => {})
      reject(e)
    })
  })
}

function formatSize(bytes) {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} ГБ`
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / 1024 / 1024)} МБ`
  return `${Math.round(bytes / 1024)} КБ`
}

function parseAudioMeta(filename) {
  const base = filename.replace(/\.mp3\.zip$/i, '').replace(/\.mp3$/i, '')
  let author = 'Неизвестный автор'
  let title = base

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

  title = title.replace(/\.$/, '').trim()
  author = author.replace(/\.$/, '').trim()

  return { title, author, format: 'mp3' }
}

async function main() {
  console.log('📚 Importing books from collection...\n')

  // 1. Get manifest
  console.log('📋 Loading manifest...')
  const manifest = await fetchJSON(`${BASE_URL}/api/books/manifest`)
  const files = manifest.files || []

  if (files.length === 0) {
    console.error('❌ No files found in collection. Is the dev server running?')
    process.exit(1)
  }

  console.log(`✅ Found ${files.length} files in collection\n`)

  // 2. Download and parse each file
  const metadata = []
  const tempDir = path.join(__dirname, '..', '.temp-import')
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true })

  let imported = 0
  let failed = 0
  let skipped = 0

  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    const progress = `${i + 1}/${files.length}`
    const pct = Math.round(((i + 1) / files.length) * 100)

    process.stdout.write(`[${progress}] ${pct}% ${file.name} `)

    try {
      // Check if file exists locally
      const localPath = path.join(BOOKS_DIR, file.name)
      if (!fs.existsSync(localPath)) {
        // Download from API
        const tempPath = path.join(tempDir, file.name)
        await downloadFile(`${BASE_URL}/api/books/download/${encodeURIComponent(file.name)}`, tempPath)
        if (!fs.existsSync(tempPath)) {
          throw new Error('File not downloaded')
        }
      } else {
        skipped++
      }

      // Parse metadata based on format
      let meta
      if (file.format === 'mp3') {
        meta = parseAudioMeta(file.name)
      } else if (file.format === 'pdf') {
        meta = { title: file.name.replace(/\.pdf$/i, ''), author: 'Неизвестный автор', format: 'pdf' }
      } else if (file.format === 'epub') {
        meta = { title: file.name.replace(/\.epub$/i, ''), author: 'Неизвестный автор', format: 'epub' }
      } else {
        meta = { title: file.name.replace(/\.[^.]+$/, ''), author: 'Локальный файл', format: file.format }
      }

      metadata.push({
        name: file.name,
        format: file.format,
        formatLabel: FORMAT_LABELS[file.format] || file.format.toUpperCase(),
        title: meta.title,
        author: meta.author,
        size: file.size,
        sizeLabel: formatSize(file.size),
        imported: true,
      })

      console.log(`✅ ${meta.title} (${meta.author})`)
      imported++
    } catch (e) {
      console.log(`❌ ${e.message}`)
      metadata.push({
        name: file.name,
        format: file.format,
        size: file.size,
        imported: false,
        error: e.message,
      })
      failed++
    }
  }

  // Cleanup temp
  try { fs.rmSync(tempDir, { recursive: true, force: true }) } catch (e) {
    console.warn(`⚠️ Temp cleanup failed: ${e.message}`)
  }

  // 3. Save metadata
  const output = {
    generatedAt: new Date().toISOString(),
    total: files.length,
    imported,
    failed,
    skipped,
    books: metadata,
  }
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2), 'utf-8')

  // 4. Summary
  console.log(`\n${'='.repeat(50)}`)
  console.log(`📊 Summary:`)
  console.log(`   Total files:  ${files.length}`)
  console.log(`   Imported:     ${imported}`)
  console.log(`   Failed:       ${failed}`)
  console.log(`   Skipped:      ${skipped}`)
  console.log(`\n💾 Metadata saved to: ${OUTPUT_FILE}`)
  console.log(`\nℹ️  Note: Books are stored in IndexedDB (browser).`)
  console.log(`   To import into the app, use the "Коллекция" button`)
  console.log(`   in the library UI, or run the app and import manually.`)
  console.log(`${'='.repeat(50)}\n`)
}

main().catch((e) => {
  console.error('❌ Import failed:', e.message)
  process.exit(1)
})
