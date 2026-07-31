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
    // Not valid UTF-8 — the common case for Russian legacy files is cp1251
    try {
      return new TextDecoder('windows-1251').decode(bytes)
    } catch {
      return new TextDecoder('utf-8').decode(bytes)
    }
  }
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
