'use client'

import { useEffect } from 'react'

/**
 * PWA setup:
 * - Adds <link rel="manifest"> to <head>
 * - Registers service worker for offline caching
 * - Listens for install prompt to show "Add to Home Screen" button
 */
export function PwaSetup() {
  useEffect(() => {
    // Add manifest link
    const link = document.createElement('link')
    link.rel = 'manifest'
    link.href = '/manifest.json'
    document.head.appendChild(link)

    // Add Apple touch icon meta tags
    const appleTags = [
      { tag: 'link' as const, rel: 'apple-touch-icon', href: '/logo.svg' },
      { tag: 'meta' as const, name: 'apple-mobile-web-app-capable', content: 'yes' },
      { tag: 'meta' as const, name: 'apple-mobile-web-app-status-bar-style', content: 'default' },
      { tag: 'meta' as const, name: 'apple-mobile-web-app-title', content: 'Читалка' },
    ]
    appleTags.forEach((meta) => {
      const el = document.createElement(meta.tag)
      if (meta.tag === 'link') {
        ;(el as HTMLLinkElement).rel = 'apple-touch-icon'
        ;(el as HTMLLinkElement).href = '/logo.svg'
      } else {
        ;(el as HTMLMetaElement).name = meta.name
        ;(el as HTMLMetaElement).content = meta.content
      }
      document.head.appendChild(el)
    })

    // Register service worker
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker
          .register('/sw.js')
          .then((reg) => console.log('SW registered:', reg.scope))
          .catch((err) => console.error('SW registration failed:', err))
      })
    }
  }, [])

  return null
}
