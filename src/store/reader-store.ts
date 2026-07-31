'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map((b, i) => (i === 6 ? (b & 0x0f) | 0x40 : i === 8 ? (b & 0x3f) | 0x80 : b).toString(16).padStart(2, '0'))
    .join('')
    .replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5')
}

export type Theme = 'light' | 'dark' | 'sepia' | 'contrast'
export type FontFamily = 'serif' | 'sans' | 'mono'
export type View = 'library' | 'reader' | 'stats' | 'account'

export interface ReaderSettings {
  theme: Theme
  fontFamily: FontFamily
  fontSize: number // 14..28
  lineHeight: number // 1.2..2.4
  margin: number // 1..6
  textAlign: 'left' | 'justify'
  hyphens: boolean
  ttsRate: number // 0.5..2.0
  ttsVoice: string | null
  dailyGoalMinutes: number // 5..240
}

export interface Bookmark {
  id: string
  bookId: string
  cfi?: string
  textPosition?: number
  pdfPage?: number
  label: string
  createdAt: number
}

export interface Highlight {
  id: string
  bookId: string
  text: string
  note?: string
  color: HighlightColor
  cfi?: string
  textPosition?: number
  pdfPage?: number
  createdAt: number
}

export type HighlightColor = 'yellow' | 'green' | 'blue' | 'pink' | 'purple'

export interface ReadingSession {
  bookId: string
  date: string // YYYY-MM-DD
  minutes: number
  pages: number
}

interface ReaderState {
  view: View
  currentBookId: string | null
  settings: ReaderSettings
  bookmarks: Bookmark[]
  highlights: Highlight[]
  sessions: ReadingSession[]
  searchOpen: boolean
  sidebarOpen: boolean
  settingsOpen: boolean
  tocOpen: boolean

  setView: (v: View) => void
  openBook: (id: string) => void
  closeBook: () => void
  updateSettings: (patch: Partial<ReaderSettings>) => void
  setTheme: (t: Theme) => void

  addBookmark: (b: Omit<Bookmark, 'id' | 'createdAt'>) => void
  removeBookmark: (id: string) => void

  addHighlight: (h: Omit<Highlight, 'id' | 'createdAt'>) => string
  updateHighlight: (id: string, patch: Partial<Highlight>) => void
  removeHighlight: (id: string) => void

  logReading: (bookId: string, minutes: number, pages: number) => void
  removeBookData: (bookId: string) => void

  setSearchOpen: (open: boolean) => void
  setSidebarOpen: (open: boolean) => void
  setSettingsOpen: (open: boolean) => void
  setTocOpen: (open: boolean) => void
}

const defaultSettings: ReaderSettings = {
  theme: 'light',
  fontFamily: 'serif',
  fontSize: 18,
  lineHeight: 1.7,
  margin: 3,
  textAlign: 'justify',
  hyphens: true,
  ttsRate: 1.0,
  ttsVoice: null,
  dailyGoalMinutes: 30,
}

export const useReaderStore = create<ReaderState>()(
  persist(
    (set, _get) => ({
      view: 'library',
      currentBookId: null,
      settings: defaultSettings,
      bookmarks: [],
      highlights: [],
      sessions: [],
      searchOpen: false,
      sidebarOpen: false,
      settingsOpen: false,
      tocOpen: false,

      setView: (v) => set({ view: v }),
      openBook: (id) =>
        set({
          view: 'reader',
          currentBookId: id,
          tocOpen: false,
          settingsOpen: false,
          searchOpen: false,
        }),
      closeBook: () => set({ view: 'library', currentBookId: null }),
      updateSettings: (patch) =>
        set((s) => ({ settings: { ...s.settings, ...patch } })),
      setTheme: (t) => set((s) => ({ settings: { ...s.settings, theme: t } })),

      addBookmark: (b) =>
        set((s) => ({
          bookmarks: [
            ...s.bookmarks,
            { ...b, id: generateId(), createdAt: Date.now() },
          ],
        })),
      removeBookmark: (id) =>
        set((s) => ({ bookmarks: s.bookmarks.filter((b) => b.id !== id) })),

      addHighlight: (h) => {
        const id = generateId()
        set((s) => ({
          highlights: [
            ...s.highlights,
            { ...h, id, createdAt: Date.now() },
          ],
        }))
        return id
      },
      updateHighlight: (id, patch) =>
        set((s) => ({
          highlights: s.highlights.map((h) =>
            h.id === id ? { ...h, ...patch } : h,
          ),
        })),
      removeHighlight: (id) =>
        set((s) => ({
          highlights: s.highlights.filter((h) => h.id !== id),
        })),

      logReading: (bookId, minutes, pages) =>
        set((s) => {
          const safeMinutes = Math.max(0, Math.min(minutes, 1440))
          const safePages = Math.max(0, Math.min(pages, 10000))
          const date = new Date().toISOString().slice(0, 10)
          const existing = s.sessions.find(
            (sess) => sess.bookId === bookId && sess.date === date,
          )
          if (existing) {
            return {
              sessions: s.sessions.map((sess) =>
                sess === existing
                  ? {
                      ...sess,
                      minutes: sess.minutes + safeMinutes,
                      pages: sess.pages + safePages,
                    }
                  : sess,
              ),
            }
          }
          return {
            sessions: [...s.sessions, { bookId, date, minutes: safeMinutes, pages: safePages }],
          }
        }),

      removeBookData: (bookId) =>
        set((s) => ({
          bookmarks: s.bookmarks.filter((b) => b.bookId !== bookId),
          highlights: s.highlights.filter((h) => h.bookId !== bookId),
          sessions: s.sessions.filter((sess) => sess.bookId !== bookId),
        })),

      setSearchOpen: (open) => set({ searchOpen: open }),
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      setSettingsOpen: (open) => set({ settingsOpen: open }),
      setTocOpen: (open) => set({ tocOpen: open }),
    }),
    {
      name: 'reader-store',
      version: 1,
      partialize: (s) => ({
        settings: s.settings,
        bookmarks: s.bookmarks,
        highlights: s.highlights,
        sessions: s.sessions,
      }),
      migrate: (state: any, version: number) => {
        if (version === 0) {
          return { ...state, sessions: state.sessions ?? [] }
        }
        return state as ReaderState
      },
    },
  ),
)

export const themeBg: Record<Theme, string> = {
  light: '#fafaf7',
  dark: '#1a1a1a',
  sepia: '#f4ecd8',
  contrast: '#000000',
}

export const themeFg: Record<Theme, string> = {
  light: '#1c1c1c',
  dark: '#d4d4d4',
  sepia: '#5b4636',
  contrast: '#ffffff',
}

export const fontFamilyCss: Record<FontFamily, string> = {
  serif: 'Georgia, "Noto Serif", "Times New Roman", serif',
  sans: 'system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", sans-serif',
  mono: 'ui-monospace, "JetBrains Mono", "Courier New", monospace',
}

export const highlightColors: Record<HighlightColor, { bg: string; fg: string; label: string }> = {
  yellow: { bg: '#fef08a', fg: '#713f12', label: 'Жёлтый' },
  green: { bg: '#bbf7d0', fg: '#14532d', label: 'Зелёный' },
  blue: { bg: '#bfdbfe', fg: '#1e3a8a', label: 'Синий' },
  pink: { bg: '#fbcfe8', fg: '#831843', label: 'Розовый' },
  purple: { bg: '#e9d5ff', fg: '#581c87', label: 'Фиолетовый' },
}
