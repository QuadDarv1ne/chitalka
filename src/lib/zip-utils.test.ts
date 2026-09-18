import { describe, it, expect } from 'vitest'
import { deflateRawSync } from 'node:zlib'
import { unzip, readFirstEntryHead } from './zip-utils'

/**
 * Build a ZIP from scratch: local headers + data + central directory + EOCD.
 * `useDescriptor` reproduces the layout that broke the old local-header
 * walker: local header sizes are zero and the real sizes sit only in a data
 * descriptor after the data (and in the central directory).
 */
function buildZip(
  files: { name: string; data: Uint8Array; deflate?: boolean; useDescriptor?: boolean }[],
): ArrayBuffer {
  const chunks: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0

  const enc = new TextEncoder()
  const push = (bytes: Uint8Array) => {
    chunks.push(bytes)
    offset += bytes.length
  }

  for (const f of files) {
    const nameBytes = enc.encode(f.name)
    const raw = f.data
    const compressed = f.deflate
      ? new Uint8Array(deflateRawSync(Buffer.from(raw)))
      : raw
    const stored = f.deflate ?? false
    const flags = (f.useDescriptor ? 0x08 : 0) | 0x800 // UTF-8 names

    const local = new Uint8Array(30 + nameBytes.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(4, 20, true) // version needed
    lv.setUint16(6, flags, true)
    lv.setUint16(8, stored ? 8 : 0, true) // method
    lv.setUint16(10, 0, true) // time
    lv.setUint16(12, 0x2100, true) // date (must be non-zero)
    lv.setUint32(14, 0, true) // crc — zero when using a descriptor
    lv.setUint32(18, f.useDescriptor ? 0 : compressed.length, true)
    lv.setUint32(22, f.useDescriptor ? 0 : raw.length, true)
    lv.setUint16(26, nameBytes.length, true)
    lv.setUint16(28, 0, true)
    local.set(nameBytes, 30)

    push(local)
    const localDataOffset = offset
    push(compressed)
    if (f.useDescriptor) {
      const desc = new Uint8Array(16)
      const dv = new DataView(desc.buffer)
      dv.setUint32(0, 0x08074b50, true)
      dv.setUint32(4, 0, true) // crc
      dv.setUint32(8, compressed.length, true)
      dv.setUint32(12, raw.length, true)
      push(desc)
    }

    const cd = new Uint8Array(46 + nameBytes.length)
    const cv = new DataView(cd.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(4, 20, true) // version made by
    cv.setUint16(6, 20, true) // version needed
    cv.setUint16(8, flags, true)
    cv.setUint16(10, stored ? 8 : 0, true)
    cv.setUint16(12, 0, true)
    cv.setUint16(14, 0x2100, true)
    cv.setUint32(16, 0, true) // crc
    cv.setUint32(20, compressed.length, true)
    cv.setUint32(24, raw.length, true)
    cv.setUint16(28, nameBytes.length, true)
    // extra, comment, disk, attrs all zero
    cv.setUint32(42, localDataOffset, true)
    cd.set(nameBytes, 46)
    central.push(cd)
  }

  const centralOffset = offset
  for (const cd of central) push(cd)

  const eocd = new Uint8Array(22)
  const ev = new DataView(eocd.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, files.length, true)
  ev.setUint16(10, files.length, true)
  ev.setUint32(12, offset - centralOffset, true)
  ev.setUint32(16, centralOffset, true)
  push(eocd)

  const total = chunks.reduce((n, c) => n + c.length, 0)
  const out = new Uint8Array(total)
  let p = 0
  for (const c of chunks) {
    out.set(c, p)
    p += c.length
  }
  return out.buffer
}

const dec = (bytes: Uint8Array) => new TextDecoder().decode(bytes)

describe('unzip', () => {
  it('extracts stored and deflated entries via the central directory', async () => {
    const zip = buildZip([
      { name: 'META-INF/container.xml', data: new TextEncoder().encode('<?xml version="1.0"?>') },
      { name: 'OEBPS/content.opf', data: new TextEncoder().encode('package'), deflate: true },
      { name: 'OEBPS/cover.jpg', data: new Uint8Array(256).fill(0xff) },
    ])
    const entries = await unzip(zip)
    expect(Object.keys(entries).length).toBe(3)
    expect(dec(entries['META-INF/container.xml'])).toContain('<?xml')
    expect(dec(entries['OEBPS/content.opf'])).toBe('package')
    expect(entries['OEBPS/cover.jpg'].length).toBe(256)
  })

  it('recovers sizes from the central directory when local headers use data descriptors', async () => {
    // Regression: the old local-header walker found the descriptor signature
    // inside deflate streams and dropped entries (container.xml included).
    const zip = buildZip([
      {
        name: 'META-INF/container.xml',
        data: new TextEncoder().encode('<container/>'),
        deflate: true,
        useDescriptor: true,
      },
      { name: 'text.html', data: new TextEncoder().encode('<html></html>'), useDescriptor: true },
    ])
    const entries = await unzip(zip)
    expect(dec(entries['META-INF/container.xml'])).toBe('<container/>')
    expect(dec(entries['text.html'])).toBe('<html></html>')
  })

  it('decodes UTF-8 entry names', async () => {
    const zip = buildZip([{ name: 'книга/глава 1.html', data: new TextEncoder().encode('ok') }])
    const entries = await unzip(zip)
    expect(Object.keys(entries)).toContain('книга/глава 1.html')
  })

  it('returns an empty map for non-ZIP data', async () => {
    const junk = new Uint8Array(1024).fill(0x41)
    expect(await unzip(junk.buffer)).toEqual({})
  })
})

describe('readFirstEntryHead', () => {
  it('reads the head of the first matching entry without decompressing the rest', async () => {
    const long = new Uint8Array(200_000).fill(0x42)
    const zip = buildZip([
      { name: 'skip.txt', data: new TextEncoder().encode('not this one') },
      { name: '01_track.mp3', data: long, deflate: true },
    ])
    const head = await readFirstEntryHead(zip, (n) => n.endsWith('.mp3'), 1024)
    expect(head).not.toBeNull()
    expect(head!.matches).toBe(1)
    expect(head!.data.length).toBe(1024)
    expect(head!.data.every((b) => b === 0x42)).toBe(true)
  })

  it('returns null when nothing matches', async () => {
    const zip = buildZip([{ name: 'a.txt', data: new TextEncoder().encode('x') }])
    expect(await readFirstEntryHead(zip, (n) => n.endsWith('.mp3'), 1024)).toBeNull()
  })
})
