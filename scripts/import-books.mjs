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
const BASE_URL = 'http://127.0.0.1:3000'
const BOOKS_DIR = path.join(__dirname, '..', 'books')
const OUTPUT_FILE = path.join(__dirname, '..', 'import-metadata.json')

// Demo account used only to authorize the collection API calls.
// The script downloads the book files from the server into the local
// books/ folder (if missing) — the actual IndexedDB import happens in
// the browser via the "Коллекция" button.
const DEMO_EMAIL = 'demo@reader.local'
const DEMO_PASSWORD = 'DemoPass123!'

const FORMAT_LABELS = {
  epub: 'EPUB',
  pdf: 'PDF',
  fb2: 'FB2',
  txt: 'TXT',
  md: 'Markdown',
  html: 'HTML',
  mp3: 'Аудиокнига',
}

/** Minimal cookie jar for Node http/https requests. */
let cookieHeader = ''

function request(url, { method = 'GET', body = null, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const client = u.protocol === 'https:' ? https : http
    const options = {
      method,
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      headers: { ...headers },
    }
    if (cookieHeader) options.headers.Cookie = cookieHeader
    const req = client.request(options, (res) => {
      const setCookie = res.headers['set-cookie']
      if (setCookie) {
        cookieHeader = setCookie
          .map((c) => c.split(';')[0])
          .join('; ')
      }
      let data = ''
      res.on('data', (chunk) => (data += chunk))
      res.on('end', () => {
        let parsed = null
        try { parsed = JSON.parse(data) } catch { /* not JSON */ }
        resolve({ status: res.statusCode, data, parsed, headers: res.headers })
      })
    })
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

/** Register (or log into) the demo account and keep the session cookie. */
async function authenticate() {
  let res = await request(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: DEMO_EMAIL, password: DEMO_PASSWORD }),
  })
  if (res.status === 200) {
    console.log('✓ Logged in as', DEMO_EMAIL)
    return true
  }
  res = await request(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: DEMO_EMAIL, password: DEMO_PASSWORD, name: 'Demo' }),
  })
  if (res.status === 200) {
    console.log('✓ Registered demo account:', DEMO_EMAIL)
    return true
  }
  console.error('✗ Auth failed:', res.status, res.data?.slice(0, 200))
  return false
}

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const client = u.protocol === 'https:' ? https : http
    const options = {
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      headers: {},
    }
    if (cookieHeader) options.headers.Cookie = cookieHeader
    client.get(options, (res) => {
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

  // 0. Authenticate so the collection API is accessible
  console.log('🔐 Authenticating...')
  const authed = await authenticate()
  if (!authed) {
    console.error('❌ Cannot access collection API without authentication.')
    process.exit(1)
  }

  // 1. Get manifest
  console.log('📋 Loading manifest...')
  const manifestRes = await request(`${BASE_URL}/api/books/manifest`)
  if (manifestRes.status !== 200) {
    console.error(`❌ Manifest request failed: ${manifestRes.status}`)
    process.exit(1)
  }
  const manifest = manifestRes.parsed || { files: [] }
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
