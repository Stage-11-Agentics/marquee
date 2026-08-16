import type { FormRow } from "../db/schema";

export const SUBMISSION_DEFAULT_LIMIT_KEY = "submission_default_limit";
export const DEFAULT_SUBMISSION_LIMIT = 3;

export type SubmissionCapacityEvent = {
  submission_default_limit: number;
};

export type SubmissionCapacityForm = Pick<FormRow, "per_submitter_limit" | "submitter_limit_inherit">;

export type SubmissionCapacityPath = "new" | "resumed-draft";

export type SubmissionCapacityRefusal = {
  effectiveLimit: number;
  actualCount: number;
  nextStep: "saved-resume-link" | "organizer";
};

/** Event-setting writes accept 1–100; a missing or malformed value is inert. */
export function parseSubmissionDefault(value: unknown): number {
  const candidate = typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as { limit?: unknown }).limit
    : value;
  return typeof candidate === "number" && Number.isInteger(candidate) && candidate >= 1 && candidate <= 100
    ? candidate
    : DEFAULT_SUBMISSION_LIMIT;
}

/** Resolve the number the public form actually enforces. Legacy raw 0 survives as unlimited. */
export function effectiveSubmitterLimit(
  event: SubmissionCapacityEvent,
  form: SubmissionCapacityForm,
): number {
  return Number(form.submitter_limit_inherit) === 1
    ? parseSubmissionDefault(event.submission_default_limit)
    : Number(form.per_submitter_limit);
}

export async function submissionDefaultFor(db: D1Database, eventId: string): Promise<number> {
  const row = await db
    .prepare("SELECT value_json FROM event_settings WHERE event_id = ? AND key = ?")
    .bind(eventId, SUBMISSION_DEFAULT_LIMIT_KEY)
    .first<{ value_json: string }>();
  if (!row) return DEFAULT_SUBMISSION_LIMIT;
  try {
    return parseSubmissionDefault(JSON.parse(row.value_json) as unknown);
  } catch {
    return DEFAULT_SUBMISSION_LIMIT;
  }
}

export async function writeSubmissionDefault(
  db: D1Database,
  eventId: string,
  limit: number,
  now: number,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO event_settings (id, event_id, key, value_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(event_id, key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
    )
    .bind(
      `submission-default-limit-${eventId}`,
      eventId,
      SUBMISSION_DEFAULT_LIMIT_KEY,
      JSON.stringify({ limit }),
      now,
      now,
    )
    .run();
}

export function submissionCapacityRefusal(
  effectiveLimit: number,
  actualCount: number,
  path: SubmissionCapacityPath,
): SubmissionCapacityRefusal {
  return {
    effectiveLimit,
    actualCount,
    nextStep: path === "resumed-draft" ? "organizer" : "saved-resume-link",
  };
}

export function submissionCapacityMessage(refusal: SubmissionCapacityRefusal): string {
  const sentence = `This call accepts ${refusal.effectiveLimit} abstracts per person, and you already have ${refusal.actualCount}.`;
  return refusal.nextStep === "organizer"
    ? `${sentence} Your saved draft is still available; ask the conference organizer to make room before you submit it.`
    : `${sentence} Use a saved resume link to continue an existing draft.`;
}
