/**
 * Minimal ZIP extraction utilities.
 * Reuses the same DecompressionStream-based approach across book-parser
 * and any future ZIP-handling code.
 *
 * Entries are located through the central directory — the record at the end of
 * the archive that holds the authoritative compressed sizes and local header
 * offsets. Walking local file headers is not reliable: many packers store
 * zeros plus a data descriptor in the local header, so sizes then have to be
 * recovered by scanning, and the descriptor signature also occurs inside
 * deflate streams. That yields garbage sizes and silently drops most of the
 * archive — container.xml included, which turns a perfectly valid EPUB into
 * "Без названия" without a cover.
 */

interface ZipEntry {
  [path: string]: Uint8Array
}

export interface UnzippedFile {
  name: string
  data: Uint8Array
}

/**
 * Safety caps applied to every entry.
 */
export const MAX_ENTRIES = 10_000
export const MAX_ENTRY_SIZE = 64 * 1024 * 1024 // 64 MB per entry

const LOCAL_SIG = 0x04034b50 // "PK\x03\x04"
const DESCRIPTOR_SIG = 0x08074b50 // "PK\x07\x08"
const CD_SIG = 0x02014b50 // "PK\x01\x02"
const EOCD_SIG = 0x06054b50 // "PK\x05\x06"
const EOCD64_LOCATOR_SIG = 0x07064b50 // "PK\x06\x07"
const EOCD64_SIG = 0x06064b50 // "PK\x06\x06"
const ZIP64_EXTRA_ID = 0x0001

const FLAG_DATA_DESCRIPTOR = 0x08
const FLAG_UTF8_NAME = 0x800
const MAX_COMMENT_SIZE = 0xffff
const UINT32_MAX = 0xffffffff

interface CentralEntry {
  name: string
  method: number
  compressedSize: number
  uncompressedSize: number
  localOffset: number
}

/**
 * Read all entries from a ZIP ArrayBuffer.
 * Handles stored (0) and deflated (8) compression methods.
 * Returns an empty map on failure — the caller can decide how to handle it.
 */
export async function unzip(buffer: ArrayBuffer): Promise<ZipEntry> {
  const view = new DataView(buffer)
  const central = readCentralDirectory(view, buffer.byteLength)
  if (central) return extractEntries(view, buffer, central)
  // No central directory — a truncated download or an archive that was never
  // closed properly. Recover whatever local headers are still readable.
  return unzipLocalHeaders(view, buffer)
}

/**
 * Locate the end-of-central-directory record. Scanned backwards from the tail,
 * and a candidate is accepted only when its comment length accounts for exactly
 * the remaining bytes, so a matching byte sequence inside the data cannot be
 * mistaken for the record.
 */
function findEocd(view: DataView, byteLength: number): number | null {
  const last = byteLength - 22
  if (last < 0) return null
  const first = Math.max(0, last - MAX_COMMENT_SIZE)
  for (let i = last; i >= first; i--) {
    if (view.getUint32(i, true) !== EOCD_SIG) continue
    if (i + 22 + view.getUint16(i + 20, true) === byteLength) return i
  }
  return null
}

/**
 * Read the entry count and central directory offset, upgrading them from the
 * ZIP64 records when the archive has more than 65535 entries or is over 4 GiB.
 */
function readCdInfo(
  view: DataView,
  byteLength: number,
  eocdOffset: number,
): { totalEntries: number; cdOffset: number } {
  let totalEntries = view.getUint16(eocdOffset + 10, true)
  let cdOffset = view.getUint32(eocdOffset + 16, true)

  const locator = eocdOffset - 20
  if (locator >= 0 && view.getUint32(locator, true) === EOCD64_LOCATOR_SIG) {
    const eocd64 = Number(view.getBigUint64(locator + 8, true))
    if (eocd64 + 56 <= byteLength && view.getUint32(eocd64, true) === EOCD64_SIG) {
      totalEntries = Number(view.getBigUint64(eocd64 + 32, true))
      cdOffset = Number(view.getBigUint64(eocd64 + 48, true))
    }
  }
  return { totalEntries, cdOffset }
}

/**
 * Walk the central directory and return one descriptor per entry.
 * Returns null when the archive has no usable central directory.
 */
function readCentralDirectory(view: DataView, byteLength: number): CentralEntry[] | null {
  const eocdOffset = findEocd(view, byteLength)
  if (eocdOffset === null) return null

  const { totalEntries, cdOffset } = readCdInfo(view, byteLength, eocdOffset)
  if (cdOffset + 46 > byteLength) return null

  const entries: CentralEntry[] = []
  let off = cdOffset

  while (entries.length < totalEntries && entries.length < MAX_ENTRIES) {
    if (off + 46 > byteLength || view.getUint32(off, true) !== CD_SIG) break

    const flags = view.getUint16(off + 8, true)
    const method = view.getUint16(off + 10, true)
    let compressedSize = view.getUint32(off + 20, true)
    let uncompressedSize = view.getUint32(off + 24, true)
    const nameLen = view.getUint16(off + 28, true)
    const extraLen = view.getUint16(off + 30, true)
    const commentLen = view.getUint16(off + 32, true)
    let localOffset = view.getUint32(off + 42, true)

    const nameStart = off + 46
    const extraStart = nameStart + nameLen
    const next = extraStart + extraLen + commentLen
    if (nameLen > 0xffff || extraLen > 0xffff || next > byteLength) break

    if (
      uncompressedSize === UINT32_MAX ||
      compressedSize === UINT32_MAX ||
      localOffset === UINT32_MAX
    ) {
      const zip64 = readZip64Extra(
        new Uint8Array(view.buffer, view.byteOffset + extraStart, extraLen),
        {
          uncompressed: uncompressedSize === UINT32_MAX,
          compressed: compressedSize === UINT32_MAX,
          offset: localOffset === UINT32_MAX,
        },
      )
      if (zip64.uncompressed !== undefined) uncompressedSize = zip64.uncompressed
      if (zip64.compressed !== undefined) compressedSize = zip64.compressed
      if (zip64.offset !== undefined) localOffset = zip64.offset
    }

    entries.push({
      name: decodeName(new Uint8Array(view.buffer, view.byteOffset + nameStart, nameLen), flags),
      method,
      compressedSize,
      uncompressedSize,
      localOffset,
    })
    off = next
  }

  return entries
}

/**
 * Pull the real sizes/offset out of a ZIP64 extended information extra field.
 * Values are stored in a fixed order and only for the fields that were
 * truncated to 0xffffffff in the central directory record.
 */
function readZip64Extra(
  extra: Uint8Array,
  need: { uncompressed: boolean; compressed: boolean; offset: boolean },
): { uncompressed?: number; compressed?: number; offset?: number } {
  const out: { uncompressed?: number; compressed?: number; offset?: number } = {}
  const view = new DataView(extra.buffer, extra.byteOffset, extra.byteLength)
  let p = 0

  while (p + 4 <= extra.byteLength) {
    const id = view.getUint16(p, true)
    const size = view.getUint16(p + 2, true)
    const body = p + 4
    if (body + size > extra.byteLength) break

    if (id === ZIP64_EXTRA_ID) {
      let q = body
      const room = (n: number) => q + n <= body + size
      if (need.uncompressed && room(8)) {
        out.uncompressed = Number(view.getBigUint64(q, true))
        q += 8
      }
      if (need.compressed && room(8)) {
        out.compressed = Number(view.getBigUint64(q, true))
        q += 8
      }
      if (need.offset && room(8)) {
        out.offset = Number(view.getBigUint64(q, true))
      }
      break
    }
    p = body + size
  }
  return out
}

/**
 * Decode an entry name. UTF-8 is explicit via the language encoding flag;
 * otherwise the bytes are OEM/ANSI, so strict UTF-8 is tried first and
 * windows-1251 (the same fallback as lib/text-encoding.ts) covers Russian
 * archives that are not valid UTF-8.
 */
function decodeName(bytes: Uint8Array, flags: number): string {
  if (flags & FLAG_UTF8_NAME) return new TextDecoder('utf-8').decode(bytes)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    try {
      return new TextDecoder('windows-1251').decode(bytes)
    } catch {
      return new TextDecoder('utf-8').decode(bytes)
    }
  }
}

async function inflateRaw(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const blob = new Blob([data])
  const ds = new DecompressionStream('deflate-raw')
  const stream = blob.stream().pipeThrough(ds)
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/**
 * Read entry payloads addressed by the central directory.
 * A single corrupt entry is skipped rather than aborting the whole archive.
 */
async function extractEntries(
  view: DataView,
  buffer: ArrayBuffer,
  central: CentralEntry[],
): Promise<ZipEntry> {
  const entries: ZipEntry = {}
  let count = 0

  for (const entry of central) {
    if (count >= MAX_ENTRIES) break
    if (entry.compressedSize > MAX_ENTRY_SIZE || entry.uncompressedSize > MAX_ENTRY_SIZE) continue
    if (entry.method !== 0 && entry.method !== 8) continue

    // The local header repeats the name and extra fields, and their lengths are
    // allowed to differ from the central directory, so the data start has to be
    // taken from the local header itself.
    const local = entry.localOffset
    if (local + 30 > buffer.byteLength || view.getUint32(local, true) !== LOCAL_SIG) continue
    const dataStart =
      local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true)
    if (dataStart + entry.compressedSize > buffer.byteLength) continue

    const raw = new Uint8Array(buffer, dataStart, entry.compressedSize)
    try {
      entries[entry.name] = entry.method === 0 ? raw : await inflateRaw(raw)
      count++
    } catch {
      // A corrupt entry must not abort the whole archive
    }
  }

  return entries
}

/**
 * Fallback for archives without a central directory (interrupted download).
 * Sizes come from the local headers; when an entry was streamed and its size is
 * unknown, the next local header marks the end of its data, and the data
 * descriptor sitting right before that header gives the exact size.
 */
async function unzipLocalHeaders(view: DataView, buffer: ArrayBuffer): Promise<ZipEntry> {
  const entries: ZipEntry = {}
  let offset = 0
  let count = 0

  while (offset + 30 <= buffer.byteLength && count < MAX_ENTRIES) {
    if (view.getUint32(offset, true) !== LOCAL_SIG) break

    const flags = view.getUint16(offset + 6, true)
    const method = view.getUint16(offset + 8, true)
    let compressedSize = view.getUint32(offset + 18, true)
    const nameLen = view.getUint16(offset + 26, true)
    const extraLen = view.getUint16(offset + 28, true)
    if (nameLen > 0xffff || extraLen > 0xffff) break

    const dataStart = offset + 30 + nameLen + extraLen
    if (dataStart > buffer.byteLength) break
    const name = decodeName(new Uint8Array(buffer, offset + 30, nameLen), flags)

    let next = dataStart + compressedSize
    if (compressedSize === 0 && (flags & FLAG_DATA_DESCRIPTOR) !== 0) {
      // Streamed entry: its data runs up to the next local header (or to the
      // end of the archive for the last entry), optionally followed by a
      // 16-byte data descriptor. Deriving the size from that distance is
      // self-consistent, whereas trusting the descriptor alone can pick up a
      // PK\x07\x08 byte sequence inside the deflate stream.
      const end = findStreamedEnd(view, dataStart)
      next = end.next
      compressedSize = end.size
    }
    // A size that points past the end means the archive is truncated — nothing
    // after such an entry is readable.
    if (dataStart + compressedSize > buffer.byteLength || next > buffer.byteLength) break
    offset = next

    if (compressedSize > MAX_ENTRY_SIZE) continue
    if (method !== 0 && method !== 8) continue

    const raw = new Uint8Array(buffer, dataStart, compressedSize)
    try {
      entries[name] = method === 0 ? raw : await inflateRaw(raw)
      count++
    } catch {
      // A corrupt entry must not abort the whole archive
    }
  }

  return entries
}

/**
 * End of a streamed entry's data: where the walk continues, plus the entry size.
 * The data is delimited by the next local header, or by the end of the archive
 * for the last entry; a data descriptor may sit right before that delimiter.
 */
function findStreamedEnd(view: DataView, dataStart: number): { next: number; size: number } {
  const byteLength = view.byteLength
  let end = -1
  for (let i = dataStart; i < byteLength - 4; i++) {
    if (view.getUint32(i, true) === LOCAL_SIG) {
      end = i
      break
    }
  }
  if (end === -1) end = byteLength

  const descriptor = end - 16
  const hasDescriptor = descriptor >= dataStart && view.getUint32(descriptor, true) === DESCRIPTOR_SIG
  return { next: end, size: (hasDescriptor ? descriptor : end) - dataStart }
}

/**
 * Read the first bytes of the first entry matching `filter`, without
 * decompressing the rest of the archive.
 *
 * Used for audiobook archives: the ID3 tag of the first track sits at the
 * beginning of that one entry, and inflating a hundred megabytes of audio to
 * read a few kilobytes of tags is not worth it.
 */
export async function readFirstEntryHead(
  buffer: ArrayBuffer,
  filter: (name: string) => boolean,
  maxBytes: number,
): Promise<{ name: string; data: Uint8Array; matches: number } | null> {
  const view = new DataView(buffer)
  const central = readCentralDirectory(view, buffer.byteLength)
  if (!central) return null

  const candidates = central
    .filter(
      (entry) => !entry.name.endsWith('/') && (entry.method === 0 || entry.method === 8) && filter(entry.name),
    )
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
  const matches = candidates.length

  for (const entry of candidates) {
    if (entry.compressedSize > MAX_ENTRY_SIZE) continue
    const local = entry.localOffset
    if (local + 30 > buffer.byteLength || view.getUint32(local, true) !== LOCAL_SIG) continue
    const dataStart =
      local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true)
    if (dataStart >= buffer.byteLength) continue
    const available = Math.min(entry.compressedSize, buffer.byteLength - dataStart)

    try {
      if (entry.method === 0) {
        return {
          name: entry.name,
          data: new Uint8Array(buffer, dataStart, Math.min(available, maxBytes)),
          matches,
        }
      }
      const data = await inflateRawHead(new Uint8Array(buffer, dataStart, available), maxBytes)
      if (data.byteLength > 0) return { name: entry.name, data, matches }
    } catch {
      // Try the next matching entry
    }
  }
  return null
}

/**
 * Decompress only the first `maxBytes` of a deflate stream.
 * Input is fed in the background: awaiting every chunk would deadlock once the
 * output queue fills, because draining it requires the read below.
 */
async function inflateRawHead(data: Uint8Array<ArrayBuffer>, maxBytes: number): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate-raw')
  const writer = ds.writable.getWriter()
  const reader = ds.readable.getReader()

  const feeding = (async () => {
    const step = 1024 * 1024
    for (let p = 0; p < data.byteLength; p += step) {
      await writer.write(data.subarray(p, Math.min(data.byteLength, p + step)))
    }
    await writer.close()
  })().catch(() => undefined)

  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read()
      if (done || !value) break
      chunks.push(value)
      total += value.byteLength
    }
  } catch {
    // Truncated or corrupt stream — return what was decompressed so far
  }
  if (total >= maxBytes) await reader.cancel().catch(() => undefined)
  await feeding

  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out.subarray(0, Math.min(total, maxBytes))
}

/**
 * Extract files matching a filter predicate from a ZIP ArrayBuffer.
 * Returns files sorted by name.
 */
export async function unzipFiles(
  buffer: ArrayBuffer,
  filter: (name: string) => boolean,
): Promise<UnzippedFile[]> {
  const entries = await unzip(buffer)
  const result: UnzippedFile[] = []
  for (const [name, data] of Object.entries(entries)) {
    if (filter(name)) {
      result.push({ name, data })
    }
  }
  result.sort((a, b) => a.name.localeCompare(b.name))
  return result
}
