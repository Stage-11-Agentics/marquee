/**
 * A deliberately small ZIP writer for already-compressed conference media.
 *
 * STORE keeps Worker CPU predictable. Data descriptors let us write each R2
 * body as it arrives, without buffering it just to calculate its CRC first.
 * The central directory is retained in memory; it contains metadata only.
 */

const LOCAL_FILE_SIGNATURE = 0x04034b50;
const DATA_DESCRIPTOR_SIGNATURE = 0x08074b50;
const CENTRAL_FILE_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const DATA_DESCRIPTOR_FLAG = 0x0008;
const UINT16_MAX = 0xffff;
const UINT32_MAX = 0xffffffff;
const MAX_ENTRIES = UINT16_MAX;
const MAX_PATH_BYTES = UINT16_MAX;

export interface ZipStoreEntry {
  path: string;
  body: ReadableStream<Uint8Array>;
}

export interface ZipStoreManifest {
  /** A human-readable line describing a selected deliverable with no bytes. */
  missing: readonly string[];
}

interface CentralDirectoryEntry {
  path: Uint8Array;
  crc: number;
  size: number;
  offset: number;
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array, previous = 0): number {
  let value = (previous ^ UINT32_MAX) >>> 0;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 0xff]! ^ (value >>> 8);
  return (value ^ UINT32_MAX) >>> 0;
}

function u16(value: number): Uint8Array {
  if (!Number.isInteger(value) || value < 0 || value > UINT16_MAX) throw new RangeError("ZIP uint16 overflow");
  return Uint8Array.of(value & 0xff, (value >>> 8) & 0xff);
}

function u32(value: number): Uint8Array {
  if (!Number.isInteger(value) || value < 0 || value > UINT32_MAX) throw new RangeError("ZIP uint32 overflow");
  return Uint8Array.of(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
}

function concat(...chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function utf8Path(value: string): Uint8Array {
  const cleaned = value
    .replaceAll("\\", "/")
    .split("/")
    .filter((part) => part !== "" && part !== "." && part !== "..")
    .map((part) => part.replace(/[\u0000-\u001f\u007f]/g, "_").trim() || "_")
    .join("/");
  if (!cleaned) throw new Error("ZIP entry path is empty");
  const bytes = new TextEncoder().encode(cleaned.slice(0, 1024));
  if (bytes.byteLength > MAX_PATH_BYTES) throw new Error("ZIP entry path is too long");
  return bytes;
}

function manifestBody(manifest: ZipStoreManifest): ReadableStream<Uint8Array> {
  const lines = manifest.missing.length > 0
    ? ["Missing deliverables", "", ...manifest.missing]
    : ["No missing deliverables."];
  const bytes = new TextEncoder().encode(lines.map((line) => line.replace(/[\r\n]/g, " ")).join("\n") + "\n");
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

function uniquePath(path: Uint8Array, used: Set<string>): Uint8Array {
  const decoder = new TextDecoder();
  const original = decoder.decode(path);
  if (!used.has(original)) {
    used.add(original);
    return path;
  }
  const slash = original.lastIndexOf("/");
  const directory = slash === -1 ? "" : original.slice(0, slash + 1);
  const filename = slash === -1 ? original : original.slice(slash + 1);
  const extension = filename.lastIndexOf(".");
  const stem = extension > 0 ? filename.slice(0, extension) : filename;
  const suffix = extension > 0 ? filename.slice(extension) : "";
  for (let attempt = 2; ; attempt += 1) {
    const candidate = `${directory}${stem} (${attempt})${suffix}`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return utf8Path(candidate);
    }
  }
}

function localHeader(path: Uint8Array): Uint8Array {
  return concat(
    u32(LOCAL_FILE_SIGNATURE), u16(20), u16(DATA_DESCRIPTOR_FLAG), u16(0),
    u16(0), u16(0), u32(0), u32(0), u32(0), u16(path.byteLength), u16(0), path,
  );
}

function dataDescriptor(crc: number, size: number): Uint8Array {
  return concat(u32(DATA_DESCRIPTOR_SIGNATURE), u32(crc), u32(size), u32(size));
}

function centralHeader(entry: CentralDirectoryEntry): Uint8Array {
  return concat(
    u32(CENTRAL_FILE_SIGNATURE), u16(20), u16(20), u16(DATA_DESCRIPTOR_FLAG), u16(0),
    u16(0), u16(0), u32(entry.crc), u32(entry.size), u32(entry.size),
    u16(entry.path.byteLength), u16(0), u16(0), u16(0), u16(0), u32(0), u32(entry.offset), entry.path,
  );
}

function endOfCentralDirectory(count: number, size: number, offset: number): Uint8Array {
  return concat(u32(END_OF_CENTRAL_DIRECTORY_SIGNATURE), u16(0), u16(0), u16(count), u16(count), u32(size), u32(offset), u16(0));
}

/**
 * Write a complete ZIP stream. The returned promise closes the writer only
 * after the central directory has been emitted; callers can return the
 * TransformStream readable immediately and let backpressure flow through the
 * writer.
 */
export async function writeZipStore(
  writer: WritableStreamDefaultWriter<Uint8Array>,
  entries: AsyncIterable<ZipStoreEntry> | Iterable<ZipStoreEntry>,
  manifest: ZipStoreManifest,
): Promise<void> {
  const central: CentralDirectoryEntry[] = [];
  const usedPaths = new Set<string>();
  let offset = 0;
  let count = 0;

  const write = async (chunk: Uint8Array): Promise<void> => {
    await writer.write(chunk);
    offset += chunk.byteLength;
    if (offset > UINT32_MAX) throw new Error("ZIP archive is too large");
  };

  const writeEntry = async (entry: ZipStoreEntry): Promise<void> => {
    if (count >= MAX_ENTRIES) throw new Error("ZIP has too many entries");
    const path = uniquePath(utf8Path(entry.path), usedPaths);
    const entryOffset = offset;
    await write(localHeader(path));
    const reader = entry.body.getReader();
    let crc = 0;
    let size = 0;
    try {
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        const chunk = result.value;
        if (chunk.byteLength === 0) continue;
        size += chunk.byteLength;
        if (size > UINT32_MAX) throw new Error("ZIP entry is too large");
        crc = crc32(chunk, crc);
        await write(chunk);
      }
    } finally {
      reader.releaseLock();
    }
    await write(dataDescriptor(crc, size));
    central.push({ path, crc, size, offset: entryOffset });
    count += 1;
  };

  for await (const entry of entries) await writeEntry(entry);
  await writeEntry({ path: "manifest.txt", body: manifestBody(manifest) });

  const centralOffset = offset;
  for (const entry of central) await write(centralHeader(entry));
  const centralSize = offset - centralOffset;
  await write(endOfCentralDirectory(central.length, centralSize, centralOffset));
  await writer.close();
}

export function createZipStoreStream(
  entries: AsyncIterable<ZipStoreEntry> | Iterable<ZipStoreEntry>,
  manifest: ZipStoreManifest,
): ReadableStream<Uint8Array> {
  const transform = new TransformStream<Uint8Array, Uint8Array>();
  const writer = transform.writable.getWriter();
  void writeZipStore(writer, entries, manifest).catch((error: unknown) => {
    void writer.abort(error);
  });
  return transform.readable;
}
