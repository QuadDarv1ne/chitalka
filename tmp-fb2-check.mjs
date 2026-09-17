// Temporary verification harness for FB2 scanning + code page detection.
import { scanFb2Meta } from './src/lib/fb2-scan.ts'
import { decodeTextBytes } from './src/lib/text-encoding.ts'

// Build an encoder for a legacy code page from the decoder's output
function makeEncoder(label) {
  const dec = new TextDecoder(label)
  const map = new Map()
  for (let b = 0x80; b <= 0xff; b++) {
    const ch = dec.decode(new Uint8Array([b]))
    if (ch && ch !== '\uFFFD' && !map.has(ch)) map.set(ch, b)
  }
  return (text) => {
    const out = []
    for (const ch of text) {
      const code = ch.codePointAt(0)
      if (code < 0x80) out.push(code)
      else if (map.has(ch)) out.push(map.get(ch))
      else out.push(0x3f)
    }
    return new Uint8Array(out)
  }
}

const koi8 = makeEncoder('koi8-r')
const cp1251 = makeEncoder('windows-1251')

const coverBase64 = Buffer.from(
  new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...Array(120).fill(0x41), 0xff, 0xd9]),
).toString('base64')

const body = `
<FictionBook>
 <description>
  <title-info>
   <author><first-name>Лев</first-name><last-name>Толстой</last-name><middle-name>Николаевич</middle-name></author>
   <book-title>Война и миръ &amp; томъ первый</book-title>
   <annotation><p>Роман о &laquo;войне&raquo; и мире.</p></annotation>
   <coverpage><image l:href="#cover.jpg"/></coverpage>
  </title-info>
 </description>
 <binary id="cover.jpg" content-type="image/jpeg">${coverBase64}</binary>
 <body><section><title><p>Глава I</p></title><p>текст</p></section></body>
</FictionBook>`

const cases = [
  ['well-formed UTF-8', new TextEncoder().encode('<?xml version="1.0" encoding="UTF-8"?>' + body)],
  ['malformed (bare &), cp1251', cp1251('<?xml version="1.0" encoding="windows-1251"?>' + body.replace('&amp;', '&').replace('</p></annotation>', '</p></badclose></annotation>'))],
  ['no declaration, cp1251', cp1251(body)],
  ['no declaration, KOI8-R', koi8(body)],
]

for (const [label, bytes] of cases) {
  const text = decodeTextBytes(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
  const meta = scanFb2Meta(text)
  console.log(`\n${label}`)
  console.log(`  title="${meta.title ?? ''}"`)
  console.log(`  author="${meta.author ?? ''}"`)
  console.log(`  description="${meta.description ?? ''}"`)
  console.log(`  cover=${meta.cover ? meta.cover.slice(0, 24) + ` (${meta.cover.length} chars)` : 'none'}`)
}

// Garbage must not throw or invent fields
console.log('\nempty →', JSON.stringify(scanFb2Meta('')))
console.log('no metadata →', JSON.stringify(scanFb2Meta('<FictionBook><body/></FictionBook>')))
// Unterminated book-title must not swallow the document
console.log(
  'unterminated title →',
  JSON.stringify(scanFb2Meta('<book-title>Обрезано ' + 'x'.repeat(100000))),
)
