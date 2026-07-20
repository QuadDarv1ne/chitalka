'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useAuth } from '@/hooks/use-auth'
import { useReaderStore } from '@/store/reader-store'
import { AuthDialog } from './auth-dialog'
import {
  LogOut,
  User,
  UserPlus,
  LogIn,
  Mail,
  Settings,
  ShieldCheck,
  ShieldAlert,
} from 'lucide-react'
import { toast } from 'sonner'

export function UserMenu() {
  const { user, loading, logout } = useAuth()
  const setView = useReaderStore((s) => s.setView)
  const [authOpen, setAuthOpen] = useState(false)
  const [initialMode, setInitialMode] = useState<'login' | 'register'>('login')

  if (loading) {
    return (
      <Button variant="ghost" size="icon" disabled>
        <User className="h-4 w-4" />
      </Button>
    )
  }

  if (!user) {
    return (
      <>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5"
            onClick={() => {
              setInitialMode('login')
              setAuthOpen(true)
            }}
          >
            <LogIn className="h-4 w-4" />
            <span className="hidden sm:inline">Войти</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 hidden md:flex"
            onClick={() => {
              setInitialMode('register')
              setAuthOpen(true)
            }}
          >
            <UserPlus className="h-4 w-4" />
            Регистрация
          </Button>
        </div>
        <AuthDialog
          open={authOpen}
          onOpenChange={setAuthOpen}
          initialMode={initialMode}
        />
      </>
    )
  }

  const initials = (user.name || user.email)
    .split(/\s|@/)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join('')

  const isVerified = !!user.emailVerified

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2">
          <div className="relative">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-medium">
              {initials || '?'}
            </div>
            {!isVerified && (
              <div className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-orange-500 border-2 border-background" title="Email не подтверждён" />
            )}
          </div>
          <span className="hidden md:inline truncate max-w-[120px]">
            {user.name || user.email.split('@')[0]}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>
          <div className="flex flex-col gap-0.5">
            <span className="font-medium truncate flex items-center gap-1.5">
              {user.name || 'Пользователь'}
              {isVerified ? (
                <ShieldCheck className="h-3.5 w-3.5 text-green-600" />
              ) : (
                <ShieldAlert className="h-3.5 w-3.5 text-orange-500" />
              )}
            </span>
            <span className="text-xs text-muted-foreground font-normal flex items-center gap-1">
              <Mail className="h-3 w-3" />
              {user.email}
            </span>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => setView('account')}>
          <Settings className="h-4 w-4 mr-2" />
          Личный кабинет
        </DropdownMenuItem>
        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          onClick={async () => {
            await logout()
            toast.success('Вы вышли из аккаунта')
          }}
        >
          <LogOut className="h-4 w-4 mr-2" />
          Выйти
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
