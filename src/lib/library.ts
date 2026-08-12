'use client'

import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import { logger } from '@/lib/logger'

export interface BookRecord {
  id: string
  title: string
  author: string
  format: 'epub' | 'txt' | 'md' | 'html' | 'pdf' | 'fb2' | 'mp3'
  size: number
  cover?: string // data URL
  blob: Blob
  addedAt: number
  lastOpenedAt?: number
  progress?: number // 0..1
  cfi?: string // EPUB CFI position
  textPosition?: number // char offset for txt
  pdfPage?: number // PDF page number
  audioTrack?: number // MP3 track index (0-based) for audiobooks
  audioTime?: number // seconds played within current track for audiobooks
  description?: string
  userId?: string | null // null = anonymous (logged out)
  rating?: number // 1-5 stars
}

interface LibraryDB extends DBSchema {
  books: {
    key: string
    value: BookRecord
    indexes: { 'by-addedAt': number; 'by-lastOpenedAt': number; 'by-userId': string }
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
    dbPromise = openDB<LibraryDB>('reader-library', 3, {
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

export async function getBook(id: string) {
  const db = await getDB()
  return db.get('books', id)
}

/**
 * Get all books, optionally filtered by userId.
 * Pass userId=null to get anonymous books only.
 * Pass userId=undefined to get all books (admin/dev mode).
 */
export async function getAllBooks(userId?: string | null) {
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
