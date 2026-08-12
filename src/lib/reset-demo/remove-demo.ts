/**
 * Removing the demo, once it has served its purpose.
 *
 * `reset:demo` restores the seeded conference; this is the same scope in
 * reverse, and it must be exactly as narrow. The predicates below never name an
 * id: everything is selected through `events.demo_mode = 1` and
 * `people.is_demo = 1`, so a row that is not demo data cannot be reached even
 * if the operator's own conference shares the organization with it (AC-286).
 *
 * The organization is deliberately NOT removed. On an instance seeded alongside
 * a real conference the demo and the operator's own work share one organization
 * row; deleting it would take the operator's conference with it, which is the
 * precise opposite of "removing them touches nothing of yours".
 *
 * Idempotent by construction: every statement is a DELETE with a predicate that
 * matches nothing on a second run.
 */
import { deleteDemoObjects } from "./reseed-demo";

const DEMO_EVENTS = "SELECT id FROM events WHERE demo_mode = 1";
const DEMO_PEOPLE = "SELECT id FROM people WHERE is_demo = 1";

/**
 * Children before parents, mirroring `WIPE_ORDER`. Statements run in one D1
 * batch, so a concurrent reader sees the demo present or absent, never half of
 * it.
 */
export const REMOVE_DEMO_STATEMENTS: readonly string[] = [
  `DELETE FROM webhook_deliveries WHERE endpoint_id IN (SELECT id FROM webhook_endpoints WHERE event_id IN (${DEMO_EVENTS}))`,
  `DELETE FROM webhook_endpoints WHERE event_id IN (${DEMO_EVENTS})`,
  `DELETE FROM submission_decisions WHERE event_id IN (${DEMO_EVENTS})`,
  `DELETE FROM submission_answers WHERE submission_id IN (SELECT id FROM submissions WHERE event_id IN (${DEMO_EVENTS}))`,
  `DELETE FROM submission_tracks WHERE submission_id IN (SELECT id FROM submissions WHERE event_id IN (${DEMO_EVENTS}))`,
  `DELETE FROM participations WHERE submission_id IN (SELECT id FROM submissions WHERE event_id IN (${DEMO_EVENTS}))`,
  `DELETE FROM evaluations WHERE submission_id IN (SELECT id FROM submissions WHERE event_id IN (${DEMO_EVENTS})) OR round_id IN (SELECT r.id FROM evaluation_rounds r JOIN evaluation_plans p ON p.id = r.plan_id WHERE p.event_id IN (${DEMO_EVENTS}))`,
  `DELETE FROM comparisons WHERE round_id IN (SELECT r.id FROM evaluation_rounds r JOIN evaluation_plans p ON p.id = r.plan_id WHERE p.event_id IN (${DEMO_EVENTS}))`,
  `DELETE FROM round_assignments WHERE submission_id IN (SELECT id FROM submissions WHERE event_id IN (${DEMO_EVENTS})) OR round_id IN (SELECT r.id FROM evaluation_rounds r JOIN evaluation_plans p ON p.id = r.plan_id WHERE p.event_id IN (${DEMO_EVENTS}))`,
  `DELETE FROM round_promotions WHERE submission_id IN (SELECT id FROM submissions WHERE event_id IN (${DEMO_EVENTS})) OR from_round_id IN (SELECT r.id FROM evaluation_rounds r JOIN evaluation_plans p ON p.id = r.plan_id WHERE p.event_id IN (${DEMO_EVENTS})) OR to_round_id IN (SELECT r.id FROM evaluation_rounds r JOIN evaluation_plans p ON p.id = r.plan_id WHERE p.event_id IN (${DEMO_EVENTS}))`,
  `DELETE FROM rubric_criteria WHERE round_id IN (SELECT r.id FROM evaluation_rounds r JOIN evaluation_plans p ON p.id = r.plan_id WHERE p.event_id IN (${DEMO_EVENTS}))`,
  `DELETE FROM evaluation_rounds WHERE plan_id IN (SELECT id FROM evaluation_plans WHERE event_id IN (${DEMO_EVENTS}))`,
  `DELETE FROM evaluation_plans WHERE event_id IN (${DEMO_EVENTS})`,
  `DELETE FROM committee_members WHERE committee_id IN (SELECT id FROM committees WHERE event_id IN (${DEMO_EVENTS}))`,
  `DELETE FROM committees WHERE event_id IN (${DEMO_EVENTS})`,
  `DELETE FROM reviewer_track_scopes WHERE event_id IN (${DEMO_EVENTS})`,
  `DELETE FROM saved_views WHERE event_id IN (${DEMO_EVENTS})`,
  `DELETE FROM audit_log WHERE event_id IN (${DEMO_EVENTS})`,
  `DELETE FROM calendar_invites WHERE submission_id IN (SELECT id FROM submissions WHERE event_id IN (${DEMO_EVENTS}))`,
  `DELETE FROM speaker_tasks WHERE event_id IN (${DEMO_EVENTS})`,
  `DELETE FROM task_templates WHERE event_id IN (${DEMO_EVENTS})`,
  `DELETE FROM agenda_items WHERE event_id IN (${DEMO_EVENTS})`,
  `DELETE FROM embeds WHERE event_id IN (${DEMO_EVENTS})`,
  `DELETE FROM import_rows WHERE import_id IN (SELECT id FROM imports WHERE event_id IN (${DEMO_EVENTS}))`,
  `DELETE FROM imports WHERE event_id IN (${DEMO_EVENTS})`,
  `DELETE FROM submissions WHERE event_id IN (${DEMO_EVENTS})`,
  `DELETE FROM form_admins WHERE form_id IN (SELECT id FROM forms WHERE event_id IN (${DEMO_EVENTS}))`,
  `DELETE FROM form_fields WHERE form_id IN (SELECT id FROM forms WHERE event_id IN (${DEMO_EVENTS}))`,
  `DELETE FROM forms WHERE event_id IN (${DEMO_EVENTS})`,
  `DELETE FROM email_templates WHERE event_id IN (${DEMO_EVENTS})`,
  `DELETE FROM outbox WHERE event_id IN (${DEMO_EVENTS})`,
  `DELETE FROM routing_rules WHERE event_id IN (${DEMO_EVENTS})`,
  `DELETE FROM waves WHERE event_id IN (${DEMO_EVENTS})`,
  `DELETE FROM rooms WHERE event_id IN (${DEMO_EVENTS})`,
  `DELETE FROM buildings WHERE event_id IN (${DEMO_EVENTS})`,
  `DELETE FROM tracks WHERE event_id IN (${DEMO_EVENTS})`,
  `DELETE FROM formats WHERE event_id IN (${DEMO_EVENTS})`,
  `DELETE FROM magic_links WHERE person_id IN (${DEMO_PEOPLE})`,
  `DELETE FROM auth_sessions WHERE person_id IN (${DEMO_PEOPLE})`,
  `DELETE FROM api_tokens WHERE event_id IN (${DEMO_EVENTS}) OR created_by IN (${DEMO_PEOPLE})`,
  `DELETE FROM memberships WHERE event_id IN (${DEMO_EVENTS}) OR person_id IN (${DEMO_PEOPLE})`,
  `DELETE FROM people WHERE is_demo = 1`,
  `DELETE FROM attachments WHERE event_id IN (${DEMO_EVENTS})`,
  `DELETE FROM event_settings WHERE event_id IN (${DEMO_EVENTS})`,
  `DELETE FROM events WHERE demo_mode = 1`,
];

export interface RemoveDemoResult {
  /** Demo events present before the removal; zero means this run was a no-op. */
  removedEvents: number;
  removedPeople: number;
  removedObjects: number;
  removedAt: number;
}

/**
 * Remove every demo row and its uploads. Runs to completion on an instance with
 * no demo at all, which is what makes the confirm dialog safe to press twice.
 */
export async function removeDemoData(
  db: D1Database,
  media?: R2Bucket,
  now = Date.now(),
): Promise<RemoveDemoResult> {
  const events = await db.prepare(`${DEMO_EVENTS} ORDER BY created_at ASC`).all<{ id: string }>();
  const people = await db
    .prepare("SELECT COUNT(*) AS total FROM people WHERE is_demo = 1")
    .first<{ total: number }>();

  let removedObjects = 0;
  if (media) {
    for (const event of events.results) {
      removedObjects += await deleteDemoObjects(media, event.id);
    }
  }

  await db.batch(REMOVE_DEMO_STATEMENTS.map((statement) => db.prepare(statement)));

  return {
    removedEvents: events.results.length,
    removedPeople: Number(people?.total ?? 0),
    removedObjects,
    removedAt: now,
  };
}
