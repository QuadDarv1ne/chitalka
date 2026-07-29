'use client'

import { useSyncExternalStore } from 'react'
import dynamic from 'next/dynamic'
import { useReaderStore } from '@/store/reader-store'
import { Loader2 } from 'lucide-react'

const Library = dynamic(
  () => import('@/components/library/library').then((m) => m.Library),
  { loading: () => <LibrarySkeleton /> },
)

const Reader = dynamic(
  () => import('@/components/reader/reader').then((m) => m.Reader),
  { loading: () => <ReaderSkeleton /> },
)

const Stats = dynamic(
  () => import('@/components/stats/stats').then((m) => m.Stats),
  { ssr: false, loading: () => <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /> },
)

const Account = dynamic(
  () => import('@/components/account/account').then((m) => m.Account),
  { loading: () => <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /> },
)

function LibrarySkeleton() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 h-16 border-b bg-background/80" />
      <div className="container mx-auto flex-1 px-4 md:px-8 py-8">
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="aspect-[2/3] animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      </div>
    </div>
  )
}

function ReaderSkeleton() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 h-14 border-b" />
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    </div>
  )
}

function useHydrated() {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  )
}

export default function Home() {
  const view = useReaderStore((s) => s.view)
  const hydrated = useHydrated()

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
