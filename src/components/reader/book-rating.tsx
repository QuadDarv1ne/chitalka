'use client'

import { useState, useCallback } from 'react'
import { Star } from 'lucide-react'
import { updateBook } from '@/lib/library'
import { toast } from 'sonner'

interface Props {
  bookId: string
  currentRating?: number
}

export function BookRating({ bookId, currentRating = 0 }: Props) {
  const [hoverRating, setHoverRating] = useState(0)
  // The parent keeps the book record as it was on load, so the prop goes stale
  // after a click. Mirror it locally (re-derived during render when the book or
  // the stored rating changes) to keep the stars in sync with what was saved.
  const [rating, setRating] = useState(currentRating)
  const [prevKey, setPrevKey] = useState(`${bookId}:${currentRating}`)
  const syncKey = `${bookId}:${currentRating}`
  if (syncKey !== prevKey) {
    setPrevKey(syncKey)
    setRating(currentRating)
  }

  const handleRate = useCallback(
    async (star: number) => {
      // Clicking the current value clears the rating, like in the details dialog
      const next = star === rating ? 0 : star
      setRating(next)
      await updateBook(bookId, { rating: next }).catch(() => {})
      toast.success(next > 0 ? `Оценка: ${next} из 5` : 'Рейтинг удалён')
    },
    [bookId, rating],
  )

  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          onClick={() => handleRate(star)}
          onMouseEnter={() => setHoverRating(star)}
          onMouseLeave={() => setHoverRating(0)}
          className="rounded transition-transform hover:scale-110 focus-visible:ring-2 focus-visible:ring-ring outline-none"
          aria-label={star === rating ? `Убрать оценку (${rating} из 5)` : `Оценить на ${star} из 5`}
          title={star === rating ? 'Убрать оценку' : `Оценить на ${star} из 5`}
        >
          <Star
            className={`h-5 w-5 ${
              star <= (hoverRating || rating)
                ? 'fill-amber-400 text-amber-400'
                : 'text-muted-foreground/40'
            }`}
          />
        </button>
      ))}
    </div>
  )
}
