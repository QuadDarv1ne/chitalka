/**
 * Text-level FB2 metadata recovery.
 *
 * DOMParser rejects a document over a single unescaped ampersand or a stray
 * closing tag inside an annotation, which is routine in files from Russian
 * libraries — the reader would then see the file name instead of the title.
 * The fields we need are still plainly readable from the source text.
 *
 * Kept free of DOM APIs and of path aliases so it can run anywhere and be
 * exercised directly.
 */

export interface ScannedFb2Meta {
  title?: string
  author?: string
  description?: string
  cover?: string
}

const XML_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
  // FB2 annotations are full of these; leaving them as literal "&laquo;" text
  // in a book description is what readers of Russian prose notice first.
  laquo: '\u00ab',
  raquo: '\u00bb',
  ldquo: '\u201c',
  rdquo: '\u201d',
  bdquo: '\u201e',
  lsquo: '\u2018',
  rsquo: '\u2019',
  mdash: '\u2014',
  ndash: '\u2013',
  hellip: '\u2026',
  middot: '\u00b7',
  bull: '\u2022',
  copy: '\u00a9',
  reg: '\u00ae',
  deg: '\u00b0',
  plusmn: '\u00b1',
  times: '\u00d7',
  divide: '\u00f7',
  euro: '\u20ac',
  trade: '\u2122',
  shy: '',
}

function codePointSafe(code: number): string {
  if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return ''
  try {
    return String.fromCodePoint(code)
  } catch {
    return ''
  }
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => codePointSafe(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => codePointSafe(Number.parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (match, name: string) => XML_ENTITIES[name.toLowerCase()] ?? match)
}

/**
 * Strip markup and CDATA, decode entities, collapse whitespace.
 * The NBSP that &#160; decodes to is preserved: it is a meaningful part of a
 * title ("Том II"), not run-together junk like newlines between tags.
 */
function cleanXmlFragment(fragment: string, limit: number): string {
  return decodeXmlEntities(
    fragment.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]*>/g, ' '),
  )
    // \s matches NBSP too (\u00a0 < \u0250), hence the explicit class
    .replace(/[	\n\r\f\v ]+/g, ' ')
    .trim()
    .slice(0, limit)
}

/**
 * Inner text of the first matching element. The span is capped so that a
 * missing closing tag in a malformed document cannot make the match swallow
 * the whole file.
 */
function innerText(text: string, tag: string, maxSpan: number): string | undefined {
  // String.raw keeps the backslashes intact: inside a plain template literal
  // "\b" would already be a backspace and "[\s\S]" would become "[sS]".
  const pattern = String.raw`<${tag}\b[^>]*>([\s\S]{0,${maxSpan}}?)</${tag}>`
  return text.match(new RegExp(pattern, 'i'))?.[1]
}

/**
 * Recover title, author, annotation and cover by scanning FB2 source text.
 * Only the fields actually found are returned, so the caller can merge the
 * result over its own defaults.
 */
export function scanFb2Meta(text: string): ScannedFb2Meta {
  const out: ScannedFb2Meta = {}

  const title = innerText(text, 'book-title', 600)
  if (title) {
    const value = cleanXmlFragment(title, 300)
    if (value) out.title = value
  }

  const authorBlock = innerText(text, 'author', 2000)
  if (authorBlock) {
    const part = (tag: string) => cleanXmlFragment(innerText(authorBlock, tag, 200) ?? '', 100)
    const name = [part('last-name'), part('first-name'), part('middle-name')]
      .filter(Boolean)
      .join(' ')
      .trim()
    const value = name || cleanXmlFragment(authorBlock, 120)
    if (value) out.author = value
  }

  const annotation = innerText(text, 'annotation', 6000)
  if (annotation) {
    const value = cleanXmlFragment(annotation, 500)
    if (value) out.description = value
  }

  const coverHref = text.match(
    /<coverpage\b[^>]*>[\s\S]{0,400}?<image\b[^>]*?(?:xlink:|l:)?href=["'][^"']*#([^"']+)["']/i,
  )?.[1]
  if (coverHref) {
    const cover = extractFb2Binary(text, coverHref)
    if (cover) out.cover = cover
  }

  return out
}

/** Base64 payload of the <binary id="…"> element, as a data URL. */
export function extractFb2Binary(text: string, id: string): string | undefined {
  const element = /<binary\b[^>]*>([\s\S]*?)<\/binary>/gi
  let match: RegExpExecArray | null
  while ((match = element.exec(text)) !== null) {
    const tag = match[0].slice(0, match[0].indexOf('>') + 1)
    if (tag.match(/\bid=["']([^"']+)["']/i)?.[1] !== id) continue
    const contentType = tag.match(/\bcontent-type=["']([^"']+)["']/i)?.[1] ?? 'image/jpeg'
    const data = match[1].replace(/\s/g, '')
    if (data.length < 64) return undefined
    return `data:${contentType};base64,${data}`
  }
  return undefined
}
