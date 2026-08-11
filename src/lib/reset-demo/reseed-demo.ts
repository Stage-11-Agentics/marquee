import { demoFixtureRows } from "./demo-fixture";

/**
 * Children-before-parents delete order for a full demo wipe. The reseed is
 * only reachable for a `demo_mode = 1` event (route gate), where the whole
 * database is the demo.
 */
export const WIPE_ORDER = [
  "submission_decisions",
  "submission_answers",
  "submission_tracks",
  "participations",
  "evaluations",
  "comparisons",
  "round_assignments",
  "round_promotions",
  "rubric_criteria",
  "evaluation_rounds",
  "evaluation_plans",
  "committee_members",
  "committees",
  "reviewer_track_scopes",
  "saved_views",
  "audit_log",
  "calendar_invites",
  "speaker_tasks",
  "task_templates",
  "agenda_items",
  "embeds",
  "import_rows",
  "imports",
  "submissions",
  "form_admins",
  "form_fields",
  "forms",
  "email_templates",
  "outbox",
  "routing_rules",
  "waves",
  "rooms",
  "buildings",
  "tracks",
  "formats",
  "magic_links",
  "auth_sessions",
  "api_tokens",
  "memberships",
  "people",
  "attachments",
  "event_settings",
  "mirror_outbox",
  "mirror_state",
  "events",
  "organizations",
] as const;

export interface ReseedResult {
  wipedTables: number;
  insertedRows: number;
  reseededAt: number;
}

/**
 * AC-230: wipe + fixture insert run in ONE D1 batch, which is one transaction
 * — a concurrent visitor polling throughout observes the old state or the new
 * state, never a partial reset. Deterministic fixture ids make repeat runs
 * idempotent.
 *
 * §3.9 suppress_mirror: these writes enqueue zero `mirror_outbox` rows (the
 * module simply never writes that table); the caller enqueues exactly one
 * mirror reconcile job when the batch commits.
 */
export async function reseedDemo(db: D1Database, now = Date.now()): Promise<ReseedResult> {
  const statements = [
    ...WIPE_ORDER.map((table) => db.prepare(`DELETE FROM ${table}`)),
    ...demoFixtureRows(now).map((row) => db.prepare(row.statement).bind(...row.bindings)),
  ];
  await db.batch(statements);
  return {
    wipedTables: WIPE_ORDER.length,
    insertedRows: demoFixtureRows(now).length,
    reseededAt: now,
  };
}
