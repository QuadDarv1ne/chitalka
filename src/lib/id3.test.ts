import { describe, it, expect } from 'vitest'
import { parseId3v2, parseId3v1, mergeAudioTags } from './id3'

/** Build an ID3v2.3 tag with the given frames. */
function tagv23(frames: { id: string; body: Uint8Array }[]): Uint8Array {
  const parts: Uint8Array[] = []
  let bodySize = 0
  for (const f of frames) {
    const header = new Uint8Array(10)
    header.set(new TextEncoder().encode(f.id), 0)
    const view = new DataView(header.buffer)
    view.setUint32(4, f.body.length, false) // v2.3: plain big-endian size
    parts.push(header, f.body)
    bodySize += 10 + f.body.length
  }
  const header = new Uint8Array(10)
  header.set([0x49, 0x44, 0x33, 3, 0, 0]) // "ID3", v2.3, no flags
  const view = new DataView(header.buffer)
  // synchsafe tag size
  view.setUint32(6, ((bodySize & 0x7f) | ((bodySize >>> 7 & 0x7f) << 8) | ((bodySize >>> 14 & 0x7f) << 16) | ((bodySize >>> 21 & 0x7f) << 24)) >>> 0, false)
  const total = [header, ...parts]
  const size = total.reduce((n, a) => n + a.length, 0)
  const out = new Uint8Array(size)
  let p = 0
  for (const a of total) {
    out.set(a, p)
    p += a.length
  }
  return out
}

/** Text frame: 1 encoding byte + payload. */
function textFrame(encoding: number, text: string): Uint8Array {
  const payload = new TextEncoder().encode(text)
  const body = new Uint8Array(1 + payload.length)
  body[0] = encoding
  body.set(payload, 1)
  return body
}

describe('parseId3v2 (v2.3)', () => {
  it('reads TIT2 / TPE1 / TALB', () => {
    const bytes = tagv23([
      { id: 'TIT2', body: textFrame(3, 'Разговор с Богом') },
      { id: 'TPE1', body: textFrame(3, 'Нил Доналд Уолш') },
      { id: 'TALB', body: textFrame(3, 'Аудиокнига') },
    ])
    const tags = parseId3v2(bytes)
    expect(tags.title).toBe('Разговор с Богом')
    expect(tags.author).toBe('Нил Доналд Уолш')
    expect(tags.album).toBe('Аудиокнига')
    expect(tags.cover).toBeUndefined()
  })

  it('returns empty for non-ID3 data and unsupported versions', () => {
    expect(parseId3v2(new Uint8Array(64).fill(0x41))).toEqual({})
    expect(parseId3v2(new Uint8Array(5))).toEqual({})
    // The parser accepts versions 2-4; v5 must be rejected
    const bad = tagv23([{ id: 'TIT2', body: textFrame(3, 'x') }])
    bad[3] = 5
    expect(parseId3v2(bad)).toEqual({})
  })

  it('stops at padding instead of reading garbage frames', () => {
    const bytes = tagv23([{ id: 'TIT2', body: textFrame(3, 'Title') }])
    // Append zero padding inside the tag body
    const padded = new Uint8Array(bytes.length + 64)
    padded.set(bytes, 0)
    expect(parseId3v2(padded).title).toBe('Title')
  })
})

describe('parseId3v1', () => {
  /**
   * ID3v1 fields are windows-1251 in Russian releases; TextEncoder only
   * produces UTF-8, so the fixture needs a real cp1251 encoder.
   */
  function cp1251(text: string): Uint8Array {
    const out = new Uint8Array(text.length)
    for (let i = 0; i < text.length; i++) {
      const c = text.codePointAt(i)!
      if (c < 0x80) out[i] = c
      else if (c >= 0x410 && c <= 0x44f) out[i] = c - 0x410 + 0xc0
      else if (c === 0x401) out[i] = 0xa8 // Ё
      else if (c === 0x451) out[i] = 0xb8 // ё
      else out[i] = 0x3f
    }
    return out
  }

  function tailv1(fields: { title?: string; artist?: string; album?: string }): Uint8Array {
    const tail = new Uint8Array(128)
    tail.set(new TextEncoder().encode('TAG'), 0)
    const put = (text: string, offset: number, length: number) => {
      tail.set(cp1251(text).subarray(0, length), offset)
    }
    put(fields.title ?? '', 3, 30)
    put(fields.artist ?? '', 33, 30)
    put(fields.album ?? '', 63, 30)
    return tail
  }

  it('reads the three text fields', () => {
    const tags = parseId3v1(tailv1({ title: 'Введение', artist: 'Александр Мень', album: 'Книга' }))
    expect(tags.title).toBe('Введение')
    expect(tags.author).toBe('Александр Мень')
    expect(tags.album).toBe('Книга')
  })

  it('rejects tails without the TAG marker or too short', () => {
    expect(parseId3v1(new Uint8Array(127))).toEqual({})
    const noTag = tailv1({ title: 'x' })
    noTag[0] = 0x58 // not "TAG"
    expect(parseId3v1(noTag)).toEqual({})
  })
})

describe('mergeAudioTags', () => {
  it('fills gaps without overwriting primary values', () => {
    expect(
      mergeAudioTags(
        { title: 'A' },
        { title: 'B', author: 'C', cover: 'data:image/png;base64,x' },
      ),
    ).toEqual({ title: 'A', author: 'C', cover: 'data:image/png;base64,x' })
  })
})
