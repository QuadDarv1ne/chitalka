'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { ResetPasswordDialog } from './reset-password-dialog'

/**
 * Watches for ?reset=TOKEN in URL and opens reset password dialog.
 * Renders nothing visible otherwise.
 */
export function ResetPasswordWatcher() {
  const searchParams = useSearchParams()
  const [resetToken, setResetToken] = useState<string | null>(null)

  useEffect(() => {
    // If ?verify= is also present, the email-verification dialog handles
    // the session first — process the reset link only when verify is gone.
    const token = searchParams.get('reset')
    if (token && !searchParams.get('verify')) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setResetToken(token)
    }
  }, [searchParams])

  const close = () => {
    setResetToken(null)
    // Remove ?reset= from URL without reload
    const url = new URL(window.location.href)
    url.searchParams.delete('reset')
    window.history.replaceState({}, '', url.toString())
  }

  if (!resetToken) return null

  return (
    <ResetPasswordDialog
      open={!!resetToken}
      token={resetToken}
      onOpenChange={(o) => !o && close()}
    />
  )
}
