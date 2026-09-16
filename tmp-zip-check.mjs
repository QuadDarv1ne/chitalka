// Temporary verification harness for unzip(). Deleted after the run.
import fs from 'node:fs'
import zlib from 'node:zlib'
import { unzip } from './src/lib/zip-utils.ts'

// ---- 1) real archives -------------------------------------------------
const real = fs.readdirSync('books').filter((f) => /\.(epub|mp3\.zip|zip)$/i.test(f))
for (const f of real) {
  const buf = fs.readFileSync('books/' + f)
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  const entries = await unzip(ab)
  const names = Object.keys(entries)
  const empty = names.filter((n) => entries[n].length === 0 && !n.endsWith('/'))
  console.log(`${f.slice(0, 50).padEnd(52)} entries=${String(names.length).padStart(3)} empty=${empty.length}`)
  if (/\.epub$/i.test(f)) {
    console.log(`   container.xml=${!!entries['META-INF/container.xml']} opf=${names.find((n) => n.endsWith('.opf'))} cover=${names.find((n) => /cover\.(jpe?g|png)$/i.test(n)) ?? 'none'}`)
  }
}

// ---- 2) synthetic archives (streamed entries with data descriptors) ----
function crc32(buf) {
  let t = crc32.t
  if (!t) {
    t = crc32.t = new Uint32Array(256)
    for (let i = 0; i < 256; i++) {
      let c = i
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      t[i] = c >>> 0
    }
  }
  let crc = 0xffffffff
  for (const b of buf) crc = t[(crc ^ b) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function buildZip(entries, { stream = false, withCentral = true, utf8Names = true } = {}) {
  const parts = []
  const central = []
  let offset = 0
  for (const { name, text } of entries) {
    const nameBytes = new TextEncoder().encode(name)
    const raw = new TextEncoder().encode(text)
    const deflated = zlib.deflateRawSync(raw)
    const crc = crc32(raw)
    const lh = new DataView(new ArrayBuffer(30))
    lh.setUint32(0, 0x04034b50, true)
    lh.setUint16(4, 20, true)
    lh.setUint16(6, (stream ? 0x08 : 0) | (utf8Names ? 0x800 : 0), true)
    lh.setUint16(8, 8, true)
    lh.setUint32(14, crc, true)
    lh.setUint32(18, stream ? 0 : deflated.length, true)
    lh.setUint32(22, stream ? 0 : raw.length, true)
    lh.setUint16(26, nameBytes.length, true)
    parts.push(Buffer.from(lh.buffer), nameBytes, deflated)
    let used = 30 + nameBytes.length + deflated.length
    if (stream) {
      const d = new DataView(new ArrayBuffer(16))
      d.setUint32(0, 0x08074b50, true)
      d.setUint32(4, crc, true)
      d.setUint32(8, raw.length, true)
      d.setUint32(12, deflated.length, true)
      parts.push(Buffer.from(d.buffer))
      used += 16
    }
    if (withCentral) {
      const ch = new DataView(new ArrayBuffer(46))
      ch.setUint32(0, 0x02014b50, true)
      ch.setUint16(4, 20, true)
      ch.setUint16(6, 20, true)
      ch.setUint16(8, (stream ? 0x08 : 0) | (utf8Names ? 0x800 : 0), true)
      ch.setUint16(10, 8, true)
      ch.setUint32(16, crc, true)
      ch.setUint32(20, deflated.length, true)
      ch.setUint32(24, raw.length, true)
      ch.setUint16(28, nameBytes.length, true)
      ch.setUint32(42, offset, true)
      central.push(Buffer.from(ch.buffer), nameBytes)
    }
    offset += used
  }
  const out = [...parts]
  if (withCentral) {
    const cdPos = parts.reduce((a, b) => a + b.length, 0)
    out.push(...central)
    const cdSize = central.reduce((a, b) => a + b.length, 0)
    const eocd = new DataView(new ArrayBuffer(22))
    eocd.setUint32(0, 0x06054b50, true)
    eocd.setUint16(8, entries.length, true)
    eocd.setUint16(10, entries.length, true)
    eocd.setUint32(12, cdSize, true)
    eocd.setUint32(16, cdPos, true)
    out.push(Buffer.from(eocd.buffer))
  }
  return Buffer.concat(out)
}

const sample = [
  { name: 'META-INF/container.xml', text: '<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>' },
  { name: 'OEBPS/content.opf', text: '<package><dc:title>Тестовая книга</dc:title><dc:creator>Автор Тест</dc:creator></package>' },
  { name: 'OEBPS/text/ch1.xhtml', text: '<html>' + 'x'.repeat(5000) + '</html>' },
  { name: 'OEBPS/images/cover.jpg', text: 'JPEGDATA'.repeat(2000) },
]

for (const variant of [
  { label: 'sizes in local header + central dir', opts: { stream: false } },
  { label: 'streamed descriptors + central dir', opts: { stream: true } },
  { label: 'streamed, NO central dir (fallback)', opts: { stream: true, withCentral: false } },
  { label: 'plain, NO central dir (fallback)', opts: { stream: false, withCentral: false } },
]) {
  const buf = buildZip(sample, variant.opts)
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  const entries = await unzip(ab)
  const names = Object.keys(entries)
  const dec = (n) => (entries[n] ? new TextDecoder().decode(entries[n]) : null)
  console.log(
    `${variant.label.padEnd(38)} entries=${names.length} container=${String(dec('META-INF/container.xml')?.startsWith('<?xml'))} title=${dec('OEBPS/content.opf')?.match(/<dc:title>([^<]+)/)?.[1] ?? 'MISSING'} bigLen=${dec('OEBPS/text/ch1.xhtml')?.length ?? 0} coverLen=${entries['OEBPS/images/cover.jpg']?.length ?? 0}`,
  )
}

// ---- 3) degenerate buffers -------------------------------------------
for (const [label, b] of [
  ['empty', new ArrayBuffer(0)],
  ['garbage', new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer],
  ['zip header only', buildZip(sample).subarray(0, 40).buffer],
  ['truncated zip', buildZip(sample).subarray(0, 300).buffer],
]) {
  try {
    console.log(`${label.padEnd(16)} ${Object.keys(await unzip(b)).length} entries`)
  } catch (e) {
    console.log(`${label.padEnd(16)} THREW ${e.message}`)
  }
}
