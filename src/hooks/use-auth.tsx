'use client'

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react'

export interface AuthUser {
  id: string
  email: string
  name: string | null
  emailVerified: Date | null
}

interface AuthContextValue {
  user: AuthUser | null
  loading: boolean
  refresh: () => Promise<void>
  login: (email: string, password: string, rememberMe?: boolean) => Promise<{ ok: boolean; error?: string; verifyLink?: string }>
  register: (email: string, password: string, name?: string, rememberMe?: boolean) => Promise<{ ok: boolean; error?: string; verifyLink?: string }>
  logout: () => Promise<void>
  updateProfile: (name: string) => Promise<{ ok: boolean; error?: string }>
  changePassword: (currentPassword: string, newPassword: string) => Promise<{ ok: boolean; error?: string }>
  deleteAccount: (password: string) => Promise<{ ok: boolean; error?: string }>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me', { credentials: 'include' })
      if (!res.ok) {
        setUser(null)
        return
      }
      const data = await res.json()
      setUser(data.user ?? null)
    } catch {
      setUser(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const login = useCallback(
    async (email: string, password: string, rememberMe?: boolean) => {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, rememberMe }),
      })
      const data = await res.json()
      if (!res.ok) {
        return { ok: false, error: data.error || 'Ошибка входа' }
      }
      setUser(data.user)
      return { ok: true }
    },
    [],
  )

  const register = useCallback(
    async (email: string, password: string, name?: string, rememberMe?: boolean) => {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, name, rememberMe }),
      })
      const data = await res.json()
      if (!res.ok) {
        return { ok: false, error: data.error || 'Ошибка регистрации' }
      }
      setUser(data.user)
      return { ok: true, verifyLink: data._devVerifyLink }
    },
    [],
  )

  const logout = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    setUser(null)
  }, [])

  const updateProfile = useCallback(
    async (name: string) => {
      const res = await fetch('/api/auth/update-profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const data = await res.json()
      if (!res.ok) {
        return { ok: false, error: data.error || 'Ошибка обновления' }
      }
      setUser(data.user)
      return { ok: true }
    },
    [],
  )

  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string) => {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      })
      const data = await res.json()
      if (!res.ok) {
        return { ok: false, error: data.error || 'Ошибка смены пароля' }
      }
      return { ok: true }
    },
    [],
  )

  const deleteAccount = useCallback(
    async (password: string) => {
      const res = await fetch('/api/auth/delete-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      const data = await res.json()
      if (!res.ok) {
        return { ok: false, error: data.error || 'Ошибка удаления' }
      }
      setUser(null)
      return { ok: true }
    },
    [],
  )

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        refresh,
        login,
        register,
        logout,
        updateProfile,
        changePassword,
        deleteAccount,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
