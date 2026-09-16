// Temporary verification harness for the ID3 reader. Deleted after the run.
import fs from 'node:fs'
import { readFirstEntryHead } from './src/lib/zip-utils.ts'
import { parseId3v2, parseId3v1, mergeAudioTags } from './src/lib/id3.ts'

for (const f of fs.readdirSync('books').filter((x) => /\.mp3\.zip$/i.test(x))) {
  const buf = fs.readFileSync('books/' + f)
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  const head = await readFirstEntryHead(ab, (n) => /\.mp3$/i.test(n), 512 * 1024)
  if (!head) {
    console.log(`${f.slice(0, 45)} → NO HEAD`)
    continue
  }
  const tags = parseId3v2(head.data)
  console.log(`\n${f.slice(0, 60)}`)
  console.log(`  first track: ${head.name}, head ${head.data.length} B, magic="${new TextDecoder('latin1').decode(head.data.slice(0, 3))}"`)
  console.log(`  title="${tags.title ?? ''}"`)
  console.log(`  author="${tags.author ?? ''}"`)
  console.log(`  album="${tags.album ?? ''}"`)
  console.log(`  cover=${tags.cover ? `${Math.round(tags.cover.length / 1024)} KB (${tags.cover.slice(5, tags.cover.indexOf(';'))})` : 'none'}`)
}

// ID3v1 on a hand-built tail
const tail = new Uint8Array(128)
const put = (off, s) => tail.set(new TextEncoder().encode(s.padEnd(30, ' ')).subarray(0, 30), off)
tail.set(new TextEncoder().encode('TAG'), 0)
put(3, 'Война и мир')
put(33, 'Лев Толстой')
put(63, 'Собрание сочинений')
console.log('\nID3v1 →', JSON.stringify(parseId3v1(tail)))

// Garbage must not throw
console.log('garbage →', JSON.stringify(parseId3v2(new TextEncoder().encode('not a tag at all........'))))
console.log('merge →', JSON.stringify(mergeAudioTags({ title: 'A' }, { title: 'B', author: 'C' })))
