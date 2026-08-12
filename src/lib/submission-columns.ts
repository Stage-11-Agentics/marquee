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
  { id: "notified", label: "Notified", required: false },
  { id: "tracks", label: "Tracks", required: false },
  // The label says what the number is: a weight-normalised aggregate, not a
  // raw average. The id is wire data (saved views persist it) and never moves.
  { id: "score", label: "Weighted score", required: false },
  { id: "submitted", label: "Submitted", required: false },
  { id: "updated", label: "Last updated", required: false },
  { id: "origin", label: "Origin", required: false },
  { id: "missing", label: "Missing fields", required: false },
] as const;

export type SubmissionColumnId = (typeof SUBMISSION_COLUMN_REGISTRY)[number]["id"];

export const SUBMISSION_COLUMN_IDS = SUBMISSION_COLUMN_REGISTRY.map(
  (column) => column.id,
) as [SubmissionColumnId, ...SubmissionColumnId[]];

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
