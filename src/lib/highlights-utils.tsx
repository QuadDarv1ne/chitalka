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
 * Matching is whitespace-insensitive so highlights that span paragraph breaks
 * still match inside each paragraph.
 */
export function splitWithHighlights(
  text: string,
  highlights: Highlight[],
): HighlightSegment[] {
  if (!highlights.length) return [{ text }]

  // Escape regex specials but keep whitespace runs as \s+ (paragraph splits
  // render as \n\n inside a highlight, which never appears within a paragraph)
  const toRegex = (s: string) =>
    s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')

  // Collect all matches: {start, end, highlight}
  const matches: { start: number; end: number; highlight: Highlight }[] = []
  for (const h of highlights) {
    if (!h.text) continue
    let re: RegExp
    try {
      re = new RegExp(toRegex(h.text), 'g')
    } catch {
      continue
    }
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      if (m[0].length === 0) {
        re.lastIndex++
        continue
      }
      matches.push({
        start: m.index,
        end: m.index + m[0].length,
        highlight: h,
      })
      if (m.index === re.lastIndex) re.lastIndex++
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
