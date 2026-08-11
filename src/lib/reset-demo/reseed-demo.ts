import {
  SHIPPED_DEMO_EVENT_ID,
  SHIPPED_DEMO_ORGANIZATION_ID,
  shippedDemoFixtureRows,
} from "./demo-fixture";

const DEMO_EVENT_ID = SHIPPED_DEMO_EVENT_ID;
const DEMO_ORGANIZATION_ID = SHIPPED_DEMO_ORGANIZATION_ID;

/**
 * Children-before-parents delete order for a full demo wipe. The reseed is
 * scoped to the shipped demo event and organization; it never assumes that
 * another tenant is safe to delete.
 */
export const WIPE_ORDER = [
  "webhook_deliveries",
  "webhook_endpoints",
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

type WipeTable = (typeof WIPE_ORDER)[number];

interface DeletePlan {
  sql: string;
  bindings: readonly (number | string | null)[];
}

/**
 * Every predicate is explicit. Tables with no ownership column are either
 * filtered through their owning table or deliberately omitted below:
 * mirror_state is global control-plane state and must survive a demo reset.
 */
const DELETE_PLANS: Partial<Record<WipeTable, DeletePlan>> = {
  webhook_deliveries: {
    sql: "DELETE FROM webhook_deliveries WHERE endpoint_id IN (SELECT id FROM webhook_endpoints WHERE event_id = ?)",
    bindings: [DEMO_EVENT_ID],
  },
  webhook_endpoints: {
    sql: "DELETE FROM webhook_endpoints WHERE event_id = ?",
    bindings: [DEMO_EVENT_ID],
  },
  submission_decisions: {
    sql: "DELETE FROM submission_decisions WHERE event_id = ?",
    bindings: [DEMO_EVENT_ID],
  },
  submission_answers: {
    sql: "DELETE FROM submission_answers WHERE submission_id IN (SELECT id FROM submissions WHERE event_id = ?)",
    bindings: [DEMO_EVENT_ID],
  },
  submission_tracks: {
    sql: "DELETE FROM submission_tracks WHERE submission_id IN (SELECT id FROM submissions WHERE event_id = ?)",
    bindings: [DEMO_EVENT_ID],
  },
  participations: {
    sql: "DELETE FROM participations WHERE submission_id IN (SELECT id FROM submissions WHERE event_id = ?)",
    bindings: [DEMO_EVENT_ID],
  },
  evaluations: {
    sql: "DELETE FROM evaluations WHERE round_id IN (SELECT r.id FROM evaluation_rounds r JOIN evaluation_plans p ON p.id = r.plan_id WHERE p.event_id = ?) OR submission_id IN (SELECT id FROM submissions WHERE event_id = ?)",
    bindings: [DEMO_EVENT_ID, DEMO_EVENT_ID],
  },
  comparisons: {
    sql: "DELETE FROM comparisons WHERE round_id IN (SELECT r.id FROM evaluation_rounds r JOIN evaluation_plans p ON p.id = r.plan_id WHERE p.event_id = ?)",
    bindings: [DEMO_EVENT_ID],
  },
  round_assignments: {
    sql: "DELETE FROM round_assignments WHERE round_id IN (SELECT r.id FROM evaluation_rounds r JOIN evaluation_plans p ON p.id = r.plan_id WHERE p.event_id = ?) OR submission_id IN (SELECT id FROM submissions WHERE event_id = ?)",
    bindings: [DEMO_EVENT_ID, DEMO_EVENT_ID],
  },
  round_promotions: {
    sql: "DELETE FROM round_promotions WHERE from_round_id IN (SELECT r.id FROM evaluation_rounds r JOIN evaluation_plans p ON p.id = r.plan_id WHERE p.event_id = ?) OR to_round_id IN (SELECT r.id FROM evaluation_rounds r JOIN evaluation_plans p ON p.id = r.plan_id WHERE p.event_id = ?) OR submission_id IN (SELECT id FROM submissions WHERE event_id = ?)",
    bindings: [DEMO_EVENT_ID, DEMO_EVENT_ID, DEMO_EVENT_ID],
  },
  rubric_criteria: {
    sql: "DELETE FROM rubric_criteria WHERE round_id IN (SELECT r.id FROM evaluation_rounds r JOIN evaluation_plans p ON p.id = r.plan_id WHERE p.event_id = ?)",
    bindings: [DEMO_EVENT_ID],
  },
  evaluation_rounds: {
    sql: "DELETE FROM evaluation_rounds WHERE plan_id IN (SELECT id FROM evaluation_plans WHERE event_id = ?)",
    bindings: [DEMO_EVENT_ID],
  },
  evaluation_plans: {
    sql: "DELETE FROM evaluation_plans WHERE event_id = ?",
    bindings: [DEMO_EVENT_ID],
  },
  committee_members: {
    sql: "DELETE FROM committee_members WHERE committee_id IN (SELECT id FROM committees WHERE event_id = ?)",
    bindings: [DEMO_EVENT_ID],
  },
  committees: {
    sql: "DELETE FROM committees WHERE event_id = ?",
    bindings: [DEMO_EVENT_ID],
  },
  reviewer_track_scopes: {
    sql: "DELETE FROM reviewer_track_scopes WHERE event_id = ?",
    bindings: [DEMO_EVENT_ID],
  },
  saved_views: {
    sql: "DELETE FROM saved_views WHERE event_id = ?",
    bindings: [DEMO_EVENT_ID],
  },
  audit_log: {
    sql: "DELETE FROM audit_log WHERE event_id = ?",
    bindings: [DEMO_EVENT_ID],
  },
  calendar_invites: {
    sql: "DELETE FROM calendar_invites WHERE submission_id IN (SELECT id FROM submissions WHERE event_id = ?)",
    bindings: [DEMO_EVENT_ID],
  },
  speaker_tasks: {
    sql: "DELETE FROM speaker_tasks WHERE event_id = ?",
    bindings: [DEMO_EVENT_ID],
  },
  task_templates: {
    sql: "DELETE FROM task_templates WHERE event_id = ?",
    bindings: [DEMO_EVENT_ID],
  },
  agenda_items: {
    sql: "DELETE FROM agenda_items WHERE event_id = ?",
    bindings: [DEMO_EVENT_ID],
  },
  embeds: {
    sql: "DELETE FROM embeds WHERE event_id = ?",
    bindings: [DEMO_EVENT_ID],
  },
  import_rows: {
    sql: "DELETE FROM import_rows WHERE import_id IN (SELECT id FROM imports WHERE event_id = ?)",
    bindings: [DEMO_EVENT_ID],
  },
  imports: {
    sql: "DELETE FROM imports WHERE event_id = ?",
    bindings: [DEMO_EVENT_ID],
  },
  submissions: {
    sql: "DELETE FROM submissions WHERE event_id = ?",
    bindings: [DEMO_EVENT_ID],
  },
  form_admins: {
    sql: "DELETE FROM form_admins WHERE form_id IN (SELECT id FROM forms WHERE event_id = ?)",
    bindings: [DEMO_EVENT_ID],
  },
  form_fields: {
    sql: "DELETE FROM form_fields WHERE form_id IN (SELECT id FROM forms WHERE event_id = ?)",
    bindings: [DEMO_EVENT_ID],
  },
  forms: {
    sql: "DELETE FROM forms WHERE event_id = ?",
    bindings: [DEMO_EVENT_ID],
  },
  email_templates: {
    sql: "DELETE FROM email_templates WHERE event_id = ?",
    bindings: [DEMO_EVENT_ID],
  },
  outbox: {
    sql: "DELETE FROM outbox WHERE event_id = ?",
    bindings: [DEMO_EVENT_ID],
  },
  routing_rules: {
    sql: "DELETE FROM routing_rules WHERE event_id = ?",
    bindings: [DEMO_EVENT_ID],
  },
  waves: {
    sql: "DELETE FROM waves WHERE event_id = ?",
    bindings: [DEMO_EVENT_ID],
  },
  rooms: {
    sql: "DELETE FROM rooms WHERE event_id = ?",
    bindings: [DEMO_EVENT_ID],
  },
  buildings: {
    sql: "DELETE FROM buildings WHERE event_id = ?",
    bindings: [DEMO_EVENT_ID],
  },
  tracks: {
    sql: "DELETE FROM tracks WHERE event_id = ?",
    bindings: [DEMO_EVENT_ID],
  },
  formats: {
    sql: "DELETE FROM formats WHERE event_id = ?",
    bindings: [DEMO_EVENT_ID],
  },
  magic_links: {
    sql: "DELETE FROM magic_links WHERE person_id IN (SELECT id FROM people WHERE org_id = ?)",
    bindings: [DEMO_ORGANIZATION_ID],
  },
  auth_sessions: {
    sql: "DELETE FROM auth_sessions WHERE person_id IN (SELECT id FROM people WHERE org_id = ?)",
    bindings: [DEMO_ORGANIZATION_ID],
  },
  api_tokens: {
    sql: "DELETE FROM api_tokens WHERE org_id = ? OR event_id = ?",
    bindings: [DEMO_ORGANIZATION_ID, DEMO_EVENT_ID],
  },
  memberships: {
    sql: "DELETE FROM memberships WHERE org_id = ? OR event_id = ?",
    bindings: [DEMO_ORGANIZATION_ID, DEMO_EVENT_ID],
  },
  people: {
    sql: "DELETE FROM people WHERE org_id = ?",
    bindings: [DEMO_ORGANIZATION_ID],
  },
  attachments: {
    sql: "DELETE FROM attachments WHERE event_id = ?",
    bindings: [DEMO_EVENT_ID],
  },
  event_settings: {
    sql: "DELETE FROM event_settings WHERE event_id = ?",
    bindings: [DEMO_EVENT_ID],
  },
  mirror_outbox: {
    sql: "DELETE FROM mirror_outbox WHERE json_extract(payload, '$.event_id') = ? OR json_extract(payload, '$.org_id') = ?",
    bindings: [DEMO_EVENT_ID, DEMO_ORGANIZATION_ID],
  },
  events: {
    sql: "DELETE FROM events WHERE id = ?",
    bindings: [DEMO_EVENT_ID],
  },
  organizations: {
    sql: "DELETE FROM organizations WHERE id = ?",
    bindings: [DEMO_ORGANIZATION_ID],
  },
};

export interface ReseedResult {
  wipedTables: number;
  insertedRows: number;
  deletedObjects: number;
  reseededAt: number;
}

function scopedWipeStatements(db: D1Database): D1PreparedStatement[] {
  return WIPE_ORDER.flatMap((table) => {
    const plan = DELETE_PLANS[table];
    return plan ? [db.prepare(plan.sql).bind(...plan.bindings)] : [];
  });
}

/** Remove only the demo event's opaque upload partition; unrelated objects stay. */
export async function deleteDemoObjects(media: R2Bucket, eventId = DEMO_EVENT_ID): Promise<number> {
  const prefix = "uploads/" + eventId + "/";
  let cursor: string | undefined;
  let deleted = 0;

  do {
    const page = cursor
      ? await media.list({ prefix, cursor })
      : await media.list({ prefix });
    const keys = page.objects.map((object) => object.key);
    if (keys.length > 0) {
      await media.delete(keys);
      deleted += keys.length;
    }
    if (!page.truncated) return deleted;
    if (!page.cursor) throw new Error("R2 listed a truncated page without a cursor");
    cursor = page.cursor;
  } while (true);
}

/**
 * AC-230: the owned D1 wipe and full shipped-seed insert run in ONE D1 batch.
 * A concurrent visitor observes the old state or the new state, never a
 * partially reseeded demo. R2 cleanup is performed first and fails closed.
 *
 * suppress_mirror: these writes enqueue zero mirror_outbox rows; the queue
 * consumer enqueues exactly one mirror reconcile job after this batch commits.
 */
export async function reseedDemo(
  db: D1Database,
  now = Date.now(),
  media?: R2Bucket,
): Promise<ReseedResult> {
  if (!media) throw new Error("MEDIA binding is required for demo reset");
  const deletedObjects = await deleteDemoObjects(media);
  const rows = shippedDemoFixtureRows(now);
  await db.batch([
    ...scopedWipeStatements(db),
    ...rows.map((row) => db.prepare(row.statement).bind(...row.bindings)),
  ]);
  return {
    wipedTables: WIPE_ORDER.length,
    insertedRows: rows.length,
    deletedObjects,
    reseededAt: now,
  };
}
