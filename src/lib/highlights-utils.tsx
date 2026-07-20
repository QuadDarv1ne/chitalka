'use client'

import { type ReactNode } from 'react'
import type { Highlight, HighlightColor } from '@/store/reader-store'
import { highlightColors } from '@/store/reader-store'

export interface HighlightSegment {
  text: string
  highlight?: Highlight
}

/**
 * Split a paragraph text into segments, marking which ones are part of a highlight.
 * Each highlight is matched by its text (case-sensitive).
 */
export function splitWithHighlights(
  text: string,
  highlights: Highlight[],
): HighlightSegment[] {
  if (!highlights.length) return [{ text }]

  // Collect all matches: {start, end, highlight}
  const matches: { start: number; end: number; highlight: Highlight }[] = []
  for (const h of highlights) {
    if (!h.text) continue
    let from = 0
    while (from < text.length) {
      const idx = text.indexOf(h.text, from)
      if (idx === -1) break
      // Avoid overlap with existing matches
      const overlaps = matches.some(
        (m) => idx < m.end && idx + h.text.length > m.start,
      )
      if (!overlaps) {
        matches.push({
          start: idx,
          end: idx + h.text.length,
          highlight: h,
        })
      }
      from = idx + h.text.length
    }
  }

  if (matches.length === 0) return [{ text }]

  matches.sort((a, b) => a.start - b.start)

  const segments: HighlightSegment[] = []
  let cursor = 0
  for (const m of matches) {
    if (m.start > cursor) {
      segments.push({ text: text.slice(cursor, m.start) })
    }
    segments.push({
      text: text.slice(m.start, m.end),
      highlight: m.highlight,
    })
    cursor = m.end
  }
  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor) })
  }
  return segments
}

export function HighlightMark({
  color,
  note,
  children,
  onClick,
}: {
  color: HighlightColor
  note?: string
  children: ReactNode
  onClick?: () => void
}) {
  const c = highlightColors[color]
  return (
    <mark
      onClick={onClick}
      title={note}
      style={{
        background: c.bg,
        color: c.fg,
        padding: '0 2px',
        borderRadius: '2px',
        cursor: onClick ? 'pointer' : 'inherit',
        borderBottom: note ? `2px solid ${c.fg}` : 'none',
      }}
    >
      {children}
    </mark>
  )
}
