import type { EventRow } from "../db/schema";
import { SHIPPED_DEMO_EVENT_ID } from "./reset-demo/demo-fixture";

/**
 * Which conference is "the demo" — asked in two places that must never
 * disagree: the landing page a visitor lands on, and the `/auth/me` payload
 * that names the conference in the shell, supplies the CLI's default event, and
 * seeds the browser's event selection.
 *
 * Both used to answer "the oldest `demo_mode = 1` row", and that was a guess
 * wearing a query's clothes. `npm run seed` — the documented production path —
 * stamps every seeded row with a frozen clock currently set in the future, so a
 * conference created today sorts BEFORE the seeded one. Now that a conference
 * created in the demo organization inherits `demo_mode = 1`, the front door
 * would advertise a visitor's own empty conference, with the seeded program one
 * row below it and invisible.
 *
 * So: identity first, age only as the fallback for an instance whose demo is
 * not the shipped fixture. One ordering clause, one binding, and the same
 * answer from both callers.
 */
export const DEMO_EVENT_ORDER = "ORDER BY (id <> ?) ASC, created_at ASC LIMIT 1";

export const SEEDED_DEMO_EVENT_ID = SHIPPED_DEMO_EVENT_ID;

/**
 * That one conference, read. Shared rather than duplicated because three
 * surfaces ask the same question for the same reason: the auth doors decide
 * whether a demo login exists, `/auth/me` names the conference in the shell,
 * and the sign-in page decides whether to offer the three demo doors at all.
 * A second copy of this SELECT is a second answer waiting to disagree.
 */
export async function findDemoEvent(db: D1Database): Promise<EventRow | null> {
  const event = await db
    .prepare(`SELECT * FROM events WHERE demo_mode = 1 ${DEMO_EVENT_ORDER}`)
    .bind(SEEDED_DEMO_EVENT_ID)
    .first<EventRow>();
  return event ?? null;
}
