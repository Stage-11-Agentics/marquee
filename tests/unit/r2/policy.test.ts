import { expect, test } from "vitest";

import { extensionOf, policyFor, sanitizeFilename, validateDeclared } from "../../../src/lib/r2/policy";
import { classify, readPngDimensions } from "../../../src/lib/r2/sniff";

test("AC-232 · extension and MIME are rejected independently at sign time", () => {
  const policy = policyFor("draft_file")!;
  expect(validateDeclared(policy, { filename: "deck.exe", contentType: "application/pdf", sizeBytes: 10 })).toEqual({
    ok: false,
    violation: "extension",
  });
  expect(
    validateDeclared(policy, { filename: "deck.pdf", contentType: "application/octet-stream", sizeBytes: 10 }),
  ).toEqual({ ok: false, violation: "mime" });
});

test("AC-232 · declared size is bounded by owner policy and absolute ceiling", () => {
  const policy = policyFor("draft_file")!;
  expect(validateDeclared(policy, { filename: "deck.pdf", contentType: "application/pdf", sizeBytes: 0 })).toEqual({
    ok: false,
    violation: "empty",
  });
  expect(
    validateDeclared(policy, { filename: "deck.pdf", contentType: "application/pdf", sizeBytes: policy.maxBytes + 1 }),
  ).toEqual({ ok: false, violation: "too_large" });
});

test("CONTRACT · sanitizeFilename strips traversal and unsafe characters without eating dashes", () => {
  expect(sanitizeFilename("../../etc/passwd")).toBe("passwd");
  expect(sanitizeFilename("my-cool-file.pdf")).toBe("my-cool-file.pdf");
  expect(sanitizeFilename("héllo wörld.pdf")).toBe("h_llo w_rld.pdf");
  expect(sanitizeFilename("")).toBe("upload");
});

test("CONTRACT · extensionOf ignores directory separators and dotfiles", () => {
  expect(extensionOf("dir/file.PDF")).toBe("pdf");
  expect(extensionOf(".hidden")).toBe("");
  expect(extensionOf("noext")).toBe("");
});

test("CONTRACT · no owner policy presigns import_file in this window", () => {
  expect(policyFor("import_file")).toBeNull();
});

test("AC-232 · magic-byte classification is fail-closed for adversarial and truncated samples", () => {
  expect(classify(new Uint8Array([0x00, 0x01, 0x02]))).toBeNull();
  expect(classify(new TextEncoder().encode("%PDF-1.4 fake"))).toBe("pdf");
  const pngSignature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  expect(classify(pngSignature)).toBe("png");
  // A generic ZIP without the PPTX/KEY manifest entry never classifies.
  expect(classify(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0]))).toBeNull();
});

test("AC-232 · PPTX and KEY require their exact manifest entry, not just a ZIP signature", () => {
  const zipHeader = [0x50, 0x4b, 0x03, 0x04];
  const pptxBytes = new Uint8Array([...zipHeader, ...new TextEncoder().encode("junkppt/presentation.xmlmore")]);
  expect(classify(pptxBytes)).toBe("pptx");
  const keyBytes = new Uint8Array([...zipHeader, ...new TextEncoder().encode("junkIndex.zipmore")]);
  expect(classify(keyBytes)).toBe("key");
});

test("CONTRACT · PNG dimensions read from the mandatory IHDR chunk", () => {
  // Minimal 2x1 PNG-shaped header: signature + IHDR length/type + width/height.
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, 2, false);
  view.setUint32(20, 1, false);
  expect(readPngDimensions(bytes)).toEqual({ width: 2, height: 1 });
});
