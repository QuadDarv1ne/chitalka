'use client'

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react'

export interface AuthUser {
  id: string
  email: string
  name: string | null
  // JSON-serialized ISO string at runtime (not a Date object)
  emailVerified: string | null
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

/**
 * Parse a JSON response defensively: proxies/dev servers may return an HTML
 * error page (500/502), which makes res.json() throw a SyntaxError. Any
 * failure here must surface as a user-facing error, not an unhandled
 * rejection for the callers (auth dialogs don't catch).
 */
async function parseJson<T>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T
  } catch {
    return null
  }
}

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
      const data = await parseJson<{ user: AuthUser | null }>(res)
      setUser(data?.user ?? null)
    } catch {
      setUser(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh()
  }, [refresh])

  const login = useCallback(
    async (email: string, password: string, rememberMe?: boolean) => {
      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password, rememberMe }),
        })
        const data = await parseJson<{ user: AuthUser; error?: string }>(res)
        if (!res.ok) {
          return { ok: false, error: data?.error || 'Ошибка входа' }
        }
        setUser(data?.user ?? null)
        return { ok: true }
      } catch {
        return { ok: false, error: 'Нет соединения с сервером' }
      }
    },
    [],
  )

  const register = useCallback(
    async (email: string, password: string, name?: string, rememberMe?: boolean) => {
      try {
        const res = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password, name, rememberMe }),
        })
        const data = await parseJson<{ user: AuthUser; error?: string; _devVerifyLink?: string }>(res)
        if (!res.ok) {
          return { ok: false, error: data?.error || 'Ошибка регистрации' }
        }
        if (data?._devVerifyLink) {
          // In dev the user must see the verification link; keep the dialog open
          // and only pick up the session when the flow is finished
          return { ok: true, verifyLink: data._devVerifyLink }
        }
        setUser(data?.user ?? null)
        return { ok: true }
      } catch {
        return { ok: false, error: 'Нет соединения с сервером' }
      }
    },
    [],
  )

  const logout = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
    } catch {
      // Network failure — clear local state anyway
    } finally {
      setUser(null)
    }
  }, [])

  const updateProfile = useCallback(
    async (name: string) => {
      try {
        const res = await fetch('/api/auth/update-profile', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name }),
        })
        const data = await parseJson<{ error?: string }>(res)
        if (!res.ok) {
          return { ok: false, error: data?.error || 'Ошибка обновления' }
        }
        await refresh()
        return { ok: true }
      } catch {
        return { ok: false, error: 'Нет соединения с сервером' }
      }
    },
    [refresh],
  )

  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string) => {
      try {
        const res = await fetch('/api/auth/change-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ currentPassword, newPassword }),
        })
        const data = await parseJson<{ error?: string }>(res)
        if (!res.ok) {
          return { ok: false, error: data?.error || 'Ошибка смены пароля' }
        }
        return { ok: true }
      } catch {
        return { ok: false, error: 'Нет соединения с сервером' }
      }
    },
    [],
  )

  const deleteAccount = useCallback(
    async (password: string) => {
      try {
        const res = await fetch('/api/auth/delete-account', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password }),
        })
        const data = await parseJson<{ error?: string }>(res)
        if (!res.ok) {
          return { ok: false, error: data?.error || 'Ошибка удаления' }
        }
        setUser(null)
        return { ok: true }
      } catch {
        return { ok: false, error: 'Нет соединения с сервером' }
      }
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
