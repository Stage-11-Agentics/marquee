import { expect, test } from "vitest";

import { extensionOf, parseUploadOwnerConfig, policyFor, sanitizeFilename, validateDeclared } from "../../../src/lib/r2/policy";
import { classify, readPngDimensions } from "../../../src/lib/r2/sniff";
import { compareOnboardingRows, deriveTaskState, rowMatchesOnboardingFilters, taskGlyph, type OnboardingRow } from "../../../src/routes/onboarding.queries";
import { acceptedExtensions, formatBytes, validateClientUpload } from "../../../src/ui/upload/upload-policy";

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

test("AC-146, AC-147 · authenticated task upload policy honors template file types and limit", () => {
  const config = parseUploadOwnerConfig(JSON.stringify({ accept: [".pdf"], maxBytes: 100 }));
  const policy = policyFor("task_upload", config)!;
  expect(validateDeclared(policy, { filename: "slides.pptx", contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", sizeBytes: 10 })).toEqual({
    ok: false,
    violation: "extension",
  });
  expect(validateDeclared(policy, { filename: "slides.pdf", contentType: "application/pdf", sizeBytes: 101 })).toEqual({
    ok: false,
    violation: "too_large",
  });
  expect(validateDeclared(policy, { filename: "slides.pdf", contentType: "application/pdf", sizeBytes: 100 }).ok).toBe(true);
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

const ONBOARDING_NOW = Date.parse("2026-08-11T12:00:00.000Z");

test("AC-91, AC-92 · chase task states retain their glyphs and cancelled work stays visible", () => {
  expect(deriveTaskState({ status: "done", cancelled_at: null, due_at: ONBOARDING_NOW - 1 }, ONBOARDING_NOW)).toBe("done");
  expect(deriveTaskState({ status: "open", cancelled_at: null, due_at: ONBOARDING_NOW - 1 }, ONBOARDING_NOW)).toBe("overdue");
  expect(deriveTaskState({ status: "open", cancelled_at: null, due_at: ONBOARDING_NOW + 7 * 86_400_000 }, ONBOARDING_NOW)).toBe("risk");
  expect(deriveTaskState({ status: "open", cancelled_at: null, due_at: ONBOARDING_NOW + 15 * 86_400_000 }, ONBOARDING_NOW)).toBe("upcoming");
  expect(deriveTaskState({ status: "open", cancelled_at: ONBOARDING_NOW - 1, due_at: ONBOARDING_NOW - 1 }, ONBOARDING_NOW)).toBe("cancelled");
  expect(taskGlyph("done")).toBe("✓");
  expect(taskGlyph("overdue")).toBe("!");
  expect(taskGlyph("risk")).toBe("×");
  expect(taskGlyph("cancelled")).toBe("–");
  expect(taskGlyph("unassigned")).toBe("—");
});

test("AC-92 · chase filters match the selected task type, track, and speaker search", () => {
  const row: OnboardingRow = {
    id: "per_ada",
    person: { id: "per_ada", name: "Ada Lovelace", email: "ada@example.com", title: "Engineer", company: "Analytical Engines", bio: null, headshot_attachment_id: null },
    wave: null,
    tracks: [{ id: "track-ai", name: "AI", color: "#0a6c73", is_primary: true }],
    sessions: [],
    submission_ids: ["sub_ada"],
    tasks: [{ template_id: "task-deck", task_id: "task-ada", submission_id: "sub_ada", title: "Upload deck", kind: "file", description: "", due_at: ONBOARDING_NOW - 1, completed_at: null, state: "overdue", glyph: "!", owed: true }],
    cells: {},
    last_contact: null,
    owed_count: 1,
    done_count: 0,
    overdue_task_count: 1,
    risk_task_count: 0,
    severity: 5,
  };
  expect(rowMatchesOnboardingFilters(row, { filter: "overdue", taskType: "task-deck", track: "track-ai", search: "analytical" })).toBe(true);
  expect(rowMatchesOnboardingFilters(row, { filter: "risk" })).toBe(false);
  expect(rowMatchesOnboardingFilters(row, { taskType: "other-task" })).toBe(false);
});

test("AC-92 · chase ordering puts the most overdue owed work first and ignores done work", () => {
  const row = (id: string, name: string, severity: number, risk_task_count: number): Pick<OnboardingRow, "severity" | "risk_task_count" | "person"> => ({
    severity,
    risk_task_count,
    person: { id, name, email: `${id}@example.com`, title: null, company: null, bio: null, headshot_attachment_id: null },
  });
  expect(compareOnboardingRows(row("per-late", "Late", 30, 0), row("per-risk", "Risk", 1, 4))).toBeLessThan(0);
  expect(compareOnboardingRows(row("per-risk-more", "Risk More", 0, 2), row("per-risk-less", "Risk Less", 0, 1))).toBeLessThan(0);
  expect(compareOnboardingRows(row("per-clear", "Clear", 0, 0), row("per-clear-done", "Clear Done", 0, 0))).toBeLessThan(0);
});

test("AC-146 · slide task choices advertise PDF, PPTX, and KEY before sign", () => {
  expect(acceptedExtensions(["pdf", ".pptx", "key"])).toEqual(["pdf", "pptx", "key"]);
  expect(validateClientUpload({ name: "slides.pptx", size: 10 }, { accept: ["pdf", "pptx", "key"], maxBytes: 25 * 1024 * 1024 })).toBeNull();
  expect(validateClientUpload({ name: "slides.exe", size: 10 }, { accept: ["pdf", "pptx", "key"], maxBytes: 25 * 1024 * 1024 })).toContain(".pdf");
});

test("AC-147 · slide size feedback keeps a chosen file eligible for retry", () => {
  expect(validateClientUpload({ name: "slides.pdf", size: 0 }, { accept: ["pdf"], maxBytes: 100 })).toBe("Choose a non-empty file.");
  expect(validateClientUpload({ name: "slides.pdf", size: 101 }, { accept: ["pdf"], maxBytes: 100 })).toContain("limit is");
  expect(formatBytes(25 * 1024 * 1024)).toBe("25.0 MB");
});
