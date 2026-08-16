/**
 * Submission reference allocation is intentionally a small shared seam.
 * Every insert computes the next number inside SQLite, and callers retry only
 * the one unique-index race that can happen when two writers observe the same
 * maximum. The opaque submission id remains the route identity.
 */

export const SUBMISSION_REFERENCE_CODE_SQL = `(
  SELECT 'SUB-' || (
    COALESCE(MAX(CAST(substr(reference_code, 5) AS INTEGER)), 0) + 1
  )
  FROM submissions
  WHERE event_id = ?
)`;

/** Search accepts the code as people type it: `SUB-41`, `sub 41`, or `sub41`. */
export function submissionReferenceSearchPatterns(value: string): [string, string] {
  const lower = value.toLocaleLowerCase();
  const compact = lower.replace(/[^a-z0-9]/g, "");
  return [`%${lower}%`, `%${compact}%`];
}

export function submissionReferenceSearchSql(alias = "s"): string {
  return `(lower(coalesce(${alias}.reference_code, '')) LIKE ? OR lower(replace(replace(coalesce(${alias}.reference_code, ''), '-', ''), ' ', '')) LIKE ?)`;
}

const REFERENCE_UNIQUE_ERROR = /(?:submissions\.event_id,\s*submissions\.reference_code|uq_submissions_reference)/i;

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    return typeof message === "string" ? message : String(error);
  }
  return String(error);
}

/** True only for the event/reference unique-index collision. */
export function isSubmissionReferenceUniqueError(error: unknown): boolean {
  return REFERENCE_UNIQUE_ERROR.test(errorMessage(error));
}

/**
 * Run one insert operation, retrying a reference collision exactly once.
 * Callers must build the operation so a retry recreates the whole atomic write
 * (a D1 batch, where applicable), rather than repeating only a follow-up read.
 */
export async function withSubmissionReferenceRetry<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (!isSubmissionReferenceUniqueError(error)) throw error;
    return operation();
  }
}
