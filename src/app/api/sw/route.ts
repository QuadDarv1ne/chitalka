import { NextResponse } from 'next/server'

export function GET() {
  const swJs = `
/**
 * Service Worker for offline support
 * Caches the app shell and allows reading cached books offline
 */

const CACHE_NAME = 'chitalka-v1'
const STATIC_ASSETS = [
  '/',
  '/manifest.json',
  '/logo.svg',
]

// Install event - cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS)
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

// Fetch event - serve from cache, fall back to network
self.addEventListener('fetch', (event) => {
  // Skip non-GET requests
  if (event.request.method !== 'GET') return

  // Skip API calls and external resources
  if (event.request.url.includes('/api/') || event.request.url.includes('googleapis.com')) return

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse
      }

      // Fetch from network and cache the response
      return fetch(event.request).then((response) => {
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response
        }

        const responseToCache = response.clone()
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache)
        })

        return response
      }).catch(() => {
        // If offline and not cached, return the app shell
        if (event.request.destination === 'document') {
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
