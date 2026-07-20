'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Loader2, ShieldCheck, ShieldAlert } from 'lucide-react'
import { useAuth } from '@/hooks/use-auth'
import { toast } from 'sonner'

/**
 * Watches for ?verify=TOKEN in URL and verifies email automatically.
 */
export function VerifyEmailWatcher() {
  const searchParams = useSearchParams()
  const [token, setToken] = useState<string | null>(null)
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading')
  const [errorMessage, setErrorMessage] = useState('')
  const { refresh } = useAuth()

  useEffect(() => {
    const t = searchParams.get('verify')
    if (t) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setToken(t)
    }
  }, [searchParams])

  useEffect(() => {
    if (!token) return
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStatus('loading')
    ;(async () => {
      try {
        const res = await fetch('/api/auth/verify-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        })
        const data = await res.json()
        if (cancelled) return
        if (res.ok) {
          setStatus('success')
          await refresh()
          toast.success('Email подтверждён!')
        } else {
          setStatus('error')
          setErrorMessage(data.error || 'Ошибка подтверждения')
        }
      } catch (e) {
        if (cancelled) return
        setStatus('error')
        setErrorMessage('Сеть или сервер недоступен')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [token, refresh])

  const close = () => {
    setToken(null)
    setStatus('loading')
    setErrorMessage('')
    const url = new URL(window.location.href)
    url.searchParams.delete('verify')
    window.history.replaceState({}, '', url.toString())
  }

  if (!token) return null

  return (
    <Dialog open={!!token} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {status === 'loading' && <Loader2 className="h-5 w-5 animate-spin" />}
            {status === 'success' && <ShieldCheck className="h-5 w-5 text-green-600" />}
            {status === 'error' && <ShieldAlert className="h-5 w-5 text-destructive" />}
            Подтверждение email
          </DialogTitle>
          <DialogDescription>
            {status === 'loading' && 'Проверяем токен подтверждения...'}
            {status === 'success' && 'Ваш email успешно подтверждён. Теперь вы можете пользоваться всеми функциями.'}
            {status === 'error' && (errorMessage || 'Ссылка недействительна')}
          </DialogDescription>
        </DialogHeader>
        {status !== 'loading' && (
          <Button onClick={close} className="w-full">
            Продолжить
          </Button>
        )}
      </DialogContent>
    </Dialog>
  )
}
