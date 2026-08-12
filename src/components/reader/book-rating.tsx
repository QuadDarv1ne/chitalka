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

  const handleRate = useCallback(
    async (rating: number) => {
      await updateBook(bookId, { rating }).catch(() => {})
      toast.success(rating > 0 ? `Оценка: ${rating} из 5` : 'Рейтинг удалён')
    },
    [bookId],
  )

  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          onClick={() => handleRate(star)}
          onMouseEnter={() => setHoverRating(star)}
          onMouseLeave={() => setHoverRating(0)}
          className="transition-transform hover:scale-110 focus:outline-none"
          aria-label={`Оценить на ${star} из 5`}
        >
          <Star
            className={`h-5 w-5 ${
              star <= (hoverRating || currentRating)
                ? 'fill-amber-400 text-amber-400'
                : 'text-muted-foreground/40'
            }`}
          />
        </button>
      ))}
    </div>
  )
}
