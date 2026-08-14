/**
 * The submissions list's CSV export, as a value rather than a side effect.
 *
 * The rows were built inline inside the download handler, next to a blob, an
 * anchor and a revoke — so the only way to see what the file actually contains
 * was to download one. That is how the export came to escape its cells
 * differently from the two server-side exports for three months without anyone
 * noticing.
 */

import { csvRow } from "../../lib/csv";
import { submissionKindLabel, submissionStatusLabel } from "../../lib/submission-columns";

/** The columns an organizer gets, in order. */
export const SUBMISSION_EXPORT_HEADER = [
  "Type", "ID", "Title", "Speakers", "Status", "Tracks", "Score", "Submitted", "Last updated", "Origin",
] as const;

/** Only what the export reads, so a test does not have to build a whole row. */
export interface ExportableSubmission {
  kind: "abstract" | "session";
  id: string;
  title: string;
  speakers: ReadonlyArray<{ name: string }>;
  status: string;
  tracks: ReadonlyArray<{ name: string }>;
  score: number | null;
  submitted_at: number | null;
  updated_at: number | null;
  origin: string;
}

/** The whole file, trailing newline included — exactly what gets downloaded. */
export function submissionsCsv(items: ReadonlyArray<ExportableSubmission>): string {
  const lines = [
    csvRow(SUBMISSION_EXPORT_HEADER),
    ...items.map((item) => csvRow([
      submissionKindLabel(item.kind), item.id, item.title,
      item.speakers.map((speaker) => speaker.name).join("; "), submissionStatusLabel(item.status),
      item.tracks.map((track) => track.name).join("; "), item.score,
      item.submitted_at, item.updated_at, item.origin,
    ])),
  ];
  return `${lines.join("\n")}\n`;
}
