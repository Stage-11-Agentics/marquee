/**
 * A file answer is a thing a speaker uploaded, not a storage payload.
 *
 * The public form stores a `file` field's answer as
 * `{"attachmentId":…,"filename":…,"contentType":…,"sizeBytes":…}`, and every
 * surface that rendered answers as text printed that JSON at the organizer.
 * The shape is described once here so the record, the reviewer queue, and
 * whatever renders answers next all read the same thing.
 */

/** The stored payload as written by the public form's upload handler. */
export interface StoredFileAnswer {
  attachmentId: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
}

/**
 * A file answer prepared for display. `state` is the whole honesty of it:
 * `missing` covers a field that was never uploaded and an attachment whose
 * bytes never arrived, and both read as missing rather than as a broken image.
 */
export interface FileAnswerView {
  state: "ready" | "missing";
  attachment_id: string | null;
  filename: string | null;
  content_type: string | null;
  size_bytes: number | null;
  /** A same-origin thumbnail, present only for a ready raster image. */
  preview_url: string | null;
}

/**
 * Image types the organizer surfaces will render inline. Deliberately raster
 * only: SVG is a document, and this list is the allowlist the preview endpoint
 * enforces before it serves any bytes from the application origin.
 */
export const PREVIEWABLE_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;

const PREVIEWABLE = new Set<string>(PREVIEWABLE_IMAGE_TYPES);

export function isPreviewableImage(contentType: string | null | undefined): boolean {
  if (!contentType) return false;
  return PREVIEWABLE.has(contentType.split(";")[0]!.trim().toLowerCase());
}

/** The stored payload, or null when the value is anything else. */
export function readStoredFileAnswer(value: unknown): StoredFileAnswer | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.attachmentId !== "string" || record.attachmentId === "") return null;
  return {
    attachmentId: record.attachmentId,
    filename: typeof record.filename === "string" && record.filename !== "" ? record.filename : "Attached file",
    contentType: typeof record.contentType === "string" ? record.contentType : "application/octet-stream",
    sizeBytes: typeof record.sizeBytes === "number" && Number.isFinite(record.sizeBytes) ? record.sizeBytes : 0,
  };
}

export function attachmentPreviewPath(eventId: string, attachmentId: string): string {
  return `/api/v1/events/${encodeURIComponent(eventId)}/attachments/${encodeURIComponent(attachmentId)}/preview`;
}

/** The view for a file field with no usable upload behind it. */
export function missingFileAnswer(): FileAnswerView {
  return {
    state: "missing",
    attachment_id: null,
    filename: null,
    content_type: null,
    size_bytes: null,
    preview_url: null,
  };
}

/** A byte count an organizer reads at a glance. */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
