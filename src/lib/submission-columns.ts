/**
 * Stable submissions-table column registry.
 *
 * M-55 persists these ids in saved views, so ids are wire data: append or
 * deprecate deliberately; never rename one as a cosmetic refactor.
 */
export const SUBMISSION_COLUMN_REGISTRY = [
  { id: "type", label: "Type", required: false },
  { id: "id", label: "ID", required: false },
  { id: "title", label: "Title", required: true },
  { id: "speakers", label: "Speakers", required: false },
  { id: "status", label: "Status", required: false },
  { id: "tracks", label: "Tracks", required: false },
  { id: "score", label: "Score", required: false },
  { id: "submitted", label: "Submitted", required: false },
  { id: "updated", label: "Last updated", required: false },
  { id: "origin", label: "Origin", required: false },
  { id: "missing", label: "Missing fields", required: false },
] as const;

export type SubmissionColumnId = (typeof SUBMISSION_COLUMN_REGISTRY)[number]["id"];

export const DEFAULT_SUBMISSION_COLUMNS: readonly SubmissionColumnId[] = [
  "type",
  "title",
  "speakers",
  "status",
  "tracks",
  "score",
] as const;

export function submissionColumn(id: SubmissionColumnId) {
  return SUBMISSION_COLUMN_REGISTRY.find((column) => column.id === id)!;
}

/** AC-23's text marker; never replace this with a colour-only distinction. */
export function submissionKindLabel(kind: "abstract" | "session"): "Abstract" | "Session" {
  return kind === "abstract" ? "Abstract" : "Session";
}
