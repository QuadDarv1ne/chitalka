import { describe, it, expect } from 'vitest'
import {
  isPlaceholderAuthor,
  isPlaceholderTitle,
  missingMetadata,
} from './meta-status'

describe('isPlaceholderAuthor', () => {
  it('detects parser placeholder authors', () => {
    expect(isPlaceholderAuthor('Неизвестный автор')).toBe(true)
    expect(isPlaceholderAuthor('Локальный файл')).toBe(true)
    expect(isPlaceholderAuthor('unknown')).toBe(true)
    expect(isPlaceholderAuthor('Unknown')).toBe(true)
  })

  it('treats empty or missing as placeholder', () => {
    expect(isPlaceholderAuthor('')).toBe(true)
    expect(isPlaceholderAuthor(undefined)).toBe(true)
    expect(isPlaceholderAuthor(null)).toBe(true)
    expect(isPlaceholderAuthor('   ')).toBe(true)
  })

  it('accepts a real author', () => {
    expect(isPlaceholderAuthor('Лев Толстой')).toBe(false)
    expect(isPlaceholderAuthor('Neil Donald Walsh')).toBe(false)
  })
})

describe('isPlaceholderTitle', () => {
  it('detects the generic placeholder', () => {
    expect(isPlaceholderTitle('Без названия')).toBe(true)
    expect(isPlaceholderTitle('')).toBe(true)
    expect(isPlaceholderTitle(undefined)).toBe(true)
  })

  it('detects library dump titles', () => {
    expect(isPlaceholderTitle('Morozov_I._Bogestlyubov.a6')).toBe(true)
    expect(isPlaceholderTitle('Kniga_1234567')).toBe(true)
    expect(isPlaceholderTitle('Trud_Byit_Soboyi_1234567890')).toBe(true)
  })

  it('accepts real titles', () => {
    expect(isPlaceholderTitle('Война и мир')).toBe(false)
    expect(isPlaceholderTitle('The Prince; or, a Beneficial Tyrant')).toBe(false)
    // Years and short numbers are legitimate parts of a title
    expect(isPlaceholderTitle('1984')).toBe(false)
    expect(isPlaceholderTitle('Марсианин (2015)')).toBe(false)
  })
})

describe('missingMetadata', () => {
  it('flags a fully parsed book as complete', () => {
    expect(
      missingMetadata({ title: 'Война и мир', author: 'Лев Толстой', cover: 'data:...' }),
    ).toEqual({ title: false, author: false, cover: false, any: false })
  })

  it('flags placeholder title and author', () => {
    const m = missingMetadata({ title: 'Kniga_12345', author: 'Неизвестный автор' })
    expect(m.title).toBe(true)
    expect(m.author).toBe(true)
    expect(m.any).toBe(true)
    expect(m.cover).toBe(true) // no cover passed
  })
})
