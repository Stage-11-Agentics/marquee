import { describe, expect, test } from "vitest";

import { crc32, createZipStoreStream } from "../../src/lib/zip-store";

const encoder = new TextEncoder();

function body(text: string): ReadableStream<Uint8Array> {
  const bytes = encoder.encode(text);
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

async function bytesOf(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function u16(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

function u32(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16) | (bytes[offset + 3]! << 24)) >>> 0;
}

function signatures(bytes: Uint8Array, signature: number): number[] {
  const result: number[] = [];
  for (let offset = 0; offset <= bytes.length - 4; offset += 1) {
    if (u32(bytes, offset) === signature) result.push(offset);
  }
  return result;
}

describe("ZIP STORE streaming", () => {
  test("writes a valid descriptor-backed STORE archive and manifest", async () => {
    const archive = await bytesOf(createZipStoreStream([
      { path: "Thu-1400-Room/Priya/slides.pdf", body: body("slide bytes") },
    ], { missing: ["Thu-1400-Room/Priya · Upload Final Headshot"] }));

    const locals = signatures(archive, 0x04034b50);
    expect(locals).toHaveLength(2);
    expect(locals.every((offset) => u16(archive, offset + 8) === 0)).toBe(true);
    expect(locals.every((offset) => (u16(archive, offset + 6) & 0x0008) !== 0)).toBe(true);
    expect(signatures(archive, 0x08074b50)).toHaveLength(2);
    expect(signatures(archive, 0x02014b50)).toHaveLength(2);
    expect(new TextDecoder().decode(archive)).toContain("manifest.txt");
    expect(new TextDecoder().decode(archive)).toContain("Upload Final Headshot");
  });

  test("continues CRC state across streamed chunks", () => {
    const first = encoder.encode("first ");
    const second = encoder.encode("second");
    expect(crc32(second, crc32(first))).toBe(crc32(encoder.encode("first second")));
  });

  test("normalizes traversal and duplicate paths", async () => {
    const archive = await bytesOf(createZipStoreStream([
      { path: "../speaker/../slides.pdf", body: body("one") },
      { path: "speaker/slides.pdf", body: body("two") },
    ], { missing: [] }));
    const decoded = new TextDecoder().decode(archive);
    expect(decoded).toContain("speaker/slides.pdf");
    expect(decoded).toContain("slides (2).pdf");
    expect(decoded).not.toContain("../");
  });
});
