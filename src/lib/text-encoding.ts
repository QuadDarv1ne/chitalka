'use client'

/**
 * Decode a book file's bytes into a string.
 *
 * Russian libraries are often cp1251-encoded (FB2/TXT). `blob.text()` always
 * assumes UTF-8 and produces mojibake for those files, so we:
 * 1. honor BOMs (UTF-8/UTF-16LE/UTF-16BE),
 * 2. honor an explicit `encoding="…"` from the XML declaration,
 * 3. fall back: valid UTF-8 stays UTF-8, otherwise windows-1251.
 */
export function decodeTextBytes(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)

  // BOM detection
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3))
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(2))
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(bytes.subarray(2))
  }

  // Explicit XML declaration encoding
  const declared = detectXmlEncoding(buf)
  if (declared && declared !== 'utf-8' && declared !== 'utf8') {
    try {
      return new TextDecoder(declared).decode(bytes)
    } catch {
      // Unknown label — fall through to heuristic
    }
  }

  // Strict UTF-8 validity check
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    // Not valid UTF-8: a Russian legacy file is either windows-1251 or KOI8-R,
    // and both decode every byte, so no exception tells them apart.
    const cp1251 = tryDecode('windows-1251', bytes)
    const koi8 = tryDecode('koi8-r', bytes)
    if (cp1251 === null) return koi8 ?? new TextDecoder('utf-8').decode(bytes)
    if (koi8 === null) return cp1251
    return cyrillicScore(koi8) > cyrillicScore(cp1251) ? koi8 : cp1251
  }
}

function tryDecode(label: string, bytes: Uint8Array): string | null {
  try {
    return new TextDecoder(label).decode(bytes)
  } catch {
    return null
  }
}

/**
 * How much a decoded text looks like Russian prose.
 *
 * KOI8-R orders the alphabet and puts lowercase in 0xC0-0xDF while windows-1251
 * puts uppercase there, so decoding one as the other turns body text — which is
 * about three quarters lowercase — into a wall of capitals. The lowercase share
 * of the Cyrillic letters therefore identifies the right code page far better
 * than any "invalid byte" check could.
 */
function cyrillicScore(text: string): number {
  let letters = 0
  let lowercase = 0
  let rare = 0
  const limit = Math.min(text.length, 20_000)

  for (let i = 0; i < limit; i++) {
    const c = text.charCodeAt(i)
    if (c >= 0x0430 && c <= 0x044f) {
      // а-я
      letters++
      lowercase++
    } else if (c >= 0x0410 && c <= 0x042f) {
      // А-Я
      letters++
    } else if (c === 0x0451) {
      // ё
      letters++
      lowercase++
    } else if (c === 0x0401) {
      // Ё
      letters++
    } else if ((c >= 0x2500 && c <= 0x257f) || (c >= 0x0400 && c <= 0x040f)) {
      // Box drawing and Ukrainian/Bulgarian extras: what KOI8-R punctuation
      // bytes turn into when they are read as windows-1251.
      rare++
    }
  }

  if (letters === 0) return -1
  return (lowercase / letters) * 100 - rare
}

/**
 * Read the `encoding="…"` attribute from an XML declaration (first 512 bytes).
 * latin1 maps bytes to code points 1:1, so the regex is byte-accurate.
 */
export function detectXmlEncoding(buf: ArrayBuffer): string | null {
  const bytes = new Uint8Array(buf)
  const prefix = new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(512, bytes.byteLength)))
  const m = prefix.match(/encoding=["']([^"']+)["']/i)
  return m ? m[1] : null
}

/** Convenience: decode a Blob (async). */
export async function decodeTextBlob(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer()
  return decodeTextBytes(buf)
}
