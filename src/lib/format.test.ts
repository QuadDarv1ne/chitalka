import { describe, it, expect } from 'vitest'
import { detectFormat } from './format'

describe('detectFormat', () => {
  it.each([
    ['book.epub', 'epub'],
    ['book.EPUB', 'epub'],
    ['book.pdf', 'pdf'],
    ['book.fb2', 'fb2'],
    ['book.md', 'md'],
    ['book.html', 'html'],
    ['book.htm', 'html'],
    ['book.txt', 'txt'],
    ['book.mp3', 'mp3'],
    ['audiobook.mp3.zip', 'mp3'],
    ['comic.cbz', 'cbz'],
  ])('maps %s → %s', (name, format) => {
    expect(detectFormat(name)).toBe(format)
  })

  it('returns null for unsupported formats', () => {
    for (const name of ['file.djvu', 'file.zip', 'file.docx', 'file', 'file.cb7']) {
      expect(detectFormat(name)).toBeNull()
    }
  })

  // Regression guard: the collection API once kept a hand-copied duplicate of
  // this function that had silently dropped `.cbz`, so comics in the books/
  // folder were never offered for import. Both sides now share this module.
  it('recognizes .cbz (was dropped by the server duplicate)', () => {
    expect(detectFormat('my-comic.cbz')).toBe('cbz')
  })
})
