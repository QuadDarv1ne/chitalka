'use client'

import { PAGE_WORDS } from '@/lib/constants'

/**
 * Split plain text into pages (by words, with chapter breaks).
 * Chapter lines flush pages early, so `page*PAGE_WORDS` does not describe
 * where a page actually begins — the returned `pageStarts` records each
 * page's cumulative word offset instead.
 *
 * Used by the txt reader (pagination + position restore) and the search
 * dialog (accurate "Стр. N" labels), so both must agree on the split.
 */
export function paginateText(
  content: string,
  pageWords: number = PAGE_WORDS,
): { pages: string[]; pageStarts: number[] } {
  const isChapterStart = (line: string) =>
    /^(#{1,2})\s+/.test(line) ||
    /^(Глава|Часть|Раздел|Пролог|Эпилог|Chapter|Part|Section|Prologue|Epilogue)\s+([IVX]+|\d+)/i.test(
      line,
    )

  const paragraphs = content.split(/\n\n+/).filter(Boolean)
  const pages: string[] = []
  const pageStarts: number[] = []
  let current = ''
  let words = 0
  let cumulative = 0
  let pageStart = 0
  const flush = () => {
    if (current) {
      pages.push(current)
      pageStarts.push(pageStart)
      current = ''
      words = 0
    }
  }
  for (const p of paragraphs) {
    const pWords = p.split(/\s+/).filter(Boolean).length
    const firstLine = p.split('\n')[0] ?? ''
    const isChapter = isChapterStart(firstLine)
    if (current && (isChapter || words + pWords > pageWords)) flush()
    if (!current) pageStart = cumulative
    current = current ? `${current}\n\n${p}` : p
    words += pWords
    cumulative += pWords
  }
  if (current) {
    pages.push(current)
    pageStarts.push(pageStart)
  }
  return { pages, pageStarts }
}

/**
 * Map a word position to the page containing it (falls back to the last page).
 */
export function findPageForPosition(pageStarts: number[], pos: number): number {
  for (let i = 0; i < pageStarts.length; i++) {
    const end = i + 1 < pageStarts.length ? pageStarts[i + 1] : Infinity
    if (pos >= pageStarts[i] && pos < end) return i
  }
  return Math.max(0, pageStarts.length - 1)
}
