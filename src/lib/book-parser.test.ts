import { describe, it, expect } from 'vitest'
import { cleanBookFilename, audioMetaFromFilename } from './book-parser'

describe('cleanBookFilename', () => {
  it('strips extensions, including double ones', () => {
    expect(cleanBookFilename('Книга.epub')).toBe('Книга')
    expect(cleanBookFilename('Книга.fb2.zip')).toBe('Книга')
    expect(cleanBookFilename('Аудиокнига.mp3.zip')).toBe('Аудиокнига')
  })

  it('strips library dump markers', () => {
    // trailing ".a6"/".a4" format markers
    expect(cleanBookFilename('Morozov_I._Bogestlyubov.a6.pdf')).toBe('Morozov I. Bogestlyubov')
    // trailing catalogue ids
    expect(cleanBookFilename('Smart_reading._Klyuchevyie_Idei_Knigi_Ye66992464.a6.pdf')).toBe(
      'Smart reading. Klyuchevyie Idei Knigi',
    )
    // duplicate suffixes
    expect(cleanBookFilename('Книга (1).pdf')).toBe('Книга')
    expect(cleanBookFilename('Книга (копия).pdf')).toBe('Книга')
  })

  it('replaces underscores with spaces and collapses whitespace', () => {
    expect(cleanBookFilename('Trud_Byit_Soboyi_Praktich.a4.pdf')).toBe(
      'Trud Byit Soboyi Praktich',
    )
  })

  it('keeps a clean name intact', () => {
    expect(cleanBookFilename('Война и мир.epub')).toBe('Война и мир')
    expect(cleanBookFilename('1984.pdf')).toBe('1984')
  })

  it('trims leading/trailing punctuation and dots', () => {
    expect(cleanBookFilename('.- Название -.pdf')).toBe('Название')
    expect(cleanBookFilename('Название..pdf')).toBe('Название')
  })
})

describe('audioMetaFromFilename', () => {
  it('splits "Author._Title" pattern (library dump format)', () => {
    const meta = audioMetaFromFilename('Nil_donald_uolsh._Razgovor_s_bogom.mp3.zip')
    expect(meta.author).toBe('Nil donald uolsh')
    expect(meta.title).toBe('Razgovor s bogom')
  })

  it('single underscore splits author from title', () => {
    const meta = audioMetaFromFilename('Tolstoy_Voyna_i_mir.mp3')
    expect(meta.author).toBe('Tolstoy')
    expect(meta.title).toBe('Voyna i mir')
  })

  it('falls back to the whole name as title', () => {
    const meta = audioMetaFromFilename('Книга без автора.mp3')
    expect(meta.title).toBe('Книга без автора')
    expect(meta.author).toBe('Неизвестный автор')
  })

  it('strips trailing dots from both fields', () => {
    const meta = audioMetaFromFilename('Автор._Название..mp3')
    expect(meta.author).toBe('Автор')
    expect(meta.title).toBe('Название')
  })
})
