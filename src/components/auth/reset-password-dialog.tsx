'use client'

import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2, Lock, KeyRound } from 'lucide-react'
import { useAuth } from '@/hooks/use-auth'
import { toast } from 'sonner'

interface Props {
  open: boolean
  token: string
  onOpenChange: (open: boolean) => void
}

export function ResetPasswordDialog({ open, token, onOpenChange }: Props) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const { refresh } = useAuth()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (password !== confirm) {
      toast.error('Пароли не совпадают')
      return
    }
    if (password.length < 8) {
      toast.error('Пароль должен быть не менее 8 символов')
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Не удалось сбросить пароль')
        return
      }
      toast.success('Пароль изменён! Вы автоматически вошли в аккаунт')
      await refresh()
      onOpenChange(false)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5" />
            Новый пароль
          </DialogTitle>
          <DialogDescription>
            Придумайте новый пароль для вашего аккаунта
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="reset-password">Новый пароль</Label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                id="reset-password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Минимум 8 символов"
                className="pl-9"
                autoFocus
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="reset-confirm">Повторите пароль</Label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                id="reset-confirm"
                type="password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Введите пароль ещё раз"
                className="pl-9"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="submit"
              className="w-full"
              disabled={submitting || !password || !confirm}
            >
              {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {submitting ? 'Сохранение...' : 'Установить новый пароль'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
