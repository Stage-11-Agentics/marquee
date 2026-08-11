/**
 * Owner-specific upload policy: the single decision used by sign handlers,
 * completion verification, and (via the protocol types) the browser client.
 *
 * Extension and declared MIME are validated independently at sign time; the
 * magic-byte/container classification at completion time is authoritative and
 * never trusts either hint. No SVG and no generic ZIP fallback — a container
 * is only a PPTX or KEY when its archive manifest entries prove it.
 */

import type { UploadOwnerConfig, UploadOwnerType } from "./protocol";
import type { SniffKind } from "./sniff";

/** Contract ceiling for any single upload, regardless of owner config. */
export const ABSOLUTE_MAX_BYTES = 100 * 1024 * 1024;
export const HEADSHOT_MAX_BYTES = 10 * 1024 * 1024;
export const EVENT_LOGO_MAX_BYTES = 5 * 1024 * 1024;
export const DEFAULT_FILE_MAX_BYTES = 25 * 1024 * 1024;
/**
 * Deliberate headshot floor: the crop UI renders 320px profile derivatives,
 * so anything smaller than 256px would upscale visibly.
 */
export const HEADSHOT_MIN_DIMENSION = 256;

export interface FileTypeRule {
  extension: string;
  mime: string;
  kind: SniffKind;
}

export const IMAGE_RULES: readonly FileTypeRule[] = Object.freeze([
  { extension: "jpg", mime: "image/jpeg", kind: "jpeg" },
  { extension: "jpeg", mime: "image/jpeg", kind: "jpeg" },
  { extension: "png", mime: "image/png", kind: "png" },
  { extension: "webp", mime: "image/webp", kind: "webp" },
]);

export const DOCUMENT_RULES: readonly FileTypeRule[] = Object.freeze([
  { extension: "pdf", mime: "application/pdf", kind: "pdf" },
  {
    extension: "pptx",
    mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    kind: "pptx",
  },
  { extension: "key", mime: "application/vnd.apple.keynote", kind: "key" },
]);

export interface UploadPolicy {
  ownerType: UploadOwnerType;
  rules: readonly FileTypeRule[];
  maxBytes: number;
  minImageDimension?: number;
}

function clampOwnerMaxBytes(configured: number | undefined, fallback: number): number {
  if (configured === undefined) return fallback;
  if (!Number.isFinite(configured) || configured <= 0) return fallback;
  return Math.min(Math.floor(configured), ABSOLUTE_MAX_BYTES);
}

function narrowRules(
  base: readonly FileTypeRule[],
  accept: string[] | undefined,
): readonly FileTypeRule[] {
  if (!accept || accept.length === 0) return base;
  const wanted = new Set(
    accept.map((entry) => entry.trim().toLowerCase().replace(/^\./, "")),
  );
  return base.filter((rule) => wanted.has(rule.extension));
}

/**
 * Returns null for owner types MRQ-14 does not presign (import_file is
 * modeled in the schema but gains its policy with its ingestion owner).
 */
export function policyFor(
  ownerType: UploadOwnerType | "import_file",
  config?: UploadOwnerConfig,
): UploadPolicy | null {
  switch (ownerType) {
    case "person_headshot":
      return {
        ownerType,
        rules: IMAGE_RULES,
        maxBytes: HEADSHOT_MAX_BYTES,
        minImageDimension: HEADSHOT_MIN_DIMENSION,
      };
    case "event_logo":
      return { ownerType, rules: IMAGE_RULES, maxBytes: EVENT_LOGO_MAX_BYTES };
    case "task_upload":
    case "draft_file":
    case "submission_file":
      return {
        ownerType,
        rules: narrowRules(DOCUMENT_RULES, config?.accept),
        maxBytes: clampOwnerMaxBytes(config?.maxBytes, DEFAULT_FILE_MAX_BYTES),
      };
    default:
      return null;
  }
}

export type PolicyViolation =
  | "extension"
  | "mime"
  | "empty"
  | "too_large";

export type PolicyDecision =
  | { ok: true; rule: FileTypeRule }
  | { ok: false; violation: PolicyViolation };

export function extensionOf(filename: string): string {
  const basename = filename.split(/[\\/]/).pop() ?? "";
  const dot = basename.lastIndexOf(".");
  if (dot <= 0 || dot === basename.length - 1) return "";
  return basename.slice(dot + 1).toLowerCase();
}

export function validateDeclared(
  policy: UploadPolicy,
  declared: { filename: string; contentType: string; sizeBytes: number },
): PolicyDecision {
  const extension = extensionOf(declared.filename);
  const rule = policy.rules.find((candidate) => candidate.extension === extension);
  if (!rule) return { ok: false, violation: "extension" };
  if (declared.contentType.trim().toLowerCase() !== rule.mime) {
    return { ok: false, violation: "mime" };
  }
  if (!Number.isFinite(declared.sizeBytes) || declared.sizeBytes <= 0) {
    return { ok: false, violation: "empty" };
  }
  if (declared.sizeBytes > policy.maxBytes) {
    return { ok: false, violation: "too_large" };
  }
  return { ok: true, rule };
}

const SAFE_FILENAME_CHARS = /[^A-Za-z0-9._ -]/g;

/**
 * Filename used only for display and Content-Disposition. Never chooses an
 * object key or a path; control characters, separators, and unicode are
 * stripped so the header value is always safe.
 */
export function sanitizeFilename(filename: string): string {
  const basename = filename.split(/[\\/]/).pop() ?? "";
  const cleaned = basename
    .replace(SAFE_FILENAME_CHARS, "_")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 120);
  return cleaned.length > 0 ? cleaned : "upload";
}
