// Debug: run the real unzip over the test fixture
import { deflateRawSync } from 'node:zlib'
import { unzip } from './src/lib/zip-utils.ts'

const enc = new TextEncoder()
function buildZip(files) {
  const chunks = []
  const central = []
  let offset = 0
  const push = (b) => { chunks.push(b); offset += b.length }
  for (const f of files) {
    const nameBytes = enc.encode(f.name)
    const deflated = f.deflate === true
    const compressed = deflated ? new Uint8Array(deflateRawSync(Buffer.from(f.data))) : f.data
    const flags = (f.useDescriptor ? 0x08 : 0) | 0x800
    const local = new Uint8Array(30 + nameBytes.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(4, 20, true); lv.setUint16(6, flags, true); lv.setUint16(8, deflated ? 8 : 0, true)
    lv.setUint16(10, 0, true); lv.setUint16(12, 0x2100, true)
    lv.setUint32(14, 0, true)
    lv.setUint32(18, f.useDescriptor ? 0 : compressed.length, true)
    lv.setUint32(22, f.useDescriptor ? 0 : f.data.length, true)
    lv.setUint16(26, nameBytes.length, true); lv.setUint16(28, 0, true)
    local.set(nameBytes, 30)
    push(local)
    const localDataOffset = offset
    push(compressed)
    if (f.useDescriptor) {
      const desc = new Uint8Array(16)
      const dv = new DataView(desc.buffer)
      dv.setUint32(0, 0x08074b50, true)
      dv.setUint32(8, compressed.length, true)
      dv.setUint32(12, f.data.length, true)
      push(desc)
    }
    const cd = new Uint8Array(46 + nameBytes.length)
    const cv = new DataView(cd.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, flags, true)
    cv.setUint16(10, deflated ? 8 : 0, true)
    cv.setUint16(12, 0, true); cv.setUint16(14, 0x2100, true)
    cv.setUint32(16, 0, true)
    cv.setUint32(20, compressed.length, true); cv.setUint32(24, f.data.length, true)
    cv.setUint16(28, nameBytes.length, true)
    cv.setUint32(42, localDataOffset, true)
    cd.set(nameBytes, 46)
    central.push(cd)
  }
  const centralOffset = offset
  for (const cd of central) push(cd)
  const eocd = new Uint8Array(22)
  const ev = new DataView(eocd.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true)
  ev.setUint32(12, offset - centralOffset, true); ev.setUint32(16, centralOffset, true)
  push(eocd)
  const total = chunks.reduce((n, c) => n + c.length, 0)
  const out = new Uint8Array(total)
  let p = 0
  for (const c of chunks) { out.set(c, p); p += c.length }
  return out.buffer
}

const zip = buildZip([
  { name: 'META-INF/container.xml', data: enc.encode('<?xml version="1.0"?>') },
  { name: 'OEBPS/content.opf', data: enc.encode('package'), deflate: true },
  { name: 'OEBPS/cover.jpg', data: new Uint8Array(256).fill(0xff) },
])
const entries = await unzip(zip)
console.log('keys:', Object.keys(entries))
console.log('sizes:', Object.entries(entries).map(([k, v]) => `${k}=${v.length}`).join(' '))

// Replicate the parser steps to find where it diverges
const view = new DataView(zip)
const byteLength = zip.byteLength
const last = byteLength - 22
let eocdOffset = null
for (let i = last; i >= 0; i--) {
  if (view.getUint32(i, true) === 0x06054b50 && i + 22 + view.getUint16(i + 20, true) === byteLength) { eocdOffset = i; break }
}
console.log('eocdOffset', eocdOffset)
const totalEntries = view.getUint16(eocdOffset + 10, true)
const cdOffset = view.getUint32(eocdOffset + 16, true)
console.log('totalEntries', totalEntries, 'cdOffset', cdOffset, 'cd+46>len?', cdOffset + 46 > byteLength)
let off = cdOffset
let n = 0
while (n < totalEntries) {
  if (off + 46 > byteLength || view.getUint32(off, true) !== 0x02014b50) { console.log('CD walk stopped at', off, 'sig', view.getUint32(off, true).toString(16)); break }
  const flags = view.getUint16(off + 8, true)
  const method = view.getUint16(off + 10, true)
  const compressedSize = view.getUint32(off + 20, true)
  const uncompressedSize = view.getUint32(off + 24, true)
  const nameLen = view.getUint16(off + 28, true)
  const extraLen = view.getUint16(off + 30, true)
  const commentLen = view.getUint16(off + 32, true)
  const localOffset = view.getUint32(off + 42, true)
  const name = new TextDecoder().decode(new Uint8Array(zip, off + 46, nameLen))
  console.log('entry', JSON.stringify({ name, flags, method, compressedSize, uncompressedSize, localOffset }))
  const dataStart = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true)
  console.log('  localSig', view.getUint32(localOffset, true).toString(16), 'dataStart', dataStart, 'dataStart+c>len?', dataStart + compressedSize > byteLength)
  off = off + 46 + nameLen + extraLen + commentLen
  n++
}
