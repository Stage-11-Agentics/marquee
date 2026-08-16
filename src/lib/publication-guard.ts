import type { D1Database } from "@cloudflare/workers-types";

import { ApiError } from "../api/errors";

/** The product sentence shared by every live-session content and workflow guard. */
export const PUBLISHED_SESSION_REFUSAL =
  "This session is live on the conference site. Unpublish it or reverse the acceptance to change its outcome.";

/** Content-edit callers have an explicit API confirmation route forward. */
export const PUBLISHED_CONTENT_REFUSAL =
  "This session is live on the conference site. Resend with confirm_published to change what attendees see.";

/** Portal participants cannot change publication state themselves. */
export const PUBLISHED_PARTICIPANT_REFUSAL =
  "This session is live on the conference site. Ask the conference organizer to unpublish it or reverse the acceptance before changing its public content.";

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
  refusal = PUBLISHED_SESSION_REFUSAL,
): Promise<void> {
  if (confirmed || !(await isPublishedSession(db, eventId, submissionId))) return;
  throw ApiError.conflict(refusal);
}
