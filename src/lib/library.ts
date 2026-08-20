'use client'

import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import { logger } from '@/lib/logger'

export interface BookRecord {
  id: string
  title: string
  author: string
  format: 'epub' | 'txt' | 'md' | 'html' | 'pdf' | 'fb2' | 'mp3' | 'cbz'
  size: number
  cover?: string // data URL
  blob: Blob
  addedAt: number
  lastOpenedAt?: number
  progress?: number // 0..1
  cfi?: string // EPUB CFI position
  textPosition?: number // char offset for txt
  pdfPage?: number // PDF page number
  cbzPage?: number // CBZ page index (0-based)
  audioTrack?: number // MP3 track index (0-based) for audiobooks
  audioTime?: number // seconds played within current track for audiobooks
  description?: string
  userId?: string | null // null = anonymous (logged out)
  rating?: number // 1-5 stars
  favorite?: boolean // is this book a favorite?
}

interface LibraryDB extends DBSchema {
  books: {
    key: string
    value: BookRecord
    indexes: { 'by-addedAt': number; 'by-lastOpenedAt': number; 'by-userId': string; 'by-favorite': number }
  }
}

let dbPromise: Promise<IDBPDatabase<LibraryDB>> | null = null
let openAttempts = 0
const MAX_OPEN_ATTEMPTS = 3 // Prevent infinite retry loops on persistent failures

function getDB() {
  if (typeof window === 'undefined') {
    throw new Error('IndexedDB only available in browser')
  }
  if (!dbPromise) {
    // Limit retry attempts to avoid infinite loops when IndexedDB is
    // persistently unavailable (quota exceeded, private mode, etc.).
    openAttempts++
    if (openAttempts > MAX_OPEN_ATTEMPTS) {
      const err = new Error('IndexedDB: max open attempts exceeded')
      logger.error('IndexedDB open failed after retries', err)
      throw err
    }

    // Reset on failure so a transient open error (blocked upgrade, quota,
    // private-mode SecurityError) doesn't poison every later call until a
    // page reload — the next getDB() attempt starts a fresh open.
    dbPromise = openDB<LibraryDB>('reader-library', 4, {
      upgrade(db, oldVersion, _newVersion, transaction) {
        if (oldVersion < 1) {
          const store = db.createObjectStore('books', { keyPath: 'id' })
          store.createIndex('by-addedAt', 'addedAt')
          store.createIndex('by-lastOpenedAt', 'lastOpenedAt')
          store.createIndex('by-userId', 'userId')
        }
        if (oldVersion === 1) {
          // v1 → v2: add userId index
          const store = transaction.objectStore('books')
          if (!store.indexNames.contains('by-userId')) {
            store.createIndex('by-userId', 'userId')
          }
        }
        if (oldVersion === 2) {
          // v2 → v3: no schema changes, but reset stale DB state
        }
        if (oldVersion === 3) {
          // v3 → v4: add favorite index
          const store = transaction.objectStore('books')
          if (!store.indexNames.contains('by-favorite')) {
            store.createIndex('by-favorite', 'favorite')
          }
        }
      },
    }).catch((e) => {
      dbPromise = null
      openAttempts++
      logger.warn('IndexedDB open failed (attempt', openAttempts, ')', e)
      throw e
    })
  }
  return dbPromise
}

export async function saveBook(book: BookRecord) {
  const db = await getDB()
  await db.put('books', book)
}

/**
 * Hash the head of a Blob (first 64 KiB) for duplicate detection.
 * crypto.subtle is only available in secure contexts (HTTPS or localhost);
 * fall back to a fast non-crypto hash (FNV-1a 64-bit) on plain HTTP / LAN
 * deployments so dedup still works — it's a fingerprint, not a security
 * boundary.
 */
export async function hashFileHead(source: Blob): Promise<string> {
  const head = await source.slice(0, 64 * 1024).arrayBuffer()
  if (typeof crypto !== 'undefined' && crypto.subtle?.digest) {
    const digest = await crypto.subtle.digest('SHA-256', head)
    const bytes = new Uint8Array(digest)
    let hex = ''
    for (const b of bytes) hex += b.toString(16).padStart(2, '0')
    return hex
  }
  const bytes = new Uint8Array(head)
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (let i = 0; i < bytes.length; i++) {
    h1 ^= bytes[i]
    h1 = Math.imul(h1, 0x01000193)
    h2 ^= bytes[i] + 1
    h2 = Math.imul(h2, 0x85ebca6b)
  }
  return `${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`
}

export async function getBook(id: string) {
  const db = await getDB()
  return db.get('books', id)
}

/**
 * Get all books, optionally filtered by userId.
 * Pass userId=null to get anonymous books only.
 * Pass userId=undefined to get all books (admin/dev mode).
 */
export async function getAllBooks(userId?: string | null, options?: { favoriteOnly?: boolean }) {
  const db = await getDB()
  let all: BookRecord[]
  if (typeof userId === 'string') {
    all = await db.getAllFromIndex('books', 'by-userId', userId)
  } else if (userId === null) {
    all = await db.getAll('books')
    all = all.filter((b) => (b.userId ?? null) === null)
  } else {
    all = await db.getAll('books')
  }
  // Filter by favorite if requested
  if (options?.favoriteOnly) {
    all = all.filter((b) => b.favorite)
  }
  return all.sort((a, b) => (b.lastOpenedAt ?? b.addedAt) - (a.lastOpenedAt ?? a.addedAt))
}

export async function deleteBook(id: string) {
  // Route through the same per-id queue as updateBook, otherwise a queued
  // update that lands after the delete would resurrect the record.
  const prev = writeQueues.get(id) ?? Promise.resolve()
  const next = prev.then(async () => {
    const db = await getDB()
    await db.delete('books', id)
  })
  writeQueues.set(id, next.catch(() => {}))
  return next
}

// Serialize read-modify-write per book: page turns fire many unawaited
// updateBook calls, and interleaved reads could persist a stale patch last.
const writeQueues = new Map<string, Promise<void>>()

/** Await all pending writes for a book (used before reading/uploading). */
export async function flushBookWrites(id: string): Promise<void> {
  await writeQueues.get(id)
}

export async function updateBook(
  id: string,
  patch: Partial<Omit<BookRecord, 'id'>>,
) {
  const prev = writeQueues.get(id) ?? Promise.resolve()
  const next = prev.then(async () => {
    const db = await getDB()
    const existing = await db.get('books', id)
    if (!existing) return
    await db.put('books', { ...existing, ...patch })
  })
  writeQueues.set(id, next.catch(() => {}))
  return next
}

/**
 * Reassign all books to a new userId (e.g. after login).
 * Useful when user had anonymous books and logs in.
 * Uses write queues to prevent race conditions with concurrent updates.
 */
export async function reassignBooksToUser(
  oldUserId: string | null | undefined,
  newUserId: string,
) {
  const db = await getDB()
  const all = await db.getAll('books')
  const toUpdate = all.filter((b) => (b.userId ?? null) === (oldUserId ?? null))
  // Flush all pending writes before reassignment, then queue updates.
  // The record is re-read inside the queued task, so patches enqueued
  // after the getAll() above are not clobbered by a stale snapshot.
  const promises: Promise<void>[] = []
  for (const book of toUpdate) {
    const prev = writeQueues.get(book.id) ?? Promise.resolve()
    const next = prev.then(async () => {
      const db = await getDB()
      const current = await db.get('books', book.id)
      await db.put('books', { ...(current ?? book), userId: newUserId })
    })
    writeQueues.set(book.id, next.catch(() => {}))
    promises.push(next)
  }
  await Promise.all(promises)
  return toUpdate.length
}

/**
 * Toggle the favorite status of a book.
 */
export async function toggleFavorite(bookId: string): Promise<boolean> {
  const db = await getDB()
  const book = await db.get('books', bookId)
  if (!book) return false
  
  const newFavorite = !book.favorite
  await db.put('books', { ...book, favorite: newFavorite })
  return newFavorite
}
