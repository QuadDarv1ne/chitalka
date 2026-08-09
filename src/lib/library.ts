'use client'

import { openDB, type DBSchema, type IDBPDatabase } from 'idb'

export interface BookRecord {
  id: string
  title: string
  author: string
  format: 'epub' | 'txt' | 'md' | 'html' | 'pdf' | 'fb2'
  size: number
  cover?: string // data URL
  blob: Blob
  addedAt: number
  lastOpenedAt?: number
  progress?: number // 0..1
  cfi?: string // EPUB CFI position
  textPosition?: number // char offset for txt
  pdfPage?: number // PDF page number
  description?: string
  userId?: string | null // null = anonymous (logged out)
}

interface LibraryDB extends DBSchema {
  books: {
    key: string
    value: BookRecord
    indexes: { 'by-addedAt': number; 'by-lastOpenedAt': number; 'by-userId': string }
  }
}

let dbPromise: Promise<IDBPDatabase<LibraryDB>> | null = null

function getDB() {
  if (typeof window === 'undefined') {
    throw new Error('IndexedDB only available in browser')
  }
  if (!dbPromise) {
    // Reset on failure so a transient open error (blocked upgrade, quota,
    // private-mode SecurityError) doesn't poison every later call until a
    // page reload — the next getDB() attempt starts a fresh open.
    dbPromise = openDB<LibraryDB>('reader-library', 2, {
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
      },
    }).catch((e) => {
      dbPromise = null
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
 */
export async function reassignBooksToUser(
  oldUserId: string | null | undefined,
  newUserId: string,
) {
  const db = await getDB()
  const all = await db.getAll('books')
  const toUpdate = all.filter((b) => (b.userId ?? null) === (oldUserId ?? null))
  for (const book of toUpdate) {
    await db.put('books', { ...book, userId: newUserId })
  }
  return toUpdate.length
}
