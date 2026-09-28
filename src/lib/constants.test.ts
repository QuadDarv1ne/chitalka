import { describe, it, expect } from 'vitest'
import {
  PAGE_WORDS,
  estimateRemainingMinutes,
  formatMinutes,
} from './constants'

describe('estimateRemainingMinutes', () => {
  // BYTES_PER_WORD = 7: 7000 bytes → 1000 words
  it('estimates full remaining time for a fresh text book', () => {
    expect(estimateRemainingMinutes('txt', 7000, 0, 100)).toBe(10)
  })

  it('halves the estimate at 50% progress', () => {
    expect(estimateRemainingMinutes('txt', 7000, 0.5, 100)).toBe(5)
  })

  it('returns 0 when the book is finished', () => {
    expect(estimateRemainingMinutes('txt', 7000, 1, 100)).toBe(0)
  })

  it('clamps out-of-range progress values', () => {
    expect(estimateRemainingMinutes('txt', 7000, 1.5, 100)).toBe(0)
    expect(estimateRemainingMinutes('txt', 7000, -1, 100)).toBe(10)
  })

  it('supports all text-like formats', () => {
    for (const format of ['txt', 'md', 'fb2', 'html'] as const) {
      expect(estimateRemainingMinutes(format, 7000, 0, 100)).toBe(10)
    }
  })

  it('returns 0 for non-text formats (pdf, epub, mp3, cbz)', () => {
    expect(estimateRemainingMinutes('pdf', 700000, 0, 100)).toBe(0)
    expect(estimateRemainingMinutes('epub', 700000, 0, 100)).toBe(0)
    expect(estimateRemainingMinutes('mp3', 700000, 0, 100)).toBe(0)
    expect(estimateRemainingMinutes('cbz', 700000, 0, 100)).toBe(0)
  })

  it('never divides by zero for wordsPerMinute < 1', () => {
    // The divisor is clamped to 1, so 1000 words yield 1000 minutes
    expect(estimateRemainingMinutes('txt', 7000, 0, 0)).toBe(1000)
    expect(estimateRemainingMinutes('txt', 7000, 0, -5)).toBe(1000)
  })

  it('returns 0 for empty files', () => {
    expect(estimateRemainingMinutes('txt', 0, 0, 100)).toBe(0)
  })

  it('rounds to the nearest minute', () => {
    // 1050 words remaining / 200 wpm = 5.25 → 5
    expect(estimateRemainingMinutes('txt', 7350, 0, 200)).toBe(5)
    // 1120 words / 200 wpm = 5.6 → 6
    expect(estimateRemainingMinutes('txt', 7840, 0, 200)).toBe(6)
  })
})

describe('formatMinutes', () => {
  it('returns an empty string for zero or negative values', () => {
    expect(formatMinutes(0)).toBe('')
    expect(formatMinutes(-10)).toBe('')
  })

  it('formats minutes below an hour', () => {
    expect(formatMinutes(1)).toBe('1 мин')
    expect(formatMinutes(59)).toBe('59 мин')
  })

  it('formats whole hours without a zero minute part', () => {
    expect(formatMinutes(60)).toBe('1 ч')
    expect(formatMinutes(120)).toBe('2 ч')
  })

  it('formats hours with minutes', () => {
    expect(formatMinutes(61)).toBe('1 ч 1 мин')
    expect(formatMinutes(125)).toBe('2 ч 5 мин')
    expect(formatMinutes(1439)).toBe('23 ч 59 мин')
  })
})

describe('PAGE_WORDS', () => {
  it('is the documented default page size', () => {
    expect(PAGE_WORDS).toBe(350)
  })
})
