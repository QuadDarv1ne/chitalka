'use client'

import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { AlertTriangle, RefreshCw, Home } from 'lucide-react'
import { logger } from '@/lib/logger'
import { useReaderStore } from '@/store/reader-store'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

/**
 * React Error Boundary that catches rendering crashes and shows a
 * user-friendly recovery screen instead of a white screen.
 *
 * Wraps the entire app in layout.tsx so no page can ever fully crash.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Log to structured logger so it goes to stderr in dev and can be
    // ingested by a monitoring service in production.
    logger.error('ErrorBoundary caught', error, info.componentStack)
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null })
    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback
      }

      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-4 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
            <AlertTriangle className="h-8 w-8 text-destructive" />
          </div>
          <div className="space-y-2">
            <h1 className="text-xl font-semibold">Что-то пошло не так</h1>
            <p className="max-w-md text-sm text-muted-foreground">
              При рендеринге страницы произошла ошибка. Это известная проблема,
              которая обычно возникает при конфликте состояния приложения.
            </p>
            {process.env.NODE_ENV !== 'production' && this.state.error && (
              <details className="max-w-md text-left text-xs">
                <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                  Детали ошибки
                </summary>
                <pre className="mt-2 max-h-40 overflow-auto rounded bg-muted p-3 text-[10px] text-muted-foreground">
                  {this.state.error.message}
                </pre>
              </details>
            )}
          </div>
          <div className="flex gap-3">
            <Button onClick={this.handleReset} className="gap-2">
              <RefreshCw className="h-4 w-4" />
              Обновить страницу
            </Button>
            <Button
              variant="outline"
              onClick={() => useReaderStore.getState().setView('library')}
              className="gap-2"
            >
              <Home className="h-4 w-4" />
              В библиотеку
            </Button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
