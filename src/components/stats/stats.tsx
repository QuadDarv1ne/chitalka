'use client'

import { useEffect, useState, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  ArrowLeft,
  Clock,
  BookOpen,
  Highlighter,
  BookMarked,
  TrendingUp,
  Calendar,
  Flame,
  Target,
} from 'lucide-react'
import { useReaderStore, localDateString } from '@/store/reader-store'
import { getAllBooks, type BookRecord } from '@/lib/library'
import { UserMenu } from '@/components/auth/user-menu'
import { useAuth } from '@/hooks/use-auth'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from 'recharts'

export function Stats() {
  const setView = useReaderStore((s) => s.setView)
  const sessions = useReaderStore((s) => s.sessions)
  const highlights = useReaderStore((s) => s.highlights)
  const bookmarks = useReaderStore((s) => s.bookmarks)
  const dailyGoalMinutes = useReaderStore((s) => s.settings.dailyGoalMinutes)
  const { user } = useAuth()
  const userId = user?.id ?? null
  const [books, setBooks] = useState<BookRecord[]>([])

  useEffect(() => {
    let cancelled = false
    getAllBooks(userId)
      .then((b) => {
        if (!cancelled) setBooks(b)
      })
      .catch((e) => console.error(e))
    return () => {
      cancelled = true
    }
  }, [userId])

  // Today's reading time (local calendar day — matches how sessions are stored)
  const todayDate = localDateString(new Date())
  const todayMinutes = useMemo(
    () =>
      sessions
        .filter((s) => s.date === todayDate)
        .reduce((sum, s) => sum + s.minutes, 0),
    [sessions, todayDate],
  )
  const goalProgress = Math.min(100, (todayMinutes / dailyGoalMinutes) * 100)

  // Last 14 days
  const last14Days = useMemo(() => {
    const days: { date: string; label: string; minutes: number; pages: number }[] = []
    const today = new Date()
    for (let i = 13; i >= 0; i--) {
      const d = new Date(today)
      d.setDate(d.getDate() - i)
      const dateStr = localDateString(d)
      const daySessions = sessions.filter((s) => s.date === dateStr)
      days.push({
        date: dateStr,
        label: d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }),
        minutes: daySessions.reduce((sum, s) => sum + s.minutes, 0),
        pages: daySessions.reduce((sum, s) => sum + s.pages, 0),
      })
    }
    return days
  }, [sessions])

  const totalMinutes = sessions.reduce((s, sess) => s + sess.minutes, 0)
  const totalPages = sessions.reduce((s, sess) => s + sess.pages, 0)
  const activeDays = new Set(sessions.map((s) => s.date)).size
  const totalHours = (totalMinutes / 60).toFixed(1)

  // Streak
  const streak = useMemo(() => {
    let count = 0
    const today = new Date()
    for (let i = 0; i < 365; i++) {
      const d = new Date(today)
      d.setDate(d.getDate() - i)
      const dateStr = localDateString(d)
      const has = sessions.some((s) => s.date === dateStr)
      if (has) count++
      else if (i === 0) continue
      else break
    }
    return count
  }, [sessions])

  const bookStats = useMemo(() => {
    return books
      .map((b) => {
        const bookSessions = sessions.filter((s) => s.bookId === b.id)
        return {
          book: b,
          minutes: bookSessions.reduce((sum, s) => sum + s.minutes, 0),
          pages: bookSessions.reduce((sum, s) => sum + s.pages, 0),
          progress: b.progress ?? 0,
        }
      })
      .filter((s) => s.minutes > 0 || s.progress > 0)
      .sort((a, b) => b.minutes - a.minutes)
      .slice(0, 10)
  }, [books, sessions])

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
            <h1 className="text-lg font-semibold leading-none">Статистика чтения</h1>
            <p className="text-xs text-muted-foreground mt-0.5">Ваша активность за последнее время</p>
          </div>
          <div className="ml-auto">
            <UserMenu />
          </div>
        </div>
      </header>

      <div className="container mx-auto flex-1 px-4 md:px-8 py-8">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <StatCard
            icon={<Clock className="h-5 w-5" />}
            label="Всего часов"
            value={totalHours}
            sub={`${totalMinutes} мин`}
            color="bg-blue-500/10 text-blue-600"
          />
          <StatCard
            icon={<BookOpen className="h-5 w-5" />}
            label="Прочитано страниц"
            value={String(totalPages)}
            sub={`за ${activeDays} дн.`}
            color="bg-green-500/10 text-green-600"
          />
          <StatCard
            icon={<Flame className="h-5 w-5" />}
            label="Серия дней"
            value={String(streak)}
            sub="подряд"
            color="bg-orange-500/10 text-orange-600"
          />
          <StatCard
            icon={<Highlighter className="h-5 w-5" />}
            label="Выделений"
            value={String(highlights.length)}
            sub={`${bookmarks.length} закладок`}
            color="bg-purple-500/10 text-purple-600"
          />
        </div>

        {/* Daily goal widget */}
        <Card className="p-6 mb-8">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Target className="h-5 w-5" />
                Цель на сегодня
              </h2>
              <p className="text-xs text-muted-foreground">
                {todayMinutes} из {dailyGoalMinutes} минут
              </p>
            </div>
            {goalProgress >= 100 ? (
              <span className="rounded-full bg-green-500/15 px-3 py-1 text-xs font-medium text-green-700 dark:text-green-400">
                Цель достигнута!
              </span>
            ) : (
              <span className="text-2xl font-bold tabular-nums">
                {Math.round(goalProgress)}%
              </span>
            )}
          </div>
          <div className="h-3 w-full rounded-full bg-muted overflow-hidden">
            <div
              className={`h-full transition-all ${
                goalProgress >= 100
                  ? 'bg-green-500'
                  : goalProgress >= 50
                    ? 'bg-blue-500'
                    : 'bg-orange-500'
              }`}
              style={{ width: `${Math.max(2, goalProgress)}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            {goalProgress >= 100
              ? 'Отличная работа! Продолжайте в том же духе.'
              : `Осталось прочитать ${Math.max(0, dailyGoalMinutes - todayMinutes)} мин`}
          </p>
        </Card>

        <Card className="p-6 mb-8">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold">Активность за 14 дней</h2>
              <p className="text-xs text-muted-foreground">Минуты чтения и страницы по дням</p>
            </div>
            <TrendingUp className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={last14Days} barGap={4}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'var(--background)',
                    border: '1px solid var(--border)',
                    borderRadius: '8px',
                    fontSize: '12px',
                  }}
                />
                <Legend wrapperStyle={{ fontSize: '12px' }} />
                <Bar dataKey="minutes" name="Минуты" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                <Bar dataKey="pages" name="Страницы" fill="#10b981" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {bookStats.length > 0 && (
          <Card className="p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-semibold">Читаемые книги</h2>
                <p className="text-xs text-muted-foreground">Топ-10 по времени чтения</p>
              </div>
              <BookMarked className="h-5 w-5 text-muted-foreground" />
            </div>
            <ul className="space-y-3">
              {bookStats.map((s) => (
                <li
                  key={s.book.id}
                  className="flex items-center gap-4 py-2 border-b last:border-b-0"
                >
                  <div className="h-12 w-9 bg-muted rounded overflow-hidden flex-shrink-0">
                    {s.book.cover && (
                      <img
                        src={s.book.cover}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{s.book.title}</p>
                    <p className="text-xs text-muted-foreground truncate">{s.book.author}</p>
                  </div>
                  <div className="flex items-center gap-6 text-sm">
                    <div className="text-right">
                      <p className="font-medium tabular-nums">{s.minutes}</p>
                      <p className="text-xs text-muted-foreground">мин</p>
                    </div>
                    <div className="text-right">
                      <p className="font-medium tabular-nums">{s.pages}</p>
                      <p className="text-xs text-muted-foreground">стр</p>
                    </div>
                    <div className="text-right">
                      <p className="font-medium tabular-nums">
                        {Math.round(s.progress * 100)}%
                      </p>
                      <p className="text-xs text-muted-foreground">прогресс</p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {sessions.length === 0 && (
          <Card className="p-12 text-center">
            <Calendar className="h-12 w-12 text-muted-foreground/50 mx-auto mb-3" />
            <h3 className="text-lg font-semibold mb-1">Пока нет данных</h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Откройте любую книгу и начните читать — статистика времени и страниц
              появится здесь автоматически.
            </p>
          </Card>
        )}
      </div>
    </div>
  )
}

function StatCard({
  icon,
  label,
  value,
  sub,
  color,
}: {
  icon: React.ReactNode
  label: string
  value: string
  sub: string
  color: string
}) {
  return (
    <Card className="p-5">
      <div className={`inline-flex h-10 w-10 items-center justify-center rounded-lg ${color} mb-3`}>
        {icon}
      </div>
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <p className="text-2xl font-bold tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground mt-1">{sub}</p>
    </Card>
  )
}
