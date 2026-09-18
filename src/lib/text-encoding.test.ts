import { describe, it, expect } from 'vitest'
import { decodeTextBytes, detectXmlEncoding } from './text-encoding'

/** Build an encoder for a legacy code page from its decoder. */
function makeEncoder(label: string): (text: string) => Uint8Array {
  const dec = new TextDecoder(label)
  const map = new Map<string, number>()
  for (let b = 0x80; b <= 0xff; b++) {
    const ch = dec.decode(new Uint8Array([b]))
    if (ch && ch !== '\uFFFD' && !map.has(ch)) map.set(ch, b)
  }
  return (text) => {
    const out = new Uint8Array(text.length)
    for (let i = 0; i < text.length; i++) {
      const c = text.codePointAt(i)!
      if (c < 0x80) out[i] = c
      else out[i] = map.get(text[i]) ?? 0x3f
    }
    return out
  }
}

const asBuf = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer

describe('decodeTextBytes', () => {
  it('decodes UTF-8 (with and without BOM)', () => {
    const text = 'Война и мир'
    const utf8 = new TextEncoder().encode(text)
    expect(decodeTextBytes(asBuf(utf8))).toBe(text)

    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8])
    expect(decodeTextBytes(asBuf(bom))).toBe(text)
  })

  it('decodes UTF-16LE with BOM', () => {
    // TextEncoder only produces UTF-8, so build UTF-16LE bytes by hand
    const text = 'Война и мир'
    const units = [...text]
    const bytes = new Uint8Array(2 + units.length * 2)
    bytes[0] = 0xff
    bytes[1] = 0xfe
    for (let i = 0; i < units.length; i++) {
      const c = units[i].codePointAt(0)!
      bytes[2 + i * 2] = c & 0xff
      bytes[3 + i * 2] = c >>> 8
    }
    expect(decodeTextBytes(asBuf(bytes))).toBe(text)
  })

  it('honours the declared windows-1251 encoding', () => {
    const cp1251 = makeEncoder('windows-1251')
    const xml = '<?xml version="1.0" encoding="windows-1251"?><title>Война и мир</title>'
    expect(decodeTextBytes(asBuf(cp1251(xml)))).toBe(xml)
  })

  it('heuristic: cp1251 body text without a declaration', () => {
    const cp1251 = makeEncoder('windows-1251')
    // Prose is mostly lowercase, which identifies the right code page
    const prose = 'война и мир, разговор с богом, стоицизм каждый день'.repeat(20)
    expect(decodeTextBytes(asBuf(cp1251(prose)))).toBe(prose)
  })

  it('heuristic: KOI8-R body text without a declaration', () => {
    const koi8 = makeEncoder('koi8-r')
    const prose = 'война и мир, разговор с богом, стоицизм каждый день'.repeat(20)
    expect(decodeTextBytes(asBuf(koi8(prose)))).toBe(prose)
  })

  it('never throws on arbitrary bytes', () => {
    const noise = new Uint8Array(4096)
    for (let i = 0; i < noise.length; i++) noise[i] = (i * 7 + 13) & 0xff
    expect(typeof decodeTextBytes(asBuf(noise))).toBe('string')
  })
})

describe('detectXmlEncoding', () => {
  it('reads the encoding attribute from the declaration', () => {
    const xml = new TextEncoder().encode('<?xml version="1.0" encoding="KOI8-R"?><a/>')
    expect(detectXmlEncoding(asBuf(xml))).toBe('KOI8-R')
  })

  it('returns null without a declaration', () => {
    const xml = new TextEncoder().encode('<a>plain</a>')
    expect(detectXmlEncoding(asBuf(xml))).toBeNull()
  })
})
