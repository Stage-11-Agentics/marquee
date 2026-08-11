/**
 * Bounded magic-byte / container classification. Fail-closed: an unreadable,
 * truncated, or ambiguous sample never resolves to a kind. A generic ZIP
 * (`PK\x03\x04`) is not enough on its own to call something PPTX or KEY — the
 * archive must also carry the exact manifest entry each format requires.
 */

export type SniffKind = "jpeg" | "png" | "webp" | "pdf" | "pptx" | "key";

/** Bytes needed from the head of the object to classify any supported kind. */
export const SNIFF_HEAD_BYTES = 4096;

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  if (bytes.length < signature.length) return false;
  return signature.every((byte, index) => bytes[index] === byte);
}

function containsAscii(bytes: Uint8Array, needle: string): boolean {
  const target = new TextEncoder().encode(needle);
  if (target.length === 0 || bytes.length < target.length) return false;
  outer: for (let start = 0; start <= bytes.length - target.length; start += 1) {
    for (let offset = 0; offset < target.length; offset += 1) {
      if (bytes[start + offset] !== target[offset]) continue outer;
    }
    return true;
  }
  return false;
}

const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46]; // "%PDF"
const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04]; // "PK\x03\x04"

function isWebp(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  const riff = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46;
  const webp = bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  return riff && webp;
}

/** PNG dimensions live at a fixed offset in the mandatory first IHDR chunk. */
export function readPngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (!startsWith(bytes, PNG_SIGNATURE) || bytes.length < 24) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16, false);
  const height = view.getUint32(20, false);
  if (width <= 0 || height <= 0) return null;
  return { width, height };
}

function readJpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (!startsWith(bytes, JPEG_SIGNATURE)) return null;
  let offset = 2;
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) return null;
    const marker = bytes[offset++];
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (marker === 0xda) return null;
    if (marker >= 0xd0 && marker <= 0xd7) continue;
    if (offset + 1 >= bytes.length) return null;
    const length = (bytes[offset] << 8) | bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length) return null;
    const isStartOfFrame =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (isStartOfFrame && length >= 7) {
      const height = (bytes[offset + 3] << 8) | bytes[offset + 4];
      const width = (bytes[offset + 5] << 8) | bytes[offset + 6];
      return width > 0 && height > 0 ? { width, height } : null;
    }
    offset += length;
  }
  return null;
}

function readWebpDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (!isWebp(bytes) || bytes.length < 30) return null;
  const chunk = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
  if (chunk === "VP8X") {
    const width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16);
    const height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16);
    return { width, height };
  }
  if (chunk === "VP8 ") {
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null;
    const width = (bytes[26] | (bytes[27] << 8)) & 0x3fff;
    const height = (bytes[28] | (bytes[29] << 8)) & 0x3fff;
    return width > 0 && height > 0 ? { width, height } : null;
  }
  if (chunk === "VP8L" && bytes[20] === 0x2f && bytes.length >= 25) {
    const bits = bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24);
    const width = (bits & 0x3fff) + 1;
    const height = ((bits >>> 14) & 0x3fff) + 1;
    return { width, height };
  }
  return null;
}

export function readImageDimensions(
  bytes: Uint8Array,
  kind: Extract<SniffKind, "jpeg" | "png" | "webp">,
): { width: number; height: number } | null {
  if (kind === "png") return readPngDimensions(bytes);
  if (kind === "jpeg") return readJpegDimensions(bytes);
  return readWebpDimensions(bytes);
}

/**
 * Classifies a bounded head-of-object sample. Returns null (fail closed) if
 * no supported signature matches, or if a ZIP lacks the expected manifest
 * entry for the two container-based kinds this module supports.
 */
export function classify(bytes: Uint8Array): SniffKind | null {
  if (startsWith(bytes, PNG_SIGNATURE)) return "png";
  if (startsWith(bytes, JPEG_SIGNATURE)) return "jpeg";
  if (isWebp(bytes)) return "webp";
  if (startsWith(bytes, PDF_SIGNATURE)) return "pdf";
  if (startsWith(bytes, ZIP_SIGNATURE)) {
    if (containsAscii(bytes, "ppt/presentation.xml")) return "pptx";
    if (containsAscii(bytes, "Index.zip") || containsAscii(bytes, "Index/Document.iwa")) return "key";
    return null;
  }
  return null;
}

export function matchesExpectedKind(bytes: Uint8Array, expected: SniffKind): boolean {
  return classify(bytes) === expected;
}
