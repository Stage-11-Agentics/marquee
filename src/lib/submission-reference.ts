import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";

/**
 * Submission references are allocated from a durable per-event high-water
 * row. The ledger and the submission insert are one D1 batch: a deleted row
 * can never lower the next number, and a retry cannot duplicate the caller's
 * other writes because the whole batch rolls back on a reference collision.
 */
const REFERENCE_LEDGER_FLOOR_SQL = `
  SELECT last_sequence
  FROM submission_reference_ledger
  WHERE event_id = ?
`;

const REFERENCE_LEDGER_ADVANCE_SQL = `
  INSERT INTO submission_reference_ledger (event_id, last_sequence, updated_at)
  VALUES (?, ?, ?)
  ON CONFLICT(event_id) DO UPDATE SET
    last_sequence = MAX(submission_reference_ledger.last_sequence, excluded.last_sequence),
    updated_at = excluded.updated_at
`;

/** Search accepts the code as people type it: `SUB-41`, `sub 41`, or `sub41`. */
export function submissionReferenceSearchPatterns(value: string): [string, string] {
  const lower = value.toLocaleLowerCase();
  const compact = lower.replace(/[^a-z0-9]/g, "");
  return [`%${lower}%`, compact ? `%${compact}%` : `%${lower}%`];
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
 * Run one operation, retrying a reference collision exactly once. The retry
 * must rebuild the operation so it reads the newly advanced ledger floor.
 */
export async function withSubmissionReferenceRetry<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (!isSubmissionReferenceUniqueError(error)) throw error;
    return operation();
  }
}

/**
 * Allocate a code and run the caller's insert statements in one atomic D1
 * batch. The ledger statement is deliberately first so a collision rolls the
 * floor update back with the failed submission batch. A missing row means a
 * new event with no emitted references and therefore starts at SUB-1; existing
 * migrated events always have their floor seeded by migration 0030.
 */
export async function withSubmissionReferenceAllocation(
  db: D1Database,
  eventId: string,
  now: number,
  buildStatements: (referenceCode: string) => D1PreparedStatement[],
): Promise<string> {
  return withSubmissionReferenceRetry(async () => {
    const floor = await db.prepare(REFERENCE_LEDGER_FLOOR_SQL)
      .bind(eventId)
      .first<{ last_sequence: number | null }>();
    const lastSequence = Number(floor?.last_sequence ?? 0);
    const referenceCode = `SUB-${lastSequence + 1}`;
    await db.batch([
      db.prepare(REFERENCE_LEDGER_ADVANCE_SQL).bind(eventId, lastSequence + 1, now),
      ...buildStatements(referenceCode),
    ]);
    return referenceCode;
  });
}
