'use client'

import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { useAuth } from '@/hooks/use-auth'
import { Loader2, Mail, Lock, User, ShieldCheck, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'

type Mode = 'login' | 'register' | 'forgot'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialMode?: Mode
  onSuccess?: () => void
}

export function AuthDialog({ open, onOpenChange, initialMode = 'login', onSuccess }: Props) {
  const [mode, setMode] = useState<Mode>(initialMode)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [rememberMe, setRememberMe] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [resetSent, setResetSent] = useState(false)
  const [resetLink, setResetLink] = useState<string | null>(null)
  const [registeredVerifyLink, setRegisteredVerifyLink] = useState<string | null>(null)
  const { login, register } = useAuth()

  const reset = () => {
    setEmail('')
    setPassword('')
    setName('')
    setRememberMe(false)
    setResetSent(false)
    setResetLink(null)
    setRegisteredVerifyLink(null)
  }

  const handleClose = (open: boolean) => {
    if (!open) reset()
    onOpenChange(open)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    try {
      if (mode === 'login') {
        const result = await login(email, password, rememberMe)
        if (!result.ok) {
          toast.error(result.error || 'Не удалось войти')
          return
        }
        toast.success('С возвращением!')
        handleClose(false)
        onSuccess?.()
      } else if (mode === 'register') {
        const result = await register(email, password, name || undefined, rememberMe)
        if (!result.ok) {
          toast.error(result.error || 'Не удалось зарегистрироваться')
          return
        }
        toast.success('Аккаунт создан! Отправили письмо для подтверждения email.')
        if (result.verifyLink) {
          setRegisteredVerifyLink(result.verifyLink)
        } else {
          handleClose(false)
          onSuccess?.()
        }
      } else if (mode === 'forgot') {
        const res = await fetch('/api/auth/forgot-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        })
        const data = await res.json()
        if (!res.ok) {
          toast.error(data.error || 'Ошибка')
          return
        }
        setResetSent(true)
        if (data._devResetLink) {
          setResetLink(data._devResetLink)
        }
        toast.success('Инструкции отправлены на email')
      }
    } finally {
      setSubmitting(false)
    }
  }

  const titles: Record<Mode, string> = {
    login: 'Вход в аккаунт',
    register: 'Регистрация',
    forgot: 'Восстановление пароля',
  }

  const descriptions: Record<Mode, string> = {
    login: 'Войдите, чтобы синхронизировать библиотеку',
    register: 'Создайте аккаунт для синхронизации между устройствами',
    forgot: 'Введите email — пришлём ссылку для сброса пароля',
  }

  const submitLabels: Record<Mode, string> = {
    login: 'Войти',
    register: 'Создать аккаунт',
    forgot: 'Отправить ссылку',
  }

  // Show verify-link notice after registration (dev mode)
  if (registeredVerifyLink && mode === 'register') {
    return (
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5" />
              Подтвердите email
            </DialogTitle>
            <DialogDescription>
              Мы отправили письмо с ссылкой для подтверждения. После подтверждения вы сможете пользоваться всеми функциями.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="rounded-md border border-orange-300 bg-orange-50 dark:bg-orange-950/30 dark:border-orange-700 p-3">
              <p className="text-xs font-medium text-orange-800 dark:text-orange-300 mb-2">
                🔧 Режим разработки — реальный SMTP не настроен
              </p>
              <p className="text-xs text-orange-700 dark:text-orange-400 mb-2">
                Ссылка для подтверждения email:
              </p>
              <a
                href={registeredVerifyLink}
                className="block text-xs font-mono text-blue-600 dark:text-blue-400 break-all underline mb-2"
              >
                {registeredVerifyLink}
              </a>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    navigator.clipboard.writeText(registeredVerifyLink)
                    toast.success('Ссылка скопирована')
                  }}
                >
                  Скопировать
                </Button>
                <Button
                  size="sm"
                  asChild
                >
                  <a href={registeredVerifyLink}>
                    Открыть <ExternalLink className="h-3 w-3 ml-1" />
                  </a>
                </Button>
              </div>
            </div>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                handleClose(false)
                onSuccess?.()
              }}
            >
              Продолжить без подтверждения
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{titles[mode]}</DialogTitle>
          <DialogDescription>{descriptions[mode]}</DialogDescription>
        </DialogHeader>

        {resetSent ? (
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Если аккаунт с таким email существует, мы отправили инструкции
              для сброса пароля.
            </p>
            {resetLink && (
              <div className="rounded-md border border-orange-300 bg-orange-50 dark:bg-orange-950/30 dark:border-orange-700 p-3">
                <p className="text-xs font-medium text-orange-800 dark:text-orange-300 mb-2">
                  🔧 Режим разработки — реальный SMTP не настроен
                </p>
                <p className="text-xs text-orange-700 dark:text-orange-400 mb-2">
                  Ссылка для сброса пароля:
                </p>
                <a
                  href={resetLink}
                  className="block text-xs font-mono text-blue-600 dark:text-blue-400 break-all underline"
                >
                  {resetLink}
                </a>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-2"
                  onClick={() => {
                    navigator.clipboard.writeText(resetLink)
                    toast.success('Ссылка скопирована')
                  }}
                >
                  Скопировать
                </Button>
              </div>
            )}
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                setMode('login')
                setResetSent(false)
              }}
            >
              Вернуться ко входу
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 py-2">
            {mode === 'register' && (
              <div className="space-y-2">
                <Label htmlFor="auth-name">Имя (необязательно)</Label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="auth-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Как к вам обращаться"
                    className="pl-9"
                  />
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="auth-email">Email</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="auth-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="user@example.com"
                  className="pl-9"
                  autoComplete="email"
                />
              </div>
            </div>

            {mode !== 'forgot' && (
              <div className="space-y-2">
                <Label htmlFor="auth-password">Пароль</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="auth-password"
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Минимум 8 символов"
                    className="pl-9"
                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  />
                </div>
              </div>
            )}

            {mode === 'login' && (
              <div className="flex items-center gap-2">
                <Checkbox
                  id="remember-me"
                  checked={rememberMe}
                  onCheckedChange={(v) => setRememberMe(v === true)}
                />
                <Label htmlFor="remember-me" className="text-sm font-normal cursor-pointer">
                  Запомнить меня на этом устройстве (1 год)
                </Label>
              </div>
            )}

            {mode === 'register' && (
              <div className="flex items-center gap-2">
                <Checkbox
                  id="remember-me-reg"
                  checked={rememberMe}
                  onCheckedChange={(v) => setRememberMe(v === true)}
                />
                <Label htmlFor="remember-me-reg" className="text-sm font-normal cursor-pointer">
                  Запомнить меня (1 год)
                </Label>
              </div>
            )}

            <Button
              type="submit"
              className="w-full"
              disabled={submitting || !email || (mode !== 'forgot' && !password)}
            >
              {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {submitting
                ? mode === 'login'
                  ? 'Вход...'
                  : mode === 'register'
                    ? 'Создание...'
                    : 'Отправка...'
                : submitLabels[mode]}
            </Button>

            <div className="flex flex-col gap-2 text-xs text-center">
              {mode === 'login' && (
                <>
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground hover:underline"
                    onClick={() => setMode('forgot')}
                  >
                    Забыли пароль?
                  </button>
                  <p className="text-muted-foreground">
                    Нет аккаунта?{' '}
                    <button
                      type="button"
                      className="font-medium text-foreground hover:underline"
                      onClick={() => setMode('register')}
                    >
                      Зарегистрироваться
                    </button>
                  </p>
                </>
              )}
              {mode === 'register' && (
                <p className="text-muted-foreground">
                  Уже есть аккаунт?{' '}
                  <button
                    type="button"
                    className="font-medium text-foreground hover:underline"
                    onClick={() => setMode('login')}
                  >
                    Войти
                  </button>
                </p>
              )}
              {mode === 'forgot' && (
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground hover:underline"
                  onClick={() => setMode('login')}
                >
                  ← Вернуться ко входу
                </button>
              )}
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
