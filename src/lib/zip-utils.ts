/**
 * Minimal ZIP extraction utilities.
 * Reuses the same DecompressionStream-based approach across book-parser
 * and any future ZIP-handling code.
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

/**
 * Read all entries from a ZIP ArrayBuffer.
 * Handles stored (0) and deflated (8) compression methods.
 * Returns an empty map on failure — the caller can decide how to handle it.
 */
export async function unzip(buffer: ArrayBuffer): Promise<ZipEntry> {
  const view = new DataView(buffer)
  const entries: ZipEntry = {}
  let offset = 0
  const minHeaderSize = 30 // Minimum ZIP local file header size

  while (offset < buffer.byteLength - 4 && Object.keys(entries).length < MAX_ENTRIES) {
    const sig = view.getUint32(offset, true)
    if (sig !== 0x04034b50) break

    // Safety: skip if we can't read the minimal header
    if (offset + minHeaderSize > buffer.byteLength) break

    const flags = view.getUint16(offset + 6, true)
    const compressionMethod = view.getUint16(offset + 8, true)
    let compressedSize = view.getUint32(offset + 18, true)
    let uncompressedSize = view.getUint32(offset + 22, true)
    const filenameLen = view.getUint16(offset + 26, true)
    const extraLen = view.getUint16(offset + 28, true)

    // Safety: validate that filename + extra fit in buffer
    if (filenameLen > 65535 || extraLen > 65535) break
    const dataStart = offset + 30 + filenameLen + extraLen
    if (dataStart + compressedSize > buffer.byteLength) break

    const filename = new TextDecoder().decode(
      new Uint8Array(buffer, offset + 30, filenameLen),
    )
    const usesDataDescriptor = (flags & 0x8) !== 0

    if (usesDataDescriptor && compressedSize === 0 && uncompressedSize === 0) {
      const scanEnd = Math.min(buffer.byteLength, dataStart + MAX_ENTRY_SIZE)
      let descPos = -1
      for (let i = dataStart; i < scanEnd - 4; i++) {
        if (view.getUint32(i, true) === 0x08074b50) {
          descPos = i
          break
        }
      }
      if (descPos === -1) {
        let next = -1
        for (let i = dataStart; i < scanEnd - 4; i++) {
          if (view.getUint32(i, true) === 0x04034b50) {
            next = i
            break
          }
        }
        if (next === -1) break
        offset = next
        continue
      }
      compressedSize = view.getUint32(descPos + 4, true)
      uncompressedSize = view.getUint32(descPos + 8, true)
      offset = descPos + 16
    } else {
      offset = dataStart + compressedSize
    }

    if (compressedSize > MAX_ENTRY_SIZE || uncompressedSize > MAX_ENTRY_SIZE) continue

    try {
      if (compressionMethod === 0) {
        entries[filename] = new Uint8Array(buffer, dataStart, compressedSize)
      } else if (compressionMethod === 8) {
        const compressedData = new Uint8Array(buffer, dataStart, compressedSize)
        const blob = new Blob([compressedData])
        const ds = new DecompressionStream('deflate-raw')
        const stream = blob.stream().pipeThrough(ds)
        const decompressed = await new Response(stream).arrayBuffer()
        entries[filename] = new Uint8Array(decompressed)
      }
    } catch {
      // A corrupt entry must not abort the whole archive
    }
  }

  return entries
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
