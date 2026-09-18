import { describe, it, expect } from 'vitest'
import { scanFb2Meta, extractFb2Binary } from './fb2-scan'

const base64Cover = btoa('A'.repeat(100))

function fb2Doc(body: string, description: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0">
 <description>
  <title-info>
   <author><first-name>Лев</first-name><middle-name>Николаевич</middle-name><last-name>Толстой</last-name></author>
   <book-title>${body}</book-title>
   <annotation><p>Роман &laquo;о войне&raquo; и мире.</p></annotation>
   <coverpage><image l:href="#cover.jpg"/></coverpage>
  </title-info>
 </description>
 <binary id="cover.jpg" content-type="image/jpeg">${base64Cover}</binary>
</FictionBook>`
}

describe('scanFb2Meta', () => {
  it('extracts title, author, annotation and cover from well-formed text', () => {
    const meta = scanFb2Meta(fb2Doc('Война и мир', 'ok'))
    expect(meta.title).toBe('Война и мир')
    // last-name first, per Russian bibliographic convention
    expect(meta.author).toBe('Толстой Лев Николаевич')
    expect(meta.description).toContain('о войне')
    expect(meta.description).toContain('\u00ab') // &laquo; decoded
    expect(meta.cover).toBe(`data:image/jpeg;base64,${base64Cover}`)
  })

  it('works when the XML is malformed (bare ampersand, stray close tag)', () => {
    const broken = fb2Doc('Война & мир', 'ok')
      .replace('</annotation>', '</bad></annotation>')
    const meta = scanFb2Meta(broken)
    expect(meta.title).toBe('Война & мир')
    expect(meta.author).toBe('Толстой Лев Николаевич')
    expect(meta.cover).toBe(`data:image/jpeg;base64,${base64Cover}`)
  })

  it('decodes numeric and named entities in the title', () => {
    const meta = scanFb2Meta('<book-title>Том&#160;II &amp; том III</book-title>')
    expect(meta.title).toBe('Том\u00a0II & том III')
  })

  it('returns empty for text without metadata', () => {
    expect(scanFb2Meta('<FictionBook><body/></FictionBook>')).toEqual({})
    expect(scanFb2Meta('')).toEqual({})
  })

  it('does not swallow the document on an unterminated tag', () => {
    const meta = scanFb2Meta('<book-title>Обрезано ' + 'x'.repeat(100000))
    expect(meta).toEqual({})
  })

  it('skips CDATA wrappers', () => {
    const meta = scanFb2Meta('<book-title><![CDATA[Чистый <b>заголовок</b>]]></book-title>')
    expect(meta.title).toBe('Чистый заголовок')
  })
})

describe('extractFb2Binary', () => {
  const text = `<binary id="first">not-the-one</binary>
<binary id="cover.jpg" content-type="image/png">AAAA</binary>`

  it('finds the binary by id and uses its content type', () => {
    expect(extractFb2Binary(text, 'cover.jpg')).toBe('data:image/png;base64,AAAA')
  })

  it('defaults to image/jpeg without a content type', () => {
    expect(extractFb2Binary('<binary id="x">AAAA</binary>', 'x')).toBe(
      'data:image/jpeg;base64,AAAA',
    )
  })

  it('returns undefined for an unknown id or too-short payload', () => {
    expect(extractFb2Binary(text, 'missing')).toBeUndefined()
    expect(extractFb2Binary('<binary id="tiny">AAA</binary>', 'tiny')).toBeUndefined()
  })
})
