'use client'

import { useEffect, useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Smartphone } from 'lucide-react'

/**
 * PWA setup:
 * - Adds <link rel="manifest"> to <head>
 * - Registers service worker for offline caching
 * - Listens for install prompt to show "Add to Home Screen" button
 */
export function PwaSetup() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [showInstallDialog, setShowInstallDialog] = useState(false)

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
        navigator.serviceWorker.register('/api/sw').catch(() => {
          // SW registration can fail in private mode / unsupported browsers —
          // the app still works fully (online), just without offline caching.
        })
      })
    }

    // Listen for the beforeinstallprompt event
    const handler = (e: Event) => {
      e.preventDefault()
      setDeferredPrompt(e as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', handler)

    return () => {
      window.removeEventListener('beforeinstallprompt', handler)
    }
  }, [])

  const handleInstall = useCallback(async () => {
    if (!deferredPrompt) {
      setShowInstallDialog(true)
      return
    }
    deferredPrompt.prompt()
    const { outcome } = await deferredPrompt.userChoice
    if (outcome === 'accepted') {
      setShowInstallDialog(false)
    }
    setDeferredPrompt(null)
  }, [deferredPrompt])

  return (
    <>
      {/* Install button — appears when the browser offers the install prompt */}
      {deferredPrompt && (
        <div className="fixed bottom-4 left-4 z-50">
          <Button
            onClick={handleInstall}
            className="gap-2 shadow-lg"
            size="lg"
          >
            <Smartphone className="h-5 w-5" />
            Установить приложение
          </Button>
        </div>
      )}

      {/* Install guide dialog (shown when there's no native prompt) */}
      <Dialog open={showInstallDialog} onOpenChange={setShowInstallDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Smartphone className="h-5 w-5 text-muted-foreground" />
              Установить на экран «Домой»
            </DialogTitle>
            <DialogDescription>
              Добавьте Читалку на главный экран для быстрого доступа и работы офлайн.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm text-muted-foreground">
            <p><strong>Chrome (Android):</strong> меню ⋮ → «Установить приложение» или «Добавить на гл. экран»</p>
            <p><strong>Safari (iOS):</strong> кнопка «Поделиться» → «На экран "Домой"»</p>
            <p><strong>Firefox (Android):</strong> меню ⋮ → «Установить»</p>
          </div>
          <DialogFooter>
            <Button onClick={() => setShowInstallDialog(false)}>Понятно</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

/**
 * Extend the Window interface to support the beforeinstallprompt event.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

declare global {
  interface Window {
    addEventListener<K extends 'beforeinstallprompt'>(
      type: K,
      listener: (this: Window, ev: BeforeInstallPromptEvent) => void,
      options?: boolean | AddEventListenerOptions,
    ): void
  }
}
