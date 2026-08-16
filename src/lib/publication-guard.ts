import type { D1Database } from "@cloudflare/workers-types";

import { ApiError } from "../api/errors";

/** The product sentence shared by every live-session content and workflow guard. */
export const PUBLISHED_SESSION_REFUSAL =
  "This session is live on the conference site. Unpublish it or reverse the acceptance to change its outcome.";

export async function isPublishedSession(
  db: D1Database,
  eventId: string,
  submissionId: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 AS present
         FROM agenda_items
        WHERE event_id = ?
          AND submission_id = ?
          AND kind = 'session'
          AND is_published = 1
        LIMIT 1`,
    )
    .bind(eventId, submissionId)
    .first<{ present: number }>();
  return row?.present === 1;
}

/** Throw the one conflict shape used when an existing live write lacks consent. */
export async function requirePublishedConfirmation(
  db: D1Database,
  eventId: string,
  submissionId: string,
  confirmed: boolean,
): Promise<void> {
  if (confirmed || !(await isPublishedSession(db, eventId, submissionId))) return;
  throw ApiError.conflict(PUBLISHED_SESSION_REFUSAL);
}
