/**
 * ID3 tag reader for audiobooks.
 *
 * Audiobook dumps carry the real title/author/cover in ID3v2, while the file
 * name is a transliterated slug ("Nil_donald_uolsh_razgovor_s_bogom…"). Without
 * reading the tags the library shows the slug and no cover even though the file
 * has both.
 *
 * Only the frames the reader needs are decoded: TIT2 (track title),
 * TPE1 (artist), TALB (album) and APIC (picture).
 */

export interface AudioTags {
  title?: string
  author?: string
  album?: string
  /** data: URL of the front cover, when the file has one */
  cover?: string
}

/** Covers larger than this are ignored — they would bloat IndexedDB. */
const MAX_COVER_BYTES = 4 * 1024 * 1024

const ID3V2_MAGIC = [0x49, 0x44, 0x33] // "ID3"

/** Frames of ID3v2.2 are three characters and predate the v2.3 names. */
const LEGACY_FRAME_IDS: Record<string, string> = {
  TT2: 'TIT2',
  TP1: 'TPE1',
  TAL: 'TALB',
  PIC: 'APIC',
}

/**
 * A synchsafe integer stores 7 bits per byte, most significant bit first.
 * Used for the tag size and, in ID3v2.4, for frame sizes.
 */
function synchsafeInt(view: DataView, offset: number): number {
  const raw = view.getUint32(offset, false)
  return (
    (raw & 0x7f) | (((raw >>> 8) & 0x7f) << 7) | (((raw >>> 16) & 0x7f) << 14) | (((raw >>> 24) & 0x7f) << 21)
  )
}

/** Text encoding byte inside an ID3 frame: 0 latin1, 1 utf-16 w/ BOM, 2 utf-16be, 3 utf-8. */
function decodeFrameText(encoding: number, bytes: Uint8Array): string {
  const label =
    encoding === 1 ? 'utf-16' : encoding === 2 ? 'utf-16be' : encoding === 3 ? 'utf-8' : 'iso-8859-1'
  let text: string
  try {
    text = new TextDecoder(label).decode(bytes)
  } catch {
    text = new TextDecoder('utf-8').decode(bytes)
  }
  // Frames may hold several null-separated values
  return text
    .split('\u0000')
    .map((s) => s.trim())
    .filter(Boolean)
    .join('; ')
}

function decodeLatin1(bytes: Uint8Array): string {
  return new TextDecoder('iso-8859-1').decode(bytes)
}

function base64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

/**
 * Undo the ID3 unsynchronisation scheme (0xFF 0x00 → 0xFF) over the tag body.
 * Enabled by header flag 0x80; leaving it in place corrupts picture bytes and
 * can make a frame size look valid while its content is not.
 */
function desynchronise(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length)
  let n = 0
  for (let i = 0; i < bytes.length; i++) {
    out[n++] = bytes[i]
    if (bytes[i] === 0xff && bytes[i + 1] === 0x00) i++
  }
  return out.subarray(0, n)
}

/**
 * Parse an ID3v2 tag from the beginning of an audio file.
 * `bytes` may be a head slice — a truncated tag then yields whatever frames
 * were fully contained in it.
 */
export function parseId3v2(bytes: Uint8Array): AudioTags {
  const out: AudioTags = {}
  if (bytes.length < 10) return out
  const head = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (
    bytes[0] !== ID3V2_MAGIC[0] ||
    bytes[1] !== ID3V2_MAGIC[1] ||
    bytes[2] !== ID3V2_MAGIC[2]
  ) {
    return out
  }

  const version = bytes[3]
  if (version < 2 || version > 4) return out
  const flags = bytes[5]
  const tagSize = synchsafeInt(head, 6)
  if (tagSize <= 0) return out

  let body = bytes.subarray(10, Math.min(10 + tagSize, bytes.length))
  if (flags & 0x80) body = desynchronise(body)
  const bodyView = new DataView(body.buffer, body.byteOffset, body.byteLength)

  const idLength = version === 2 ? 3 : 4
  const headerLength = version === 2 ? 6 : 10
  let p = 0

  // Extended header, when present, sits before the first frame
  if (version === 3 && (flags & 0x40) !== 0 && body.length >= 4) {
    p += 4 + bodyView.getUint32(0, false)
  } else if (version === 4 && (flags & 0x40) !== 0 && body.length >= 4) {
    p += synchsafeInt(bodyView, 0)
  }

  let coverType = -1

  while (p + headerLength <= body.length) {
    const rawId = decodeLatin1(body.subarray(p, p + idLength))
    // Padding (zero bytes) marks the end of the frame list
    if (!/^[A-Z0-9]{3,4}$/.test(rawId)) break
    const id = LEGACY_FRAME_IDS[rawId] ?? rawId

    let size: number
    if (version === 4) size = synchsafeInt(bodyView, p + 4)
    else if (version === 3) size = bodyView.getUint32(p + 4, false)
    else size = (body[p + 3] << 16) | (body[p + 4] << 8) | body[p + 5]

    const bodyStart = p + headerLength
    if (size <= 0 || bodyStart + size > body.length) break
    const frame = body.subarray(bodyStart, bodyStart + size)
    p = bodyStart + size

    if (id.startsWith('T') && id !== 'TCON') {
      const text = decodeFrameText(frame[0], frame.subarray(1))
      if (!text) continue
      if (id === 'TIT2') out.title = out.title || text
      else if (id === 'TPE1') out.author = out.author || text
      else if (id === 'TALB') out.album = out.album || text
    } else if (id === 'APIC') {
      const picture = parseApic(frame, version === 2)
      // 3 = front cover; otherwise keep the first picture we find
      if (picture && (coverType === -1 || (picture.type === 3 && coverType !== 3))) {
        coverType = picture.type
        out.cover = `data:${picture.mime};base64,${base64(picture.data)}`
      }
    }
  }

  if (out.cover && bytes.byteLength === 0) delete out.cover
  return out
}

function parseApic(
  frame: Uint8Array,
  legacy: boolean,
): { type: number; mime: string; data: Uint8Array } | null {
  if (frame.length < 4) return null
  const encoding = frame[0]
  let p = 1
  let mime: string

  if (legacy) {
    // v2.2 stores a three letter image format instead of a MIME type
    const format = decodeLatin1(frame.subarray(1, 4)).toUpperCase()
    mime = format === 'PNG' ? 'image/png' : 'image/jpeg'
    p = 4
  } else {
    const end = frame.indexOf(0x00, 1)
    if (end === -1) return null
    mime = decodeLatin1(frame.subarray(1, end)).trim().toLowerCase() || 'image/jpeg'
    if (!mime.startsWith('image/')) mime = mime === 'jpg' ? 'image/jpeg' : `image/${mime}`
    p = end + 1
  }

  const type = frame[p]
  p += 1

  // Description: null terminated, in the frame's text encoding
  if (encoding === 1 || encoding === 2) {
    while (p + 1 < frame.length) {
      if (frame[p] === 0 && frame[p + 1] === 0) {
        p += 2
        break
      }
      p += 2
    }
  } else {
    while (p < frame.length && frame[p] !== 0x00) p++
    p += 1
  }

  const data = frame.subarray(p)
  if (data.length < 64 || data.length > MAX_COVER_BYTES) return null
  return { type, mime, data }
}

/**
 * Parse a trailing ID3v1 tag (the last 128 bytes of a file).
 * Older rips have nothing but this. Values are cp1251 for Russian releases,
 * which is what the spec's ISO-8859-1 field is really filled with there.
 */
export function parseId3v1(tail: Uint8Array): AudioTags {
  const out: AudioTags = {}
  if (tail.length < 128) return out
  const start = tail.length - 128
  if (decodeLatin1(tail.subarray(start, start + 3)) !== 'TAG') return out

  const decode = new TextDecoder('windows-1251')
  const field = (offset: number, length: number) =>
    decode
      .decode(tail.subarray(start + offset, start + offset + length))
      .replace(/[\u0000\r\n	]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()

  // v1.1 stores the track number in the last two bytes of the comment field
  const title = field(3, 30)
  const artist = field(33, 30)
  const album = field(63, 30)
  if (title) out.title = title
  if (artist) out.author = artist
  if (album) out.album = album
  return out
}

/** Fill the gaps of `primary` with values from `secondary`. */
export function mergeAudioTags(primary: AudioTags, secondary: AudioTags): AudioTags {
  return {
    title: primary.title || secondary.title,
    author: primary.author || secondary.author,
    album: primary.album || secondary.album,
    cover: primary.cover || secondary.cover,
  }
}

export function hasAudioTags(tags: AudioTags): boolean {
  return Boolean(tags.title || tags.author || tags.cover)
}
