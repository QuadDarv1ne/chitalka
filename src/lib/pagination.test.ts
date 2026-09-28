import { describe, it, expect } from 'vitest'
import { paginateText, findPageForPosition } from './pagination'

/** Build a paragraph of `n` distinct words ("w0 w1 ... wn-1"). */
function words(n: number, prefix = 'w'): string {
  return Array.from({ length: n }, (_, i) => `${prefix}${i}`).join(' ')
}

describe('paginateText', () => {
  it('returns empty arrays for empty content', () => {
    expect(paginateText('')).toEqual({ pages: [], pageStarts: [] })
  })

  it('puts a small text into a single page starting at word 0', () => {
    const { pages, pageStarts } = paginateText('one two three')
    expect(pages).toEqual(['one two three'])
    expect(pageStarts).toEqual([0])
  })

  it('joins paragraphs with a blank line while the page has room', () => {
    const { pages } = paginateText('alpha beta\n\ngamma delta', 10)
    expect(pages).toEqual(['alpha beta\n\ngamma delta'])
  })

  it('flushes the page when the next paragraph exceeds the word limit', () => {
    // 6 + 6 = 12 words > 10 → two pages, second starts at word 6
    const { pages, pageStarts } = paginateText(`${words(6)}\n\n${words(6, 'x')}`, 10)
    expect(pages).toHaveLength(2)
    expect(pages[0]).toBe(words(6))
    expect(pages[1]).toBe(words(6, 'x'))
    expect(pageStarts).toEqual([0, 6])
  })

  it('counts words across all paragraphs for cumulative page starts', () => {
    // pageWords=10: [4+4]=8 fits, +4=12 flushes → page2 [4 words + 4 words]=8, +4 flushes
    const text = [4, 4, 4, 4, 4].map((n, i) => words(n, `p${i}`)).join('\n\n')
    const { pages, pageStarts } = paginateText(text, 10)
    expect(pages).toHaveLength(3)
    expect(pageStarts).toEqual([0, 8, 16])
  })

  it('starts a new page at a "Глава N" paragraph even with room left', () => {
    const { pages, pageStarts } = paginateText(
      'intro text here\n\nГлава 2. The second chapter body\n\nmore text',
      350,
    )
    expect(pages).toHaveLength(2)
    expect(pages[0]).toBe('intro text here')
    expect(pages[1]).toBe('Глава 2. The second chapter body\n\nmore text')
    expect(pageStarts).toEqual([0, 3])
  })

  it('recognizes markdown headings (# and ##) as chapter starts', () => {
    const { pages } = paginateText('before\n\n## Section two\n\nafter', 350)
    expect(pages).toHaveLength(2)
    expect(pages[1].startsWith('## Section two')).toBe(true)
  })

  it('does not treat ### (deep heading) as a chapter start', () => {
    const { pages } = paginateText('before\n\n### Sub\n\nafter', 350)
    expect(pages).toHaveLength(1)
  })

  it('recognizes roman-numeral parts and English chapter keywords', () => {
    const a = paginateText('text\n\nЧасть II. Beginning of part two', 350)
    expect(a.pages).toHaveLength(2)
    const b = paginateText('text\n\nChapter IV. A new chapter', 350)
    expect(b.pages).toHaveLength(2)
    const c = paginateText('text\n\nЭпилог 12. Final words', 350)
    expect(c.pages).toHaveLength(2)
  })

  it('only checks the first line of a paragraph for a chapter marker', () => {
    const { pages } = paginateText('Глава 5. Marked\n\nplain text with Глава 9 inside', 350)
    // First paragraph starts the book (no flush on empty page), second does not break
    expect(pages).toHaveLength(1)
  })

  it('keeps one oversized paragraph as a single page (no intra-paragraph split)', () => {
    const big = words(50)
    const { pages, pageStarts } = paginateText(`${words(2)}\n\n${big}`, 10)
    expect(pages).toHaveLength(2)
    expect(pages[1]).toBe(big)
    expect(pageStarts).toEqual([0, 2])
  })

  it('joins whitespace-only paragraphs without extra pages', () => {
    const { pages, pageStarts } = paginateText('one two\n\n\n\n   \n\nthree four', 10)
    // The whitespace-only paragraph contributes 0 words and joins the page
    expect(pages).toHaveLength(1)
    expect(pageStarts).toEqual([0])
  })

  it('matches the default page size constant (350 words)', () => {
    const text = [words(200), words(200)].join('\n\n')
    const { pages, pageStarts } = paginateText(text)
    expect(pages).toHaveLength(2)
    expect(pageStarts).toEqual([0, 200])
  })
})

describe('findPageForPosition', () => {
  const pageStarts = [0, 10, 25]

  it('finds the page containing a word position', () => {
    expect(findPageForPosition(pageStarts, 0)).toBe(0)
    expect(findPageForPosition(pageStarts, 9)).toBe(0)
    expect(findPageForPosition(pageStarts, 10)).toBe(1)
    expect(findPageForPosition(pageStarts, 24)).toBe(1)
    expect(findPageForPosition(pageStarts, 25)).toBe(2)
    expect(findPageForPosition(pageStarts, 1000)).toBe(2)
  })

  it('falls back to page 0 when pageStarts is empty', () => {
    expect(findPageForPosition([], 5)).toBe(0)
  })

  it('round-trips with paginateText page starts for every page', () => {
    const text = [4, 4, 4, 4, 4, 4].map((n, i) => words(n, `t${i}`)).join('\n\n')
    const { pages, pageStarts } = paginateText(text, 10)
    let cumulative = 0
    for (let i = 0; i < pages.length; i++) {
      // A position at the page start and inside it must resolve back to that page
      expect(findPageForPosition(pageStarts, cumulative)).toBe(i)
      cumulative += pages[i].split(/\s+/).filter(Boolean).length
    }
    // The very end of the book clamps to the last page
    expect(findPageForPosition(pageStarts, cumulative)).toBe(pages.length - 1)
  })
})
