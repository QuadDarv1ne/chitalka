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
      matches.push({
        start: idx,
        end: idx + h.text.length,
        highlight: h,
      })
      from = idx + 1
    }
  }

  if (matches.length === 0) return [{ text }]

  // Sort by start position, then longest first (so outer segments take priority)
  matches.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start))

  // Merge overlapping intervals: split into non-overlapping segments with all applicable highlights
  const segments: HighlightSegment[] = []
  const points = new Set<number>()
  points.add(0)
  points.add(text.length)
  for (const m of matches) {
    points.add(m.start)
    points.add(m.end)
  }
  const sortedPoints = [...points].sort((a, b) => a - b)

  for (let i = 0; i < sortedPoints.length - 1; i++) {
    const segStart = sortedPoints[i]
    const segEnd = sortedPoints[i + 1]
    if (segStart === segEnd) continue
    const segText = text.slice(segStart, segEnd)
    if (!segText) continue

    // Find all highlights covering this segment (prefer first/longest for priority)
    const covering = matches.filter(
      (m) => m.start <= segStart && m.end >= segEnd,
    )
    if (covering.length > 0) {
      segments.push({ text: segText, highlight: covering[0].highlight })
    } else {
      segments.push({ text: segText })
    }
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
