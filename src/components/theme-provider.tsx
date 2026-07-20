'use client'

import { useEffect } from 'react'
import { useReaderStore, themeBg, themeFg } from '@/store/reader-store'

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useReaderStore((s) => s.settings.theme)

  useEffect(() => {
    const root = document.documentElement
    // Apply CSS variables for reader themes (light/dark/sepia/contrast)
    root.style.setProperty('--reader-bg', themeBg[theme])
    root.style.setProperty('--reader-fg', themeFg[theme])

    // Map to shadcn dark class for UI chrome (library)
    if (theme === 'dark' || theme === 'contrast') {
      root.classList.add('dark')
    } else {
      root.classList.remove('dark')
    }
  }, [theme])

  return <>{children}</>
}
