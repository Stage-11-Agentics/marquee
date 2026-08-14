/**
 * Removing the demo is the seeded case of the ordinary conference deletion
 * operation. Its one extra policy is that synthetic people owned by the demo
 * scope go with it; the event-owned cascade itself lives in one shared module.
 *
 * The organization is deliberately not removed. A real conference can share
 * the demo organization, and every non-demo person, note, tag, and list stays
 * outside this operation's people policy.
 */
import type { EventRow } from "../../db/schema";
import {
  deleteEventCascade,
  type EventDeletionActor,
} from "../events/delete-event";

const SYSTEM_ACTOR: EventDeletionActor = {
  actorKind: "system",
  actorPersonId: null,
  requestId: null,
};

export interface RemoveDemoResult {
  /** Demo events present before the removal; zero means this run was a no-op. */
  removedEvents: number;
  removedPeople: number;
  removedObjects: number;
  removedAt: number;
}

/**
 * Remove every demo conference through the same transactional cascade used by
 * `DELETE /api/v1/events/{eventId}`. A second run is a no-op because the event
 * selector is empty, while the first run audits each event before deleting it.
 */
export async function removeDemoData(
  db: D1Database,
  media?: R2Bucket,
  actor: EventDeletionActor = SYSTEM_ACTOR,
  now = Date.now(),
): Promise<RemoveDemoResult> {
  const events = await db
    .prepare("SELECT * FROM events WHERE demo_mode = 1 ORDER BY created_at ASC, id ASC")
    .all<EventRow>();
  return deleteEventCascade(
    db,
    events.results,
    actor,
    { removeDemoPeople: true, preserveOrgAttachments: false },
    media,
    now,
  );
}
