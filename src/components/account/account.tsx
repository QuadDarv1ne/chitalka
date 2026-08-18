'use client'

import { logger } from '@/lib/logger'
import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  ArrowLeft,
  User,
  Mail,
  ShieldCheck,
  ShieldAlert,
  Trash2,
  Monitor,
  Smartphone,
  LogOut,
  Loader2,
  RefreshCw,
  Save,
  KeyRound,
  AlertTriangle,
  Download,
} from 'lucide-react'
import { useAuth } from '@/hooks/use-auth'
import { useReaderStore } from '@/store/reader-store'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'

interface SessionInfo {
  id: string
  createdAt: string
  expiresAt: string
  userAgent: string | null
  ip: string | null
  isCurrent: boolean
}

export function Account() {
  const setView = useReaderStore((s) => s.setView)
  const { user, logout, updateProfile, changePassword, deleteAccount } = useAuth()

  const [name, setName] = useState(user?.name ?? '')
  const [savingProfile, setSavingProfile] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [savingPassword, setSavingPassword] = useState(false)
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [loadingSessions, setLoadingSessions] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deletePassword, setDeletePassword] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [sendingVerify, setSendingVerify] = useState(false)
  const [revokingId, setRevokingId] = useState<string | null>(null)
  const [revokingAll, setRevokingAll] = useState(false)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (user) setName(user.name ?? '')
  }, [user])

  const loadSessions = useCallback(async () => {
    if (!user) return
    setLoadingSessions(true)
    try {
      const res = await fetch('/api/auth/sessions')
      if (res.ok) {
        const data = await res.json()
        setSessions(data.sessions || [])
      }
    } catch (e) {
      logger.error(e)
    } finally {
      setLoadingSessions(false)
    }
  }, [user])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadSessions()
  }, [loadSessions])

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Button onClick={() => setView('library')}>Вернуться в библиотеку</Button>
      </div>
    )
  }

  const handleSaveProfile = async () => {
    setSavingProfile(true)
    try {
      const result = await updateProfile(name)
      if (result.ok) {
        toast.success('Профиль обновлён')
      } else {
        toast.error(result.error || 'Ошибка')
      }
    } catch {
      toast.error('Ошибка сети')
    } finally {
      setSavingProfile(false)
    }
  }

  const handleChangePassword = async () => {
    if (newPassword !== confirmPassword) {
      toast.error('Пароли не совпадают')
      return
    }
    if (newPassword.length < 8) {
      toast.error('Новый пароль должен быть не менее 8 символов')
      return
    }
    setSavingPassword(true)
    try {
      const result = await changePassword(currentPassword, newPassword)
      if (result.ok) {
        toast.success('Пароль изменён')
        setCurrentPassword('')
        setNewPassword('')
        setConfirmPassword('')
      } else {
        toast.error(result.error || 'Ошибка')
      }
    } catch {
      toast.error('Ошибка сети')
    } finally {
      setSavingPassword(false)
    }
  }

  const handleResendVerify = async () => {
    setSendingVerify(true)
    try {
      const res = await fetch('/api/auth/resend-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user.email }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        toast.success('Письмо отправлено')
        if (data._devVerifyLink) {
          navigator.clipboard.writeText(data._devVerifyLink).catch(() => {
            // Clipboard may be unavailable (insecure context, etc.)
          })
          toast.info('Dev-ссылка скопирована в буфер обмена', {
            description: data._devVerifyLink,
          })
        }
      } else {
        toast.error(data.error || 'Ошибка')
      }
    } catch {
      toast.error('Ошибка сети')
    } finally {
      setSendingVerify(false)
    }
  }

  const handleRevokeSession = async (sessionId: string) => {
    setRevokingId(sessionId)
    try {
      const res = await fetch(`/api/auth/sessions?id=${sessionId}`, { method: 'DELETE' })
      if (res.ok) {
        toast.success('Сессия завершена')
        loadSessions()
      } else {
        toast.error('Не удалось завершить сессию')
      }
    } catch {
      toast.error('Ошибка сети')
    } finally {
      setRevokingId(null)
    }
  }

  const handleRevokeOthers = async () => {
    setRevokingAll(true)
    try {
      const res = await fetch('/api/auth/sessions?action=revoke-others', { method: 'DELETE' })
      if (res.ok) {
        toast.success('Другие сессии завершены')
        loadSessions()
      } else {
        toast.error('Не удалось завершить другие сессии')
      }
    } catch {
      toast.error('Ошибка сети')
    } finally {
      setRevokingAll(false)
    }
  }

  const handleDeleteAccount = async () => {
    setDeleting(true)
    try {
      const result = await deleteAccount(deletePassword)
      if (result.ok) {
        toast.success('Аккаунт удалён')
        setDeleteDialogOpen(false)
        setDeletePassword('')
        setView('library')
      } else {
        toast.error(result.error || 'Ошибка')
      }
    } catch {
      toast.error('Ошибка сети')
    } finally {
      setDeleting(false)
    }
  }

  const isVerified = !!user.emailVerified

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur">
        <div className="container mx-auto flex h-16 items-center gap-4 px-4 md:px-8">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setView('library')}
            className="gap-1.5"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline">Библиотека</span>
          </Button>
          <div>
            <h1 className="text-lg font-semibold leading-none">Личный кабинет</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Профиль, безопасность и сессии
            </p>
          </div>
        </div>
      </header>

      <div className="container mx-auto flex-1 px-4 md:px-8 py-8 max-w-3xl">
        {/* Email verification banner */}
        {!isVerified && (
          <Card className="p-4 mb-6 border-orange-300 bg-orange-50 dark:bg-orange-950/30 dark:border-orange-700">
            <div className="flex items-start gap-3">
              <ShieldAlert className="h-5 w-5 text-orange-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-medium text-orange-800 dark:text-orange-300">
                  Email не подтверждён
                </p>
                <p className="text-xs text-orange-700 dark:text-orange-400 mt-1">
                  Подтвердите email для синхронизации библиотеки между устройствами
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={handleResendVerify}
                disabled={sendingVerify}
                className="gap-1.5"
              >
                {sendingVerify ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                Отправить снова
              </Button>
            </div>
          </Card>
        )}

        {isVerified && (
          <Card className="p-4 mb-6 border-green-300 bg-green-50 dark:bg-green-950/30 dark:border-green-700">
            <div className="flex items-center gap-3">
              <ShieldCheck className="h-5 w-5 text-green-600 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-green-800 dark:text-green-300">
                  Email подтверждён
                </p>
                <p className="text-xs text-green-700 dark:text-green-400">
                  Все функции доступны
                </p>
              </div>
            </div>
          </Card>
        )}

        {/* Profile section */}
        <Card className="p-6 mb-6">
          <div className="flex items-center gap-2 mb-4">
            <User className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-lg font-semibold">Профиль</h2>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="profile-email">Email</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="profile-email"
                  value={user.email}
                  disabled
                  className="pl-9 bg-muted/50"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Email нельзя изменить. Создайте новый аккаунт при необходимости.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="profile-name">Имя</Label>
              <Input
                id="profile-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Как к вам обращаться"
                maxLength={100}
              />
            </div>

            <Button
              onClick={handleSaveProfile}
              disabled={savingProfile || name === (user.name ?? '')}
              className="gap-1.5"
            >
              {savingProfile ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Сохранить
            </Button>
          </div>
        </Card>

        {/* Change password section */}
        <Card className="p-6 mb-6">
          <div className="flex items-center gap-2 mb-4">
            <KeyRound className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-lg font-semibold">Смена пароля</h2>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="current-password">Текущий пароль</Label>
              <Input
                id="current-password"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Введите текущий пароль"
                autoComplete="current-password"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="new-password">Новый пароль</Label>
                <Input
                  id="new-password"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Минимум 8 символов"
                  autoComplete="new-password"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-password">Повторите</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Введите ещё раз"
                  autoComplete="new-password"
                />
              </div>
            </div>

            <Button
              onClick={handleChangePassword}
              disabled={savingPassword || !currentPassword || !newPassword || !confirmPassword}
              className="gap-1.5"
            >
              {savingPassword && <Loader2 className="h-4 w-4 animate-spin" />}
              Изменить пароль
            </Button>
          </div>
        </Card>

        {/* Sessions section */}
        <Card className="p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Monitor className="h-5 w-5 text-muted-foreground" />
              <h2 className="text-lg font-semibold">Активные сессии</h2>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={loadSessions}
              disabled={loadingSessions}
              className="gap-1.5"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loadingSessions ? 'animate-spin' : ''}`} />
              Обновить
            </Button>
          </div>

          {sessions.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              {loadingSessions ? 'Загрузка...' : 'Нет активных сессий'}
            </p>
          ) : (
            <ul className="space-y-2">
              {sessions.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center gap-3 p-3 rounded-md border"
                >
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-muted">
                    {detectDevice(s.userAgent) === 'mobile' ? (
                      <Smartphone className="h-4 w-4" />
                    ) : (
                      <Monitor className="h-4 w-4" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {detectBrowser(s.userAgent)} · {detectOS(s.userAgent)}
                      {s.isCurrent && (
                        <span className="ml-2 rounded-full bg-green-500/15 px-2 py-0.5 text-xs font-medium text-green-700 dark:text-green-400">
                          Эта сессия
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(s.createdAt).toLocaleString('ru-RU')}
                      {s.ip && ` · ${s.ip}`}
                    </p>
                  </div>
                  {!s.isCurrent && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={() => handleRevokeSession(s.id)}
                      disabled={revokingId === s.id}
                      aria-label="Завершить сессию"
                    >
                      {revokingId === s.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <LogOut className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}

          {sessions.length > 1 && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleRevokeOthers}
              disabled={revokingAll}
              className="mt-4 w-full gap-1.5"
            >
              {revokingAll ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <LogOut className="h-3.5 w-3.5" />
              )}
              Завершить все другие сессии
            </Button>
          )}
        </Card>

        {/* Export data section */}
        <Card className="p-6 mb-6">
          <div className="flex items-center gap-2 mb-4">
            <Download className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-lg font-semibold">Экспорт данных</h2>
          </div>

          <p className="text-sm text-muted-foreground mb-4">
            Скачайте все данные аккаунта в формате JSON: прогресс чтения,
            оценки книг и настройки читалки. Книги (файлы) не экспортируются —
            они хранятся только в вашем браузере.
          </p>

          <Button
            onClick={async () => {
              try {
                const res = await fetch('/api/user/export', {
                  credentials: 'include',
                })
                if (!res.ok) {
                  const data = await res.json().catch(() => ({}))
                  toast.error(data.error || 'Ошибка экспорта')
                  return
                }
                const blob = await res.blob()
                const url = URL.createObjectURL(blob)
                const a = document.createElement('a')
                a.href = url
                a.download = `chitalka-export-${new Date().toISOString().slice(0, 10)}.json`
                document.body.appendChild(a)
                a.click()
                document.body.removeChild(a)
                URL.revokeObjectURL(url)
                toast.success('Данные экспортированы')
              } catch (e) {
                logger.error(e)
                toast.error('Ошибка экспорта')
              }
            }}
            className="gap-1.5"
          >
            <Download className="h-4 w-4" />
            Скачать данные аккаунта
          </Button>
        </Card>

        {/* Danger zone */}
        <Card className="p-6 border-destructive/30">
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            <h2 className="text-lg font-semibold text-destructive">Опасная зона</h2>
          </div>

          <div className="space-y-3">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium">Выйти из аккаунта</p>
                <p className="text-xs text-muted-foreground">
                  Завершить текущую сессию на этом устройстве
                </p>
              </div>
              <Button
                variant="outline"
                onClick={() => {
                  logout()
                  setView('library')
                }}
                className="gap-1.5"
              >
                <LogOut className="h-4 w-4" />
                Выйти
              </Button>
            </div>

            <div className="border-t pt-3 flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-destructive">Удалить аккаунт</p>
                <p className="text-xs text-muted-foreground">
                  Безвозвратно удалить аккаунт и все данные. Это действие нельзя отменить.
                </p>
              </div>
              <Button
                variant="destructive"
                onClick={() => setDeleteDialogOpen(true)}
                className="gap-1.5"
              >
                <Trash2 className="h-4 w-4" />
                Удалить
              </Button>
            </div>
          </div>
        </Card>
      </div>

      {/* Delete account dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Удаление аккаунта
            </DialogTitle>
            <DialogDescription>
              Это действие необратимо. Все ваши данные будут удалены: профиль,
              сессии, история чтения на сервере. Локальные книги в браузере сохранятся.
              <br /><br />
              Введите пароль для подтверждения.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (!deleting && deletePassword) handleDeleteAccount()
            }}
          >
            <Input
              type="password"
              placeholder="Пароль"
              value={deletePassword}
              onChange={(e) => setDeletePassword(e.target.value)}
              autoComplete="current-password"
            />
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
                Отмена
              </Button>
              <Button
                variant="destructive"
                type="submit"
                disabled={deleting || !deletePassword}
                className="gap-1.5"
              >
                {deleting && <Loader2 className="h-4 w-4 animate-spin" />}
                Удалить аккаунт
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function detectBrowser(ua?: string | null): string {
  if (!ua) return 'Браузер'
  if (ua.includes('Firefox')) return 'Firefox'
  if (ua.includes('Edg')) return 'Edge'
  if (ua.includes('Chrome')) return 'Chrome'
  if (ua.includes('Safari')) return 'Safari'
  if (ua.includes('OPR')) return 'Opera'
  return 'Браузер'
}

function detectOS(ua?: string | null): string {
  if (!ua) return 'Unknown'
  if (ua.includes('Windows')) return 'Windows'
  if (ua.includes('Mac OS')) return 'macOS'
  if (ua.includes('Linux')) return 'Linux'
  if (ua.includes('Android')) return 'Android'
  if (ua.includes('iPhone') || ua.includes('iPad')) return 'iOS'
  return 'Unknown'
}

function detectDevice(ua?: string | null): 'mobile' | 'desktop' {
  if (!ua) return 'desktop'
  if (/Android|iPhone|iPad|Mobile/i.test(ua)) return 'mobile'
  return 'desktop'
}
