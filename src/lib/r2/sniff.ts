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

/**
 * PNG dimensions live at a fixed offset in the mandatory first IHDR chunk.
 * JPEG/WebP dimension extraction is not implemented in this window (tracked
 * gap — AC-52's full crop/undersize proof is owned by MRQ-16).
 */
export function readPngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (!startsWith(bytes, PNG_SIGNATURE) || bytes.length < 24) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16, false);
  const height = view.getUint32(20, false);
  if (width <= 0 || height <= 0) return null;
  return { width, height };
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
