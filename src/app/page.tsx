'use client'

import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import { useReaderStore } from '@/store/reader-store'
import { Library } from '@/components/library/library'
import { Reader } from '@/components/reader/reader'
import { Account } from '@/components/account/account'
import { Loader2 } from 'lucide-react'

// Lazy load Stats (recharts is heavy)
const Stats = dynamic(
  () => import('@/components/stats/stats').then((m) => m.Stats),
  { ssr: false, loading: () => <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /> },
)

export default function Home() {
  const view = useReaderStore((s) => s.view)
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHydrated(true)
  }, [])

  if (!hydrated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      {view === 'library' ? (
        <Library />
      ) : view === 'stats' ? (
        <Stats />
      ) : view === 'account' ? (
        <Account />
      ) : (
        <Reader />
      )}
    </main>
  )
}
