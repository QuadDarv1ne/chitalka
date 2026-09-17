/**
 * Metadata quality markers.
 *
 * Every parser falls back to placeholders when it could not read anything, and
 * until now that fallback was silent: the card simply showed a transliterated
 * file name and the reader had no way to tell a broken parse from a book that
 * genuinely has no author. These helpers make the difference visible so the UI
 * can offer a fix instead of a mystery.
 */

export const PLACEHOLDER_AUTHOR = 'Неизвестный автор'
export const PLACEHOLDER_AUTHOR_LOCAL = 'Локальный файл'
export const PLACEHOLDER_TITLE = 'Без названия'

/** Author value written by the parsers when the file had none. */
export function isPlaceholderAuthor(author: string | undefined | null): boolean {
  if (!author) return true
  const value = author.trim()
  return (
    value === '' ||
    value === PLACEHOLDER_AUTHOR ||
    value === PLACEHOLDER_AUTHOR_LOCAL ||
    value.toLowerCase() === 'unknown'
  )
}

/**
 * A title that came out of the file system rather than out of the file:
 * the generic placeholder, a transliterated slug with underscores, or a name
 * still carrying a library suffix such as ".a6".
 */
export function isPlaceholderTitle(title: string | undefined | null): boolean {
  if (!title) return true
  const value = title.trim()
  if (value === '' || value === PLACEHOLDER_TITLE) return true
  if (/\.[a-z]\d$/i.test(value)) return true // ".a6", ".a4"
  if (/\d{5,}/.test(value)) return true // catalogue ids
  if (value.includes('_')) return true // "Ivanov_I._Kniga"
  return false
}

export interface MissingMetadata {
  title: boolean
  author: boolean
  cover: boolean
  any: boolean
}

export function missingMetadata(book: {
  title?: string
  author?: string
  cover?: string
}): MissingMetadata {
  const title = isPlaceholderTitle(book.title)
  const author = isPlaceholderAuthor(book.author)
  const cover = !book.cover
  return { title, author, cover, any: title || author }
}
