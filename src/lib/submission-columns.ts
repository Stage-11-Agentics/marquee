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
  { id: "close", label: "Form close", required: false },
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

/**
 * The organizer's word for a submission's state — the chip on the row and the
 * cell in the export, which must read the same or the file is about a different
 * conference than the screen.
 */
export function submissionStatusLabel(status: string): string {
  if (status === "waitlisted") return "Maybe";
  if (status === "in_review") return "In review";
  if (status === "unreviewed") return "Unreviewed";
  // MRQ-97: `accepted` falls through to the generic title-case on purpose.
  // It is a stored decision fact, and labelling it "Ready to place" here would
  // put a pipeline stage where a decision belongs.
  return status[0]!.toUpperCase() + status.slice(1);
}
