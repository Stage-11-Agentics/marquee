import { SUBMISSION_STATUSES } from "../db/schema";

const ACTIONABLE_STATUSES = new Set([
  "submitted",
  "in_review",
  "accepted",
  "waitlisted",
  "rejected",
  "withdrawn",
]);

export type SubmissionTransitionSource = "organizer" | "airtable";

/**
 * The one status-transition policy used by organizer decisions and the
 * Airtable mirror. Airtable is deliberately narrower around withdrawn rows:
 * the provider can record a decision, but it cannot reopen a speaker-owned
 * withdrawal without an explicit Marquee action.
 */
export function canTransitionSubmissionStatus(
  currentStatus: string,
  targetStatus: string,
  source: SubmissionTransitionSource = "organizer",
): string | null {
  if (!SUBMISSION_STATUSES.includes(currentStatus as (typeof SUBMISSION_STATUSES)[number])) {
    return `submission has unrecognized status ${currentStatus}`;
  }
  if (!SUBMISSION_STATUSES.includes(targetStatus as (typeof SUBMISSION_STATUSES)[number])) {
    return `target status ${targetStatus} is unrecognized`;
  }
  if (!ACTIONABLE_STATUSES.has(currentStatus)) {
    return `submission is ${currentStatus} and cannot be decided`;
  }
  // Airtable delivery is at-least-once and its webhook has no source filter.
  // A provider replay of Marquee's current value is therefore an idempotent
  // no-op, while the organizer writer still reports a duplicate decision.
  if (currentStatus === targetStatus) {
    return source === "airtable" ? null : `submission is already ${targetStatus}`;
  }
  if (targetStatus === "draft") return "submission cannot transition back to draft";
  if (source === "airtable" && currentStatus === "withdrawn") {
    return "submission is withdrawn and cannot be changed by Airtable";
  }
  return null;
}
