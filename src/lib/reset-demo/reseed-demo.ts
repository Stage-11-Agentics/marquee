import {
  SHIPPED_DEMO_EVENT_ID,
  SHIPPED_DEMO_ORGANIZATION_ID,
  shippedDemoFixtureRowsWithReferences,
} from "./demo-fixture";
import { mirrorSuppressionStatements } from "../../jobs/mirror/outbox";

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
  "submission_notes",
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
  "file_comments",
  // Cancellation jobs are demo-event material and are discarded with the
  // reset; the UID high-water table immediately below is deliberately listed
  // without a DELETE plan because SEQUENCE must survive this operation.
  "calendar_cancellations",
  "calendar_invites",
  "calendar_sequence_ledger",
  "speaker_tasks",
  "task_templates",
  "agenda_items",
  "embeds",
  // MRQ-208. Claims reference schedules and people, attendances reference
  // people — so all three go before the rows they point at.
  "schedule_claims",
  "session_star_beacons",
  "event_attendances",
  "public_schedules",
  "import_rows",
  "imports",
  "submissions",
  // Submission references survive reset just like calendar UIDs. The seed
  // rows start above these event-scoped floors, so deleting a max-numbered
  // submission (or all seeded submissions) cannot make its code reusable.
  "submission_reference_ledger",
  "sponsorship_contacts",
  "sponsorships",
  "sponsor_tiers",
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
  "person_list_members",
  "person_lists",
  "person_events",
  "mirror_credentials",
  "people",
  "companies",
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
 * Every conference in the demo organization, not just the seeded one.
 *
 * A conference created at runtime — by the switcher's `＋`, by the CLI, by an
 * agent — lives in the same organization and inherits `demo_mode = 1`. Scoped
 * to the seeded event id, the reset walked straight past it and left it behind
 * forever, in the one workspace a judge or a visitor actually looks at. The
 * sweep is therefore the organization, and the seeded event is simply the one
 * the reseed puts back.
 */
const ORG_EVENTS = "SELECT id FROM events WHERE org_id = ?";
const ORG = [DEMO_ORGANIZATION_ID] as const;

/**
 * Every predicate is explicit. Tables with no ownership column are either
 * filtered through their owning table or deliberately omitted below:
 * mirror_state is global control-plane state and must survive a demo reset.
 *
 * Three of these are not of the form "swap the event id for the org subquery",
 * which is why the list is walked rather than pattern-matched: `mirror_outbox`
 * is scoped through a JSON payload, and `api_tokens` and `memberships` already
 * delete by organization and only need their event half widened.
 */
/**
 * TOTAL, not partial, and deliberately so. `scopedWipeStatements` drops any
 * table with no plan — silently — so a `Partial` map turns "somebody added a
 * table to WIPE_ORDER and stopped there" into a wipe that deletes parents while
 * their children still point at them, and a batch that aborts wholesale. A
 * total map with an explicit `null` makes that omission a type error instead of
 * a broken reset nobody notices until the demo will not reset.
 */
const DELETE_PLANS: Record<WipeTable, DeletePlan | null> = {
  // Global control-plane state: it must survive a demo reset (see above).
  mirror_credentials: null,
  mirror_state: null,
  calendar_sequence_ledger: null,
  submission_reference_ledger: null,
  webhook_deliveries: {
    sql: `DELETE FROM webhook_deliveries WHERE endpoint_id IN (SELECT id FROM webhook_endpoints WHERE event_id IN (${ORG_EVENTS}))`,
    bindings: ORG,
  },
  // MRQ-208, children first. The claim carries a real email address, so a
  // reset that skipped it would leave PII in the one workspace a judge or a
  // visitor actually opens — and every one of these references a schedule, a
  // person or an event that the rest of this wipe is about to remove.
  schedule_claims: {
    sql: `DELETE FROM schedule_claims WHERE event_id IN (${ORG_EVENTS})`,
    bindings: ORG,
  },
  session_star_beacons: {
    sql: `DELETE FROM session_star_beacons WHERE event_id IN (${ORG_EVENTS})`,
    bindings: ORG,
  },
  event_attendances: {
    sql: `DELETE FROM event_attendances WHERE event_id IN (${ORG_EVENTS})`,
    bindings: ORG,
  },
  // Attendee schedules are anonymous rows pointing at demo sessions; a demo
  // reset that left them behind would leave codes resolving to sessions that
  // no longer exist.
  public_schedules: {
    // ORG_EVENTS, like every neighbour: scoped to the seeded event id alone, a
    // schedule on a demo conference created at runtime survived the wipe and
    // then FK-aborted the trailing DELETE FROM events, wedging reset:demo.
    sql: `DELETE FROM public_schedules WHERE event_id IN (${ORG_EVENTS})`,
    bindings: ORG,
  },
  webhook_endpoints: {
    sql: `DELETE FROM webhook_endpoints WHERE event_id IN (${ORG_EVENTS})`,
    bindings: ORG,
  },
  submission_decisions: {
    sql: `DELETE FROM submission_decisions WHERE event_id IN (${ORG_EVENTS})`,
    bindings: ORG,
  },
  submission_notes: {
    sql: `DELETE FROM submission_notes WHERE submission_id IN (SELECT id FROM submissions WHERE event_id IN (${ORG_EVENTS}))`,
    bindings: ORG,
  },
  submission_answers: {
    sql: `DELETE FROM submission_answers WHERE submission_id IN (SELECT id FROM submissions WHERE event_id IN (${ORG_EVENTS}))`,
    bindings: ORG,
  },
  submission_tracks: {
    sql: `DELETE FROM submission_tracks WHERE submission_id IN (SELECT id FROM submissions WHERE event_id IN (${ORG_EVENTS}))`,
    bindings: ORG,
  },
  participations: {
    sql: `DELETE FROM participations WHERE submission_id IN (SELECT id FROM submissions WHERE event_id IN (${ORG_EVENTS}))`,
    bindings: ORG,
  },
  evaluations: {
    sql: `DELETE FROM evaluations WHERE round_id IN (SELECT r.id FROM evaluation_rounds r JOIN evaluation_plans p ON p.id = r.plan_id WHERE p.event_id IN (${ORG_EVENTS})) OR submission_id IN (SELECT id FROM submissions WHERE event_id IN (${ORG_EVENTS}))`,
    bindings: [DEMO_ORGANIZATION_ID, DEMO_ORGANIZATION_ID],
  },
  comparisons: {
    sql: `DELETE FROM comparisons WHERE round_id IN (SELECT r.id FROM evaluation_rounds r JOIN evaluation_plans p ON p.id = r.plan_id WHERE p.event_id IN (${ORG_EVENTS}))`,
    bindings: ORG,
  },
  round_assignments: {
    sql: `DELETE FROM round_assignments WHERE round_id IN (SELECT r.id FROM evaluation_rounds r JOIN evaluation_plans p ON p.id = r.plan_id WHERE p.event_id IN (${ORG_EVENTS})) OR submission_id IN (SELECT id FROM submissions WHERE event_id IN (${ORG_EVENTS}))`,
    bindings: [DEMO_ORGANIZATION_ID, DEMO_ORGANIZATION_ID],
  },
  round_promotions: {
    sql: `DELETE FROM round_promotions WHERE from_round_id IN (SELECT r.id FROM evaluation_rounds r JOIN evaluation_plans p ON p.id = r.plan_id WHERE p.event_id IN (${ORG_EVENTS})) OR to_round_id IN (SELECT r.id FROM evaluation_rounds r JOIN evaluation_plans p ON p.id = r.plan_id WHERE p.event_id IN (${ORG_EVENTS})) OR submission_id IN (SELECT id FROM submissions WHERE event_id IN (${ORG_EVENTS}))`,
    bindings: [DEMO_ORGANIZATION_ID, DEMO_ORGANIZATION_ID, DEMO_ORGANIZATION_ID],
  },
  rubric_criteria: {
    sql: `DELETE FROM rubric_criteria WHERE round_id IN (SELECT r.id FROM evaluation_rounds r JOIN evaluation_plans p ON p.id = r.plan_id WHERE p.event_id IN (${ORG_EVENTS}))`,
    bindings: ORG,
  },
  evaluation_rounds: {
    sql: `DELETE FROM evaluation_rounds WHERE plan_id IN (SELECT id FROM evaluation_plans WHERE event_id IN (${ORG_EVENTS}))`,
    bindings: ORG,
  },
  evaluation_plans: {
    sql: `DELETE FROM evaluation_plans WHERE event_id IN (${ORG_EVENTS})`,
    bindings: ORG,
  },
  committee_members: {
    sql: `DELETE FROM committee_members WHERE committee_id IN (SELECT id FROM committees WHERE event_id IN (${ORG_EVENTS}))`,
    bindings: ORG,
  },
  committees: {
    sql: `DELETE FROM committees WHERE event_id IN (${ORG_EVENTS})`,
    bindings: ORG,
  },
  reviewer_track_scopes: {
    sql: `DELETE FROM reviewer_track_scopes WHERE event_id IN (${ORG_EVENTS})`,
    bindings: ORG,
  },
  saved_views: {
    sql: `DELETE FROM saved_views WHERE event_id IN (${ORG_EVENTS})`,
    bindings: ORG,
  },
  audit_log: {
    sql: `DELETE FROM audit_log WHERE event_id IN (${ORG_EVENTS})`,
    bindings: ORG,
  },
  file_comments: {
    sql: `DELETE FROM file_comments WHERE event_id IN (${ORG_EVENTS})`,
    bindings: ORG,
  },
  calendar_invites: {
    sql: `DELETE FROM calendar_invites WHERE submission_id IN (SELECT id FROM submissions WHERE event_id IN (${ORG_EVENTS}))`,
    bindings: ORG,
  },
  calendar_cancellations: {
    sql: `DELETE FROM calendar_cancellations WHERE event_id IN (${ORG_EVENTS})`,
    bindings: ORG,
  },
  speaker_tasks: {
    sql: `DELETE FROM speaker_tasks WHERE event_id IN (${ORG_EVENTS})`,
    bindings: ORG,
  },
  task_templates: {
    sql: `DELETE FROM task_templates WHERE event_id IN (${ORG_EVENTS})`,
    bindings: ORG,
  },
  agenda_items: {
    sql: `DELETE FROM agenda_items WHERE event_id IN (${ORG_EVENTS})`,
    bindings: ORG,
  },
  embeds: {
    sql: `DELETE FROM embeds WHERE event_id IN (${ORG_EVENTS})`,
    bindings: ORG,
  },
  import_rows: {
    sql: `DELETE FROM import_rows WHERE import_id IN (SELECT id FROM imports WHERE event_id IN (${ORG_EVENTS}))`,
    bindings: ORG,
  },
  imports: {
    sql: `DELETE FROM imports WHERE event_id IN (${ORG_EVENTS})`,
    bindings: ORG,
  },
  submissions: {
    sql: `DELETE FROM submissions WHERE event_id IN (${ORG_EVENTS})`,
    bindings: ORG,
  },
  // Sponsorships die before their tiers and before the people they name. The
  // deliverables and Sessions that point at a sponsorship are deleted higher up
  // (`speaker_tasks`, `submissions`), so by here nothing references these rows.
  sponsorship_contacts: {
    sql: `DELETE FROM sponsorship_contacts WHERE sponsorship_id IN (SELECT id FROM sponsorships WHERE event_id IN (${ORG_EVENTS}))`,
    bindings: ORG,
  },
  sponsorships: {
    sql: `DELETE FROM sponsorships WHERE event_id IN (${ORG_EVENTS})`,
    bindings: ORG,
  },
  sponsor_tiers: {
    sql: `DELETE FROM sponsor_tiers WHERE event_id IN (${ORG_EVENTS})`,
    bindings: ORG,
  },
  form_admins: {
    sql: `DELETE FROM form_admins WHERE form_id IN (SELECT id FROM forms WHERE event_id IN (${ORG_EVENTS}))`,
    bindings: ORG,
  },
  form_fields: {
    sql: `DELETE FROM form_fields WHERE form_id IN (SELECT id FROM forms WHERE event_id IN (${ORG_EVENTS}))`,
    bindings: ORG,
  },
  forms: {
    sql: `DELETE FROM forms WHERE event_id IN (${ORG_EVENTS})`,
    bindings: ORG,
  },
  email_templates: {
    sql: `DELETE FROM email_templates WHERE event_id IN (${ORG_EVENTS})`,
    bindings: ORG,
  },
  outbox: {
    sql: `DELETE FROM outbox WHERE event_id IN (${ORG_EVENTS})`,
    bindings: ORG,
  },
  routing_rules: {
    sql: `DELETE FROM routing_rules WHERE event_id IN (${ORG_EVENTS})`,
    bindings: ORG,
  },
  waves: {
    sql: `DELETE FROM waves WHERE event_id IN (${ORG_EVENTS})`,
    bindings: ORG,
  },
  rooms: {
    sql: `DELETE FROM rooms WHERE event_id IN (${ORG_EVENTS})`,
    bindings: ORG,
  },
  buildings: {
    sql: `DELETE FROM buildings WHERE event_id IN (${ORG_EVENTS})`,
    bindings: ORG,
  },
  tracks: {
    sql: `DELETE FROM tracks WHERE event_id IN (${ORG_EVENTS})`,
    bindings: ORG,
  },
  formats: {
    sql: `DELETE FROM formats WHERE event_id IN (${ORG_EVENTS})`,
    bindings: ORG,
  },
  magic_links: {
    sql: "DELETE FROM magic_links WHERE person_id IN (SELECT id FROM people WHERE org_id = ?)",
    bindings: ORG,
  },
  auth_sessions: {
    sql: "DELETE FROM auth_sessions WHERE person_id IN (SELECT id FROM people WHERE org_id = ?)",
    bindings: ORG,
  },
  // Already organization-scoped. Worth knowing rather than rediscovering: a
  // reset invalidates every demo-org token and session, so a token minted
  // before a reset reads as a 401 afterwards. Pre-existing, not multi-event.
  api_tokens: {
    sql: `DELETE FROM api_tokens WHERE org_id = ? OR event_id IN (${ORG_EVENTS})`,
    bindings: [DEMO_ORGANIZATION_ID, DEMO_ORGANIZATION_ID],
  },
  memberships: {
    sql: `DELETE FROM memberships WHERE org_id = ? OR event_id IN (${ORG_EVENTS})`,
    bindings: [DEMO_ORGANIZATION_ID, DEMO_ORGANIZATION_ID],
  },
  // People annotations and Lists are org-scoped, so a reset that wipes the demo
  // organization's people has to take their notes, tags, stages, and saved lists
  // with them — a surviving `person_events` row would reference a person the
  // reset just deleted.
  person_list_members: {
    sql: "DELETE FROM person_list_members WHERE list_id IN (SELECT id FROM person_lists WHERE org_id = ?)",
    bindings: [DEMO_ORGANIZATION_ID],
  },
  person_lists: {
    sql: "DELETE FROM person_lists WHERE org_id = ?",
    bindings: [DEMO_ORGANIZATION_ID],
  },
  person_events: {
    sql: "DELETE FROM person_events WHERE org_id = ?",
    bindings: [DEMO_ORGANIZATION_ID],
  },
  people: {
    sql: "DELETE FROM people WHERE org_id = ?",
    bindings: ORG,
  },
  // Org-scoped like people, and deleted AFTER them: `people.company_id` points
  // here, so wiping companies first would leave the person rows referencing a
  // company that no longer exists.
  companies: {
    sql: "DELETE FROM companies WHERE org_id = ?",
    bindings: ORG,
  },
  attachments: {
    sql: `DELETE FROM attachments WHERE event_id IN (${ORG_EVENTS})`,
    bindings: ORG,
  },
  event_settings: {
    sql: `DELETE FROM event_settings WHERE event_id IN (${ORG_EVENTS})`,
    bindings: ORG,
  },
  // Neither event- nor org-columned: the scope lives inside the JSON payload,
  // which is why the org rewrite has to reach in through json_extract.
  mirror_outbox: {
    sql: `DELETE FROM mirror_outbox WHERE json_extract(payload, '$.event_id') IN (${ORG_EVENTS}) OR json_extract(payload, '$.org_id') = ?`,
    bindings: [DEMO_ORGANIZATION_ID, DEMO_ORGANIZATION_ID],
  },
  events: {
    sql: "DELETE FROM events WHERE org_id = ?",
    bindings: ORG,
  },
  organizations: {
    sql: "DELETE FROM organizations WHERE id = ?",
    bindings: ORG,
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
    // A null plan is a decision on the record — see DELETE_PLANS. A missing
    // one can no longer reach here: the map is total.
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
 * The upload partitions of every conference in the demo organization.
 *
 * The D1 sweep is org-wide, so this has to be too: deleting a created
 * conference's `attachments` rows while leaving `uploads/<its id>/` in the
 * bucket produces orphaned objects with nothing left to index them.
 *
 * R2 and D1 are not atomic with each other and cannot be made so here. A
 * conference created between this enumeration and the batch below leaves its
 * objects behind; the nightly upload orphan sweep is the backstop. Stating that
 * is the honest version of a guarantee this layer cannot give.
 */
export async function deleteDemoOrgObjects(
  db: D1Database,
  media: R2Bucket,
  orgId = DEMO_ORGANIZATION_ID,
): Promise<number> {
  const events = await db
    .prepare("SELECT id FROM events WHERE org_id = ? ORDER BY created_at ASC")
    .bind(orgId)
    .all<{ id: string }>();
  let deleted = 0;
  for (const event of events.results) deleted += await deleteDemoObjects(media, event.id);
  // The seeded partition is swept even when its row is already gone, so a reset
  // after a manual delete still clears the objects it left.
  if (!events.results.some((event) => event.id === DEMO_EVENT_ID)) {
    deleted += await deleteDemoObjects(media, DEMO_EVENT_ID);
  }
  return deleted;
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
  const deletedObjects = await deleteDemoOrgObjects(db, media);
  const existingReferenceFloors = await db.prepare(
    "SELECT event_id, last_sequence FROM submission_reference_ledger WHERE event_id IN (SELECT id FROM events WHERE org_id = ?)",
  ).bind(DEMO_ORGANIZATION_ID).all<{ event_id: string; last_sequence: number }>();
  const startingSequences = new Map(
    existingReferenceFloors.results.map((row) => [row.event_id, Number(row.last_sequence)] as const),
  );
  const fixture = shippedDemoFixtureRowsWithReferences(now, startingSequences);
  const [suppressMirror, releaseMirror] = mirrorSuppressionStatements(db, now);
  const referenceLedgerStatements = [...fixture.referenceHighWater.entries()].map(([eventId, lastSequence]) =>
    db.prepare(
      `INSERT INTO submission_reference_ledger (event_id, last_sequence, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(event_id) DO UPDATE SET
         last_sequence = MAX(submission_reference_ledger.last_sequence, excluded.last_sequence),
         updated_at = excluded.updated_at`,
    ).bind(eventId, lastSequence, now),
  );
  await db.batch([
    suppressMirror,
    ...scopedWipeStatements(db),
    ...fixture.rows.map((row) => db.prepare(row.statement).bind(...row.bindings)),
    ...referenceLedgerStatements,
    releaseMirror,
  ]);
  return {
    wipedTables: WIPE_ORDER.length,
    insertedRows: fixture.rows.length,
    deletedObjects,
    reseededAt: now,
  };
}
