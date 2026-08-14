import { NextResponse } from 'next/server'

export function GET() {
  const swJs = `
/**
 * Service Worker for offline support
 * Caches the app shell and allows reading cached books offline
 */

const CACHE_NAME = 'chitalka-v2'
const STATIC_ASSETS = [
  '/',
  '/manifest.json',
  '/logo.svg',
]

// Install event - cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch(() => {
        // One of the assets may be unavailable (e.g. during a partial
        // deployment) — a failed addAll would abort the install and leave
        // the old worker active. Swallow it: offline caching just degrades.
      })
    }),
  )
  // Activate immediately
  self.skipWaiting()
})

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name)),
      )
    }),
  )
  // Claim clients immediately
  self.clients.claim()
})

// Fetch event:
//  - navigations: network-first (fresh app shell, stale fallback offline)
//  - static assets: cache-first with runtime fill (offline-friendly)
self.addEventListener('fetch', (event) => {
  const request = event.request
  // Skip non-GET requests
  if (request.method !== 'GET') return

  // Skip API calls and external resources
  if (request.url.includes('/api/') || request.url.includes('googleapis.com')) return

  if (request.mode === 'navigate') {
    // Network-first for pages: users must see the latest build when online.
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.status === 200 && response.type === 'basic') {
            const responseToCache = response.clone()
            caches.open(CACHE_NAME).then((cache) => cache.put(request, responseToCache))
          }
          return response
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match('/'))),
    )
    return
  }

  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse
      }

      // Fetch from network and cache the response
      return fetch(request).then((response) => {
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response
        }

        const responseToCache = response.clone()
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(request, responseToCache)
        })

        return response
      }).catch(() => {
        // If offline and not cached, return the app shell
        if (request.destination === 'document') {
          return caches.match('/')
        }
      })
    }),
  )
})

// Background sync for progress updates (optional future enhancement)
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-progress') {
    event.waitUntil(syncProgressData())
  }
})

async function syncProgressData() {
  // Future: sync local progress to server when online
  console.log('Syncing progress data...')
}
  `.trim()

  return new NextResponse(swJs, {
    headers: {
      'Content-Type': 'application/javascript',
      'Cache-Control': 'no-cache',
    },
  })
}
