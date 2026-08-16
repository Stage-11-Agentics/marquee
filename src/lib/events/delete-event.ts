import type { AuthContext } from "../auth/scope-resolution";
import { auditStatement } from "../audit";
import type { AuditActorKind, EventRow } from "../../db/schema";
import { noPersonReferencesPredicate } from "../person-references";

type LifecycleRow = Record<string, unknown> & { id?: string };

function lifecycleKey(row: LifecycleRow): string {
  if (row.id !== undefined && row.id !== null) return String(row.id);
  if (row.code !== undefined && row.code !== null) return String(row.code);
  return Object.entries(row)
    .filter(([key]) => key.endsWith("_id") || key === "person_id")
    .map(([key, value]) => `${key}=${String(value)}`)
    .sort()
    .join("|");
}

function cloneLifecycle<T extends LifecycleRow>(row: T): T {
  return JSON.parse(JSON.stringify(row)) as T;
}

interface CleanupReference {
  table: string;
  row: LifecycleRow;
  after: LifecycleRow;
}

/** The actor is carried into the same D1 batch as the event deletion. */
export interface EventDeletionActor {
  actorKind: AuditActorKind;
  actorPersonId: string | null;
  requestId: string | null;
}

export interface EventDeletionOptions {
  /** `remove-demo` also removes the seeded people owned by the demo scope. */
  removeDemoPeople?: boolean;
  /** Ordinary conference deletion preserves organization-level headshots. */
  preserveOrgAttachments?: boolean;
}

export interface EventDeletionResult {
  removedEvents: number;
  removedPeople: number;
  removedObjects: number;
  removedAt: number;
}

const R2_DELETE_CHUNK = 1_000;
/**
 * D1 permits 100 bound parameters per statement. The widest cascade statement
 * repeats eventBindings three times, so 32 event IDs keep that statement at
 * 96 bindings while allowing remove-demo to accept any number of events.
 */
const EVENT_DELETE_CHUNK = 32;

function placeholders(values: readonly unknown[]): string {
  return values.map(() => "?").join(", ");
}

function eventFilter(eventIds: readonly string[]): string {
  return `(${placeholders(eventIds)})`;
}

function prepared(
  db: D1Database,
  sql: string,
  ...bindings: readonly unknown[]
): D1PreparedStatement {
  return db.prepare(sql).bind(...bindings);
}

export interface DemoPeopleRemovalBlocker {
  family: string;
  column: string;
  row_id: string;
  event_id: string;
  person_id: string;
  policy: "refuse";
}

export class DemoPeopleRemovalRefusedError extends Error {
  readonly code = "remove_demo_refused" as const;

  constructor(
    readonly blockers: readonly DemoPeopleRemovalBlocker[],
    readonly reason = "demo_person_referenced_by_surviving_event",
  ) {
    super("Demo people are referenced by a surviving conference; no rows were changed.");
    this.name = "DemoPeopleRemovalRefusedError";
  }
}

async function survivingEventDemoPeopleBlockers(
  db: D1Database,
  eventIdsSql: string,
  eventBindings: readonly string[],
): Promise<DemoPeopleRemovalBlocker[]> {
  const scope = [
    "WITH selected_event_orgs AS (SELECT DISTINCT org_id FROM events WHERE id IN " + eventIdsSql + "),",
    "selected_people AS (SELECT id, org_id FROM people WHERE is_demo = 1 AND org_id IN (SELECT org_id FROM selected_event_orgs)),",
    "surviving_events AS (SELECT id, org_id FROM events WHERE org_id IN (SELECT org_id FROM selected_event_orgs) AND id NOT IN " + eventIdsSql + ")",
  ].join(" ");
  const checks: Array<[string, string, string]> = [
    ["memberships", "person_id", "SELECT r.id AS row_id, r.event_id, r.person_id FROM memberships r JOIN selected_people p ON p.id = r.person_id JOIN surviving_events e ON e.id = r.event_id"],
    ["saved_views", "person_id", "SELECT r.id AS row_id, r.event_id, r.person_id FROM saved_views r JOIN selected_people p ON p.id = r.person_id JOIN surviving_events e ON e.id = r.event_id"],
    ["reviewer_track_scopes", "person_id", "SELECT r.id AS row_id, r.event_id, r.person_id FROM reviewer_track_scopes r JOIN selected_people p ON p.id = r.person_id JOIN surviving_events e ON e.id = r.event_id"],
    ["speaker_tasks", "person_id", "SELECT r.id AS row_id, r.event_id, r.person_id FROM speaker_tasks r JOIN selected_people p ON p.id = r.person_id JOIN surviving_events e ON e.id = r.event_id"],
    ["sponsorship_contacts", "person_id", "SELECT r.id AS row_id, e.id AS event_id, r.person_id FROM sponsorship_contacts r JOIN selected_people p ON p.id = r.person_id JOIN sponsorships s ON s.id = r.sponsorship_id JOIN surviving_events e ON e.id = s.event_id"],
    ["submissions", "submitter_person_id", "SELECT r.id AS row_id, r.event_id, r.submitter_person_id AS person_id FROM submissions r JOIN selected_people p ON p.id = r.submitter_person_id JOIN surviving_events e ON e.id = r.event_id"],
    ["submission_decisions", "decided_by_person_id", "SELECT r.id AS row_id, r.event_id, r.decided_by_person_id AS person_id FROM submission_decisions r JOIN selected_people p ON p.id = r.decided_by_person_id JOIN surviving_events e ON e.id = r.event_id"],
    ["participations", "person_id", "SELECT r.id AS row_id, e.id AS event_id, r.person_id FROM participations r JOIN selected_people p ON p.id = r.person_id JOIN submissions s ON s.id = r.submission_id JOIN surviving_events e ON e.id = s.event_id"],
    ["committee_members", "person_id", "SELECT r.id AS row_id, e.id AS event_id, r.person_id FROM committee_members r JOIN selected_people p ON p.id = r.person_id JOIN committees committee ON committee.id = r.committee_id JOIN surviving_events e ON e.id = committee.event_id"],
    ["evaluations", "reviewer_person_id", "SELECT r.id AS row_id, e.id AS event_id, r.reviewer_person_id AS person_id FROM evaluations r JOIN selected_people p ON p.id = r.reviewer_person_id JOIN submissions s ON s.id = r.submission_id JOIN surviving_events e ON e.id = s.event_id"],
    ["round_assignments", "reviewer_person_id", "SELECT r.id AS row_id, e.id AS event_id, r.reviewer_person_id AS person_id FROM round_assignments r JOIN selected_people p ON p.id = r.reviewer_person_id JOIN submissions s ON s.id = r.submission_id JOIN surviving_events e ON e.id = s.event_id"],
    ["round_promotions", "promoted_by", "SELECT r.id AS row_id, e.id AS event_id, r.promoted_by AS person_id FROM round_promotions r JOIN selected_people p ON p.id = r.promoted_by JOIN submissions s ON s.id = r.submission_id JOIN surviving_events e ON e.id = s.event_id"],
    ["comparisons", "reviewer_person_id", "SELECT r.id AS row_id, e.id AS event_id, r.reviewer_person_id AS person_id FROM comparisons r JOIN selected_people p ON p.id = r.reviewer_person_id JOIN evaluation_rounds round ON round.id = r.round_id JOIN evaluation_plans plan ON plan.id = round.plan_id JOIN surviving_events e ON e.id = plan.event_id"],
    ["calendar_invites", "person_id", "SELECT r.id AS row_id, e.id AS event_id, r.person_id FROM calendar_invites r JOIN selected_people p ON p.id = r.person_id JOIN submissions s ON s.id = r.submission_id JOIN surviving_events e ON e.id = s.event_id"],
    ["form_admins", "person_id", "SELECT r.id AS row_id, e.id AS event_id, r.person_id FROM form_admins r JOIN selected_people p ON p.id = r.person_id JOIN forms form ON form.id = r.form_id JOIN surviving_events e ON e.id = form.event_id"],
    ["file_comments", "author_person_id", "SELECT r.id AS row_id, r.event_id, r.author_person_id AS person_id FROM file_comments r JOIN selected_people p ON p.id = r.author_person_id JOIN surviving_events e ON e.id = r.event_id"],
    ["event_attendances", "person_id", "SELECT r.rowid AS row_id, r.event_id, r.person_id FROM event_attendances r JOIN selected_people p ON p.id = r.person_id JOIN surviving_events e ON e.id = r.event_id"],
    ["schedule_claims", "person_id", "SELECT r.code AS row_id, r.event_id, r.person_id FROM schedule_claims r JOIN selected_people p ON p.id = r.person_id JOIN surviving_events e ON e.id = r.event_id"],
    ["outbox", "person_id", "SELECT r.id AS row_id, r.event_id, r.person_id FROM outbox r JOIN selected_people p ON p.id = r.person_id JOIN surviving_events e ON e.id = r.event_id"],
    ["magic_links", "person_id", "SELECT r.id AS row_id, r.event_id, r.person_id FROM magic_links r JOIN selected_people p ON p.id = r.person_id JOIN surviving_events e ON e.id = r.event_id"],
    ["forms.admin_notify_person_ids", "admin_notify_person_ids", "SELECT form.id AS row_id, form.event_id, CAST(json_each.value AS TEXT) AS person_id FROM forms form JOIN surviving_events e ON e.id = form.event_id JOIN json_each(form.admin_notify_person_ids) ON 1 = 1 JOIN selected_people p ON p.id = json_each.value"],
    ["import_rows.target_id", "target_id", "SELECT r.id AS row_id, imports.event_id, r.target_id AS person_id FROM import_rows r JOIN imports ON imports.id = r.import_id JOIN surviving_events e ON e.id = imports.event_id JOIN selected_people p ON p.id = r.target_id WHERE r.entity IN ('person', 'speaker')"],
    ["mirror_outbox.people.row_id", "row_id", "SELECT r.id AS row_id, e.id AS event_id, p.id AS person_id FROM mirror_outbox r JOIN selected_people p ON p.id = r.row_id JOIN surviving_events e ON e.org_id = p.org_id WHERE r.table_name IN ('people', 'person') AND (json_extract(r.payload, '$.event_id') IS NULL OR json_extract(r.payload, '$.event_id') = e.id)"],
    ["audit_log.person.entity_id", "entity_id", "SELECT r.id AS row_id, e.id AS event_id, r.entity_id AS person_id FROM audit_log r JOIN selected_people p ON p.id = r.entity_id JOIN surviving_events e ON e.id = r.event_id WHERE r.entity_type = 'person'"],
  ];
  const bindingList = [...eventBindings, ...eventBindings];
  const results = await Promise.all(checks.map(async ([family, column, query]) => {
    const rows = await db.prepare(scope + " " + query).bind(...bindingList).all<{ row_id: string; event_id: string; person_id: string }>();
    return rows.results.map((row) => ({ family, column, row_id: String(row.row_id), event_id: String(row.event_id), person_id: String(row.person_id), policy: "refuse" as const }));
  }));
  return results.flat().sort((left, right) => (left.family + ":" + left.row_id + ":" + left.person_id).localeCompare(right.family + ":" + right.row_id + ":" + right.person_id));
}

/**
 * Resolve an audit identity from the one auth context used by every route.
 * Bound agent tokens expose their seat directly; a human token retains its
 * issuer in `api_tokens.created_by`.
 */
export async function deletionActorForAuth(
  db: D1Database,
  auth: AuthContext,
  requestId: string | null,
): Promise<EventDeletionActor> {
  if (auth.kind === "session") {
    return { actorKind: "user", actorPersonId: auth.personId, requestId };
  }
  const actorPersonId = auth.actingPersonId ?? (await db
    .prepare("SELECT created_by FROM api_tokens WHERE id = ?")
    .bind(auth.tokenId)
    .first<{ created_by: string }>()
  )?.created_by ?? null;
  return { actorKind: "api_token", actorPersonId, requestId };
}

/**
 * Delete one or more conferences through one shared, children-first cascade.
 * The demo removal path calls this with a broader people policy; it does not
 * maintain a second list of event-owned tables.
 */
export async function deleteEventCascade(
  db: D1Database,
  events: readonly EventRow[],
  actor: EventDeletionActor,
  options: EventDeletionOptions = {},
  media?: R2Bucket,
  now = Date.now(),
): Promise<EventDeletionResult> {
  const uniqueEvents: EventRow[] = [];
  const seenEventIds = new Set<string>();
  for (const event of events) {
    if (seenEventIds.has(event.id)) continue;
    seenEventIds.add(event.id);
    uniqueEvents.push(event);
  }
  const eventIds = uniqueEvents.map((event) => event.id);
  if (eventIds.length === 0) {
    return { removedEvents: 0, removedPeople: 0, removedObjects: 0, removedAt: now };
  }

  // remove-demo has a stronger lifecycle contract than ordinary conference
  // deletion: all selected events are one guarded write boundary, even when
  // there are more ids than one D1 statement can bind. Keep that path separate
  // so the ordinary event cascade can retain its established chunking.
  if (options.removeDemoPeople) {
    return deleteDemoPeopleEventCascade(db, uniqueEvents, actor, media, now);
  }

  if (eventIds.length > EVENT_DELETE_CHUNK) {
    let removedEvents = 0;
    let removedPeople = 0;
    let removedObjects = 0;
    for (let offset = 0; offset < uniqueEvents.length; offset += EVENT_DELETE_CHUNK) {
      const result = await deleteEventCascade(
        db,
        uniqueEvents.slice(offset, offset + EVENT_DELETE_CHUNK),
        actor,
        options,
        media,
        now,
      );
      removedEvents += result.removedEvents;
      removedPeople += result.removedPeople;
      removedObjects += result.removedObjects;
    }
    return { removedEvents, removedPeople, removedObjects, removedAt: now };
  }

  const eventIdsSql = eventFilter(eventIds);
  const eventBindings = [...eventIds];
  const submissionsSql = `(SELECT id FROM submissions WHERE event_id IN ${eventIdsSql})`;
  const plansSql = `(SELECT id FROM evaluation_plans WHERE event_id IN ${eventIdsSql})`;
  const roundsSql = `(SELECT r.id FROM evaluation_rounds r JOIN evaluation_plans p ON p.id = r.plan_id WHERE p.event_id IN ${eventIdsSql})`;
  const committeesSql = `(SELECT id FROM committees WHERE event_id IN ${eventIdsSql})`;
  const formsSql = `(SELECT id FROM forms WHERE event_id IN ${eventIdsSql})`;
  const importsSql = `(SELECT id FROM imports WHERE event_id IN ${eventIdsSql})`;
  const endpointsSql = `(SELECT id FROM webhook_endpoints WHERE event_id IN ${eventIdsSql})`;
  const statements: D1PreparedStatement[] = uniqueEvents.map((event) => auditStatement(db, {
    eventId: event.id,
    actorKind: actor.actorKind,
    actorPersonId: actor.actorPersonId,
    action: "event.deleted",
    entityType: "event",
    entityId: event.id,
    before: event,
    after: { deleted: true },
    now,
    requestId: actor.requestId,
  }));

  // Children before parents. Each event-owned table is represented here,
  // including derived public schedules and the JSON-backed mirror queue.
  statements.push(
    prepared(db, `DELETE FROM webhook_deliveries WHERE endpoint_id IN ${endpointsSql}`, ...eventBindings),
    prepared(db, `DELETE FROM webhook_endpoints WHERE event_id IN ${eventIdsSql}`, ...eventBindings),
    prepared(db, `DELETE FROM submission_notes WHERE submission_id IN ${submissionsSql}`, ...eventBindings),
    prepared(db, `DELETE FROM submission_decisions WHERE event_id IN ${eventIdsSql}`, ...eventBindings),
    prepared(db, `DELETE FROM submission_answers WHERE submission_id IN ${submissionsSql}`, ...eventBindings),
    prepared(db, `DELETE FROM submission_tracks WHERE submission_id IN ${submissionsSql}`, ...eventBindings),
    prepared(db, `DELETE FROM submission_tags WHERE submission_id IN ${submissionsSql}`, ...eventBindings),
    prepared(db, `DELETE FROM submission_arrivals WHERE submission_id IN ${submissionsSql}`, ...eventBindings),
    prepared(db, `DELETE FROM participations WHERE submission_id IN ${submissionsSql}`, ...eventBindings),
    prepared(
      db,
      `DELETE FROM evaluations
       WHERE submission_id IN ${submissionsSql} OR round_id IN ${roundsSql}`,
      ...eventBindings,
      ...eventBindings,
    ),
    prepared(db, `DELETE FROM comparisons WHERE round_id IN ${roundsSql}`, ...eventBindings),
    prepared(
      db,
      `DELETE FROM round_assignments
       WHERE submission_id IN ${submissionsSql} OR round_id IN ${roundsSql}`,
      ...eventBindings,
      ...eventBindings,
    ),
    prepared(
      db,
      `DELETE FROM round_promotions
       WHERE submission_id IN ${submissionsSql}
          OR from_round_id IN ${roundsSql}
          OR to_round_id IN ${roundsSql}`,
      ...eventBindings,
      ...eventBindings,
      ...eventBindings,
    ),
    prepared(db, `DELETE FROM rubric_criteria WHERE round_id IN ${roundsSql}`, ...eventBindings),
    prepared(db, `DELETE FROM evaluation_rounds WHERE plan_id IN ${plansSql}`, ...eventBindings),
    prepared(db, `DELETE FROM evaluation_plans WHERE event_id IN ${eventIdsSql}`, ...eventBindings),
    prepared(db, `DELETE FROM committee_members WHERE committee_id IN ${committeesSql}`, ...eventBindings),
    prepared(db, `DELETE FROM committees WHERE event_id IN ${eventIdsSql}`, ...eventBindings),
    prepared(db, `DELETE FROM reviewer_track_scopes WHERE event_id IN ${eventIdsSql}`, ...eventBindings),
    prepared(db, `DELETE FROM saved_views WHERE event_id IN ${eventIdsSql}`, ...eventBindings),
    prepared(
      db,
      `DELETE FROM request_operation_outbox
       WHERE operation_id IN (
         SELECT operation_id FROM request_operations WHERE event_id IN ${eventIdsSql}
       )`,
      ...eventBindings,
    ),
    prepared(db, `DELETE FROM request_operations WHERE event_id IN ${eventIdsSql}`, ...eventBindings),
    prepared(db, `DELETE FROM file_comments WHERE event_id IN ${eventIdsSql}`, ...eventBindings),
    prepared(
      db,
      `DELETE FROM outbox_calendar_parts
       WHERE outbox_id IN (SELECT id FROM outbox WHERE event_id IN ${eventIdsSql})`,
      ...eventBindings,
    ),
    prepared(db, `DELETE FROM calendar_invites WHERE submission_id IN ${submissionsSql}`, ...eventBindings),
    prepared(db, `DELETE FROM speaker_tasks WHERE event_id IN ${eventIdsSql}`, ...eventBindings),
    prepared(db, `DELETE FROM task_templates WHERE event_id IN ${eventIdsSql}`, ...eventBindings),
    prepared(db, `DELETE FROM agenda_items WHERE event_id IN ${eventIdsSql}`, ...eventBindings),
    // MRQ-208, before the schedules and the people they point at. A claim
    // references both, so deleting either first aborts the whole batch and the
    // conference cannot be deleted at all once one attendee has claimed a
    // schedule.
    prepared(db, `DELETE FROM schedule_claims WHERE event_id IN ${eventIdsSql}`, ...eventBindings),
    prepared(db, `DELETE FROM session_star_beacons WHERE event_id IN ${eventIdsSql}`, ...eventBindings),
    prepared(db, `DELETE FROM event_attendances WHERE event_id IN ${eventIdsSql}`, ...eventBindings),
    prepared(db, `DELETE FROM public_schedules WHERE event_id IN ${eventIdsSql}`, ...eventBindings),
    prepared(db, `DELETE FROM embeds WHERE event_id IN ${eventIdsSql}`, ...eventBindings),
    prepared(db, `DELETE FROM import_rows WHERE import_id IN ${importsSql}`, ...eventBindings),
    prepared(db, `DELETE FROM imports WHERE event_id IN ${eventIdsSql}`, ...eventBindings),
    prepared(db, `DELETE FROM submissions WHERE event_id IN ${eventIdsSql}`, ...eventBindings),
    // MRQ-214, and its position is the whole content of the rule. A sponsorship
    // is referenced from ABOVE by `speaker_tasks.sponsorship_id` and
    // `submissions.sponsorship_id` (both already gone by here) and points DOWN at
    // `buildings(id, event_id)`, `events`, and — through its contacts — `people`.
    // Deleted anywhere else in this list, the batch aborts on a foreign key and
    // the conference cannot be deleted at all once one sponsor exists.
    // `companies` is deliberately absent: it is organization-level and outlives
    // every conference, exactly like `people`.
    prepared(
      db,
      `DELETE FROM sponsorship_contacts
       WHERE sponsorship_id IN (SELECT id FROM sponsorships WHERE event_id IN ${eventIdsSql})`,
      ...eventBindings,
    ),
    prepared(db, `DELETE FROM sponsorships WHERE event_id IN ${eventIdsSql}`, ...eventBindings),
    prepared(db, `DELETE FROM sponsor_tiers WHERE event_id IN ${eventIdsSql}`, ...eventBindings),
    prepared(db, `DELETE FROM form_admins WHERE form_id IN ${formsSql}`, ...eventBindings),
    prepared(db, `DELETE FROM form_length_rules WHERE form_id IN ${formsSql}`, ...eventBindings),
    prepared(db, `DELETE FROM form_fields WHERE form_id IN ${formsSql}`, ...eventBindings),
    prepared(db, `DELETE FROM field_library WHERE event_id IN ${eventIdsSql}`, ...eventBindings),
    prepared(db, `DELETE FROM forms WHERE event_id IN ${eventIdsSql}`, ...eventBindings),
    prepared(db, `DELETE FROM email_templates WHERE event_id IN ${eventIdsSql}`, ...eventBindings),
    // Every auth link created for an event is carried by its outbox row.
    // Delete the token before deleting the outbox receipt that identifies it.
    //
    // Three ways a link can point at this conference, and all three must go or
    // the event row cannot be deleted at all. `invite_event_id` is the one
    // added by SPEC Amendment 21 — an organizer invite scoped to one conference
    // (ruling O4's day-of volunteer). It is a DIFFERENT column from `event_id`
    // on purpose: `event_id` records the conference a credential was issued
    // *for*, while `invite_event_id` records the scope of the membership the
    // link will *mint*, and a scoped invite carries the second without the
    // first. Populating both to make this query simpler would give one fact two
    // homes, which is how the next cascade bug gets written; the cascade knows
    // about the column instead.
    prepared(
      db,
      `DELETE FROM magic_links
       WHERE event_id IN ${eventIdsSql}
          OR invite_event_id IN ${eventIdsSql}
          OR id IN (
            SELECT queued.entity_id
            FROM outbox queued
            WHERE queued.event_id IN ${eventIdsSql}
              AND queued.entity_id IS NOT NULL
              AND EXISTS (
                SELECT 1 FROM magic_links candidate
                WHERE candidate.id = queued.entity_id
                  AND (candidate.redirect_to LIKE '/portal%'
                    OR candidate.redirect_to LIKE '/reviewer%'
                    OR candidate.redirect_to LIKE '/co-speaker%'
                    OR candidate.redirect_to LIKE '/task%')
              )
          )`,
      ...eventBindings,
      ...eventBindings,
      ...eventBindings,
    ),
    prepared(db, `DELETE FROM outbox WHERE event_id IN ${eventIdsSql}`, ...eventBindings),
    prepared(db, `DELETE FROM routing_rules WHERE event_id IN ${eventIdsSql}`, ...eventBindings),
    prepared(db, `DELETE FROM tags WHERE event_id IN ${eventIdsSql}`, ...eventBindings),
    prepared(db, `DELETE FROM levels WHERE event_id IN ${eventIdsSql}`, ...eventBindings),
    prepared(db, `DELETE FROM waves WHERE event_id IN ${eventIdsSql}`, ...eventBindings),
    prepared(db, `DELETE FROM rooms WHERE event_id IN ${eventIdsSql}`, ...eventBindings),
    prepared(db, `DELETE FROM buildings WHERE event_id IN ${eventIdsSql}`, ...eventBindings),
    prepared(db, `DELETE FROM tracks WHERE event_id IN ${eventIdsSql}`, ...eventBindings),
    prepared(db, `DELETE FROM formats WHERE event_id IN ${eventIdsSql}`, ...eventBindings),
    // Plural event grants live in JSON on an organization token. Remove only
    // the deleted conference, preserving the token and every surviving grant.
    prepared(
      db,
      `UPDATE api_tokens
       SET scopes = json_set(
         scopes,
         '$.event_ids',
         json((SELECT COALESCE(json_group_array(value), '[]')
               FROM json_each(api_tokens.scopes, '$.event_ids')
               WHERE value NOT IN ${eventIdsSql}))
       ), updated_at = ?
       WHERE event_id IS NULL
         AND EXISTS (
           SELECT 1 FROM json_each(api_tokens.scopes, '$.event_ids')
           WHERE value IN ${eventIdsSql}
         )`,
      ...eventBindings,
      now,
      ...eventBindings,
    ),
    prepared(
      db,
      `DELETE FROM api_tokens WHERE event_id IN ${eventIdsSql}`,
      ...eventBindings,
    ),
    prepared(db, `DELETE FROM memberships WHERE event_id IN ${eventIdsSql}`, ...eventBindings),
  );

  // Merge receipts are org history, not event children. Deleting an event
  // that contributed movement rows makes a later inverse impossible, so retain
  // the receipt and make that boundary explicit before the event disappears.
  statements.push(
    prepared(
      db,
      "UPDATE person_merges SET status = 'undo_blocked', undo_reason = 'event_deleted', updated_at = ?" +
      " WHERE status = 'clean' AND EXISTS (SELECT 1 FROM json_each(person_merges.event_scope_json) WHERE json_each.value IN " + eventIdsSql + ")",
      now,
      ...eventBindings,
    ),
  );

  if (options.preserveOrgAttachments !== false) {
    // Detach only the organization-level subject before deleting the event;
    // this is the narrow repair for the legacy event_id wart.
    statements.push(
      prepared(
        db,
        `UPDATE attachments SET event_id = NULL
         WHERE event_id IN ${eventIdsSql} AND owner_type = 'person_headshot'`,
        ...eventBindings,
      ),
    );
  }
  statements.push(
    prepared(db, `DELETE FROM attachments WHERE event_id IN ${eventIdsSql}`, ...eventBindings),
    prepared(db, `DELETE FROM event_settings WHERE event_id IN ${eventIdsSql}`, ...eventBindings),
    prepared(
      db,
      `DELETE FROM mirror_outbox
       WHERE json_extract(payload, '$.event_id') IN ${eventIdsSql}
          OR (table_name = 'events' AND row_id IN ${eventIdsSql})`,
      ...eventBindings,
      ...eventBindings,
    ),
    prepared(db, `DELETE FROM events WHERE id IN ${eventIdsSql}`, ...eventBindings),
  );

  const objectRows = media
    ? await db.prepare(
      `SELECT r2_key FROM attachments
       WHERE event_id IN ${eventIdsSql}
         ${options.preserveOrgAttachments !== false ? "AND owner_type <> 'person_headshot'" : ""}`,
    ).bind(...eventBindings).all<{ r2_key: string }>()
    : null;
  await db.batch(statements);
  const removedObjects = media
    ? await deleteCommittedObjectKeys(db, media, objectRows?.results.map((row) => row.r2_key) ?? [])
    : 0;
  return {
    removedEvents: eventIds.length,
    removedPeople: 0,
    removedObjects,
    removedAt: now,
  };
}

/**
 * remove-demo is one guarded write boundary for the complete selected set.
 * Event-owned statements are chunked only to stay below D1's bind limit; all
 * chunks are submitted in one batch and media work happens after its commit.
 */
async function deleteDemoPeopleEventCascade(
  db: D1Database,
  events: readonly EventRow[],
  actor: EventDeletionActor,
  media: R2Bucket | undefined,
  now: number,
): Promise<EventDeletionResult> {
  const eventIds = events.map((event) => event.id);
  const orgIds = [...new Set(events.map((event) => event.org_id))];
  const orgSql = eventFilter(orgIds);
  const selectedPeopleSql = "(SELECT id FROM people WHERE is_demo = 1 AND org_id IN " + orgSql + ")";
  const selectedPeopleBindings = [...orgIds];
  const eventChunks: string[][] = [];
  for (let offset = 0; offset < eventIds.length; offset += EVENT_DELETE_CHUNK) {
    eventChunks.push(eventIds.slice(offset, offset + EVENT_DELETE_CHUNK));
  }

  const blockers = await survivingEventDemoPeopleBlockers(db, eventFilter(eventIds), eventIds);
  if (blockers.length > 0) throw new DemoPeopleRemovalRefusedError(blockers);

  const companyBlockers = await db.prepare(
    [
      "WITH selected_event_orgs AS (SELECT DISTINCT org_id FROM events WHERE id IN " + eventFilter(eventIds) + "),",
      "surviving_events AS (SELECT id, org_id FROM events WHERE org_id IN (SELECT org_id FROM selected_event_orgs) AND id NOT IN " + eventFilter(eventIds) + ")",
      "SELECT 'people.company_id' AS family, 'company_id' AS column, retained.company_id AS row_id, '' AS event_id, retained.id AS person_id",
      "FROM people retained LEFT JOIN companies company ON company.id = retained.company_id",
      "WHERE retained.is_demo = 0 AND retained.org_id IN (SELECT org_id FROM selected_event_orgs) AND retained.company_id IS NOT NULL",
      "AND (company.id IS NULL OR company.org_id <> retained.org_id)",
      "UNION ALL",
      "SELECT 'sponsorships.company_id' AS family, 'company_id' AS column, sponsorship.company_id AS row_id, event.id AS event_id, '' AS person_id",
      "FROM sponsorships sponsorship JOIN surviving_events event ON event.id = sponsorship.event_id",
      "LEFT JOIN companies company ON company.id = sponsorship.company_id",
      "WHERE company.id IS NULL OR company.org_id <> event.org_id",
    ].join(" "),
  ).bind(...eventIds, ...eventIds).all<{ family: string; column: string; row_id: string; event_id: string; person_id: string }>();
  if (companyBlockers.results.length > 0) {
    throw new DemoPeopleRemovalRefusedError(
      companyBlockers.results.map((row) => ({ ...row, policy: "refuse" as const })).sort((left, right) => (left.family + ":" + left.row_id).localeCompare(right.family + ":" + right.row_id)),
      "demo_company_dependency_unresolvable",
    );
  }

  const selectedPeople = await db
    .prepare("SELECT id FROM people WHERE is_demo = 1 AND org_id IN " + orgSql)
    .bind(...selectedPeopleBindings)
    .all<{ id: string }>();
  const selectedPeopleIds = new Set(selectedPeople.results.map((row) => row.id));

  const [companyRows, headshotRows, survivingEvents] = await Promise.all([
    db.prepare(
      "SELECT DISTINCT company.* " +
      "FROM companies company " +
      "WHERE company.is_demo = 1 AND company.org_id IN " + orgSql +
      " AND (EXISTS (SELECT 1 FROM people retained WHERE retained.is_demo = 0 AND retained.org_id = company.org_id AND retained.company_id = company.id)" +
      " OR EXISTS (SELECT 1 FROM sponsorships sponsorship JOIN events conference ON conference.id = sponsorship.event_id" +
      " WHERE sponsorship.company_id = company.id AND conference.org_id = company.org_id AND conference.id NOT IN " + eventFilter(eventIds) + "))",
    ).bind(...orgIds, ...eventIds).all<LifecycleRow>(),
    db.prepare(
      "WITH selected_people AS (SELECT id FROM people WHERE is_demo = 1 AND org_id IN " + orgSql + ") " +
      "SELECT retained.id AS person_id, retained.org_id, attachment.*, attachment.id AS attachment_id " +
      "FROM people retained JOIN attachments attachment ON attachment.id = retained.headshot_attachment_id " +
      "WHERE retained.is_demo = 0 AND retained.org_id IN " + orgSql +
      " AND (attachment.event_id IN " + eventFilter(eventIds) + " OR attachment.owner_id IN (SELECT id FROM selected_people)) " +
      "ORDER BY retained.org_id, retained.id, attachment.id",
    ).bind(...orgIds, ...orgIds, ...eventIds).all<{
      person_id: string;
      org_id: string;
      attachment_id: string;
      owner_type: string;
      owner_id: string;
      event_id: string | null;
      r2_key: string;
    }>(),
    db.prepare(
      "SELECT id, org_id FROM events WHERE org_id IN " + orgSql +
      " AND id NOT IN " + eventFilter(eventIds) + " ORDER BY created_at ASC, id ASC",
    ).bind(...orgIds, ...eventIds).all<{ id: string; org_id: string }>(),
  ]);

  const survivingEventByOrg = new Map<string, string>();
  for (const row of survivingEvents.results) {
    if (!survivingEventByOrg.has(row.org_id)) survivingEventByOrg.set(row.org_id, row.id);
  }
  const retainedHeadshots = new Map<string, (typeof headshotRows.results)[number]>();
  const headshotBlockers: DemoPeopleRemovalBlocker[] = [];
  for (const row of headshotRows.results) {
    const previous = retainedHeadshots.get(row.attachment_id);
    if (previous && previous.person_id !== row.person_id) {
      headshotBlockers.push({
        family: "attachments.person_headshot",
        column: "headshot_attachment_id",
        row_id: row.attachment_id,
        event_id: row.event_id ?? "",
        person_id: row.person_id,
        policy: "refuse",
      });
      continue;
    }
    retainedHeadshots.set(row.attachment_id, row);
    const ownerIsSelected = selectedPeopleIds.has(row.owner_id);
    if (row.owner_type !== "person_headshot" || (!ownerIsSelected && row.owner_id !== row.person_id)) {
      headshotBlockers.push({
        family: "attachments.person_headshot",
        column: "owner_id",
        row_id: row.attachment_id,
        event_id: row.event_id ?? "",
        person_id: row.person_id,
        policy: "refuse",
      });
      continue;
    }
    if (!survivingEventByOrg.has(row.org_id)) {
      headshotBlockers.push({
        family: "attachments.person_headshot",
        column: "event_id",
        row_id: row.attachment_id,
        event_id: row.event_id ?? "",
        person_id: row.person_id,
        policy: "refuse",
      });
    }
  }
  if (headshotBlockers.length > 0) {
    throw new DemoPeopleRemovalRefusedError(
      headshotBlockers.sort((left, right) => (left.family + ":" + left.row_id).localeCompare(right.family + ":" + right.row_id)),
      "demo_headshot_dependency_unresolvable",
    );
  }

  // Capture every nullable actor/control row that the destructive cleanup will
  // retain. These snapshots are either appended to the owning merge receipt or
  // written as a cleanup audit row below, before the one guarded batch begins.
  const [cleanMergeReceipts, credentialRows, tokenRows, personEventRows, personListRows, auditRows, taskRows, submissionRows, evaluationRows] = await Promise.all([
    db.prepare("SELECT * FROM person_merges WHERE status = 'clean' AND org_id IN " + orgSql).bind(...orgIds).all<LifecycleRow>(),
    db.prepare("SELECT * FROM mirror_credentials WHERE org_id IN " + orgSql + " AND set_by_person_id IN " + selectedPeopleSql).bind(...orgIds, ...orgIds).all<LifecycleRow>(),
    db.prepare(
      "SELECT * FROM api_tokens WHERE org_id IN " + orgSql +
      " AND acts_as_person_id IN " + selectedPeopleSql +
      " AND created_by NOT IN " + selectedPeopleSql +
      " AND (event_id IS NULL OR event_id NOT IN " + eventFilter(eventIds) + ")",
    ).bind(...orgIds, ...orgIds, ...orgIds, ...eventIds).all<LifecycleRow>(),
    db.prepare(
      "SELECT * FROM person_events WHERE org_id IN " + orgSql +
      " AND person_id NOT IN " + selectedPeopleSql +
      " AND actor_person_id IN " + selectedPeopleSql,
    ).bind(...orgIds, ...orgIds, ...orgIds).all<LifecycleRow>(),
    db.prepare(
      "SELECT * FROM person_lists WHERE org_id IN " + orgSql +
      " AND created_by IN " + selectedPeopleSql,
    ).bind(...orgIds, ...orgIds).all<LifecycleRow>(),
    db.prepare(
      "SELECT * FROM audit_log WHERE org_id IN " + orgSql +
      " AND actor_person_id IN " + selectedPeopleSql +
      " AND NOT (entity_type = 'person' AND entity_id IN " + selectedPeopleSql + ")",
    ).bind(...orgIds, ...orgIds, ...orgIds).all<LifecycleRow>(),
    db.prepare(
      "SELECT * FROM speaker_tasks WHERE event_id NOT IN " + eventFilter(eventIds) +
      " AND completed_by_person_id IN " + selectedPeopleSql +
      " AND person_id NOT IN " + selectedPeopleSql,
    ).bind(...eventIds, ...orgIds, ...orgIds).all<LifecycleRow>(),
    db.prepare(
      "SELECT * FROM submissions WHERE event_id NOT IN " + eventFilter(eventIds) +
      " AND decided_by_person_id IN " + selectedPeopleSql +
      " AND submitter_person_id NOT IN " + selectedPeopleSql,
    ).bind(...eventIds, ...orgIds, ...orgIds).all<LifecycleRow>(),
    db.prepare(
      "SELECT evaluation.* FROM evaluations evaluation " +
      "WHERE evaluation.override_person_id IN " + selectedPeopleSql +
      " AND evaluation.reviewer_person_id NOT IN " + selectedPeopleSql +
      " AND NOT EXISTS (SELECT 1 FROM submissions submission WHERE submission.id = evaluation.submission_id AND submission.event_id IN " + eventFilter(eventIds) + ")" +
      " AND NOT EXISTS (SELECT 1 FROM evaluation_rounds round JOIN evaluation_plans plan ON plan.id = round.plan_id WHERE round.id = evaluation.round_id AND plan.event_id IN " + eventFilter(eventIds) + ")",
    ).bind(...orgIds, ...orgIds, ...eventIds, ...eventIds).all<LifecycleRow>(),
  ]);

  const cleanupReferences = new Map<string, CleanupReference>();
  const addCleanupReference = (table: string, row: LifecycleRow, columns: readonly string[]) => {
    const key = `${table}:${lifecycleKey(row)}`;
    const existing = cleanupReferences.get(key);
    const after = existing?.after ?? cloneLifecycle(row);
    for (const column of columns) after[column] = null;
    cleanupReferences.set(key, { table, row: existing?.row ?? row, after });
  };
  for (const row of credentialRows.results) addCleanupReference("mirror_credentials", row, ["set_by_person_id"]);
  for (const row of tokenRows.results) addCleanupReference("api_tokens", row, ["acts_as_person_id"]);
  for (const row of personEventRows.results) addCleanupReference("person_events", row, ["actor_person_id"]);
  for (const row of personListRows.results) addCleanupReference("person_lists", row, ["created_by"]);
  for (const row of auditRows.results) addCleanupReference("audit_log", row, ["actor_person_id"]);
  for (const row of taskRows.results) addCleanupReference("speaker_tasks", row, ["completed_by_person_id"]);
  for (const row of submissionRows.results) addCleanupReference("submissions", row, ["decided_by_person_id"]);
  for (const row of evaluationRows.results) addCleanupReference("evaluations", row, ["override_person_id"]);

  const dependencyReferences: CleanupReference[] = [];
  for (const row of companyRows.results) {
    const after = cloneLifecycle(row);
    after.is_demo = 0;
    after.last_write_source = "marquee";
    after.updated_at = now;
    dependencyReferences.push({ table: "companies", row, after });
  }
  for (const row of retainedHeadshots.values()) {
    const eventId = survivingEventByOrg.get(row.org_id);
    if (!eventId) continue;
    const before = row as unknown as LifecycleRow;
    const after = cloneLifecycle(before);
    after.owner_id = row.person_id;
    after.event_id = eventId;
    after.updated_at = now;
    dependencyReferences.push({ table: "attachments", row: before, after });
  }

  const receiptEdits = new Map<string, { row: LifecycleRow; movements: LifecycleRow[]; summary: LifecycleRow }>();
  const receiptMovementKeys = (receipt: LifecycleRow): Set<string> => {
    try {
      const movements = JSON.parse(String(receipt.movement_receipts_json ?? "[]")) as Array<{ table?: string; primary_key?: string }>;
      return new Set(movements.map((movement) => `${movement.table}:${movement.primary_key}`));
    } catch {
      return new Set();
    }
  };
  const receiptOwns = (receipt: LifecycleRow, reference: CleanupReference): boolean => {
    const key = `${reference.table}:${lifecycleKey(reference.row)}`;
    if (receiptMovementKeys(receipt).has(key)) return true;
    if (reference.table === "companies" || reference.table === "attachments") {
      try {
        const survivorAfter = JSON.parse(String(receipt.survivor_after_json ?? "{}")) as Record<string, unknown>;
        return reference.table === "companies"
          ? survivorAfter.company_id === reference.row.id
          : survivorAfter.headshot_attachment_id === (reference.row.id ?? reference.row.attachment_id);
      } catch {
        return false;
      }
    }
    return false;
  };
  const appendReceiptMovement = (receipt: LifecycleRow, reference: CleanupReference) => {
    const existing = receiptEdits.get(String(receipt.id));
    const movements = existing?.movements ?? (JSON.parse(String(receipt.movement_receipts_json ?? "[]")) as LifecycleRow[]);
    const alreadyAppended = movements.some((movement) => movement.table === reference.table && movement.primary_key === lifecycleKey(reference.row) && movement.reason === "remove_demo_clear");
    if (!alreadyAppended) {
      movements.push({
        table: reference.table,
        primary_key: lifecycleKey(reference.row),
        from: cloneLifecycle(reference.row),
        to: cloneLifecycle(reference.after),
        snapshot: cloneLifecycle(reference.row),
        outcome: "moved",
        reason: reference.table === "companies" || reference.table === "attachments" ? "remove_demo_dependency_retained" : "remove_demo_clear",
      });
    }
    const summary = existing?.summary ?? (JSON.parse(String(receipt.summary_json ?? "{}")) as LifecycleRow);
    summary.moved = Number(summary.moved ?? 0) + (alreadyAppended ? 0 : 1);
    const references = (summary.references ?? {}) as Record<string, number>;
    references[reference.table] = Number(references[reference.table] ?? 0) + (alreadyAppended ? 0 : 1);
    summary.references = references;
    receiptEdits.set(String(receipt.id), { row: receipt, movements, summary });
  };
  const ownedReferences = new Set<string>();
  for (const reference of [...cleanupReferences.values(), ...dependencyReferences]) {
    const owner = cleanMergeReceipts.results.find((receipt) => receiptOwns(receipt, reference));
    if (owner) {
      appendReceiptMovement(owner, reference);
      ownedReferences.add(`${reference.table}:${lifecycleKey(reference.row)}`);
    }
  }

  const objectKeyRows = media
    ? await db.prepare(
      "SELECT id, r2_key FROM attachments WHERE event_id IN " + eventFilter(eventIds) +
      " OR (owner_type = 'person_headshot' AND owner_id IN " + selectedPeopleSql + ")",
    ).bind(...eventIds, ...selectedPeopleBindings).all<{ id: string; r2_key: string }>()
    : null;
  const retainedHeadshotIds = new Set(retainedHeadshots.keys());
  const exactObjectKeys = (objectKeyRows?.results ?? [])
    .filter((row) => !retainedHeadshotIds.has(row.id))
    .map((row) => row.r2_key);

  const statements: D1PreparedStatement[] = events.map((event) => auditStatement(db, {
    eventId: event.id,
    actorKind: actor.actorKind,
    actorPersonId: actor.actorPersonId,
    action: "event.deleted",
    entityType: "event",
    entityId: event.id,
    before: event,
    after: { deleted: true },
    now,
    requestId: actor.requestId,
  }));

  for (const edit of receiptEdits.values()) {
    const undoResult = {
      merge_id: String(edit.row.id),
      status: "undo_blocked",
      restored: 0,
      skipped: 0,
      skipped_rows: [],
      reason: "demo_person_removed",
    };
    statements.push(prepared(
      db,
      "UPDATE person_merges SET status = 'undo_blocked', undo_reason = 'demo_person_removed', undo_result_json = ?, movement_receipts_json = ?, summary_json = ?, updated_at = ? WHERE id = ? AND status = 'clean'",
      JSON.stringify(undoResult),
      JSON.stringify(edit.movements),
      JSON.stringify(edit.summary),
      now,
      edit.row.id,
    ));
  }
  for (const reference of [...cleanupReferences.values(), ...dependencyReferences]) {
    if (ownedReferences.has(`${reference.table}:${lifecycleKey(reference.row)}`)) continue;
    statements.push(auditStatement(db, {
      eventId: null,
      orgId: String(reference.row.org_id ?? orgIds[0]),
      actorKind: actor.actorKind,
      actorPersonId: actor.actorPersonId,
      action: "person.demo_cleanup",
      entityType: reference.table,
      entityId: lifecycleKey(reference.row),
      before: reference.row,
      after: reference.after,
      now,
      requestId: actor.requestId,
    }));
  }

  if (companyRows.results.length > 0) {
    statements.push(
      prepared(
        db,
        "UPDATE companies SET is_demo = 0, last_write_source = 'marquee', updated_at = ? WHERE id IN " + eventFilter(companyRows.results.map((row) => String(row.id))),
        now,
        ...companyRows.results.map((row) => String(row.id)),
      ),
    );
  }
  for (const row of retainedHeadshots.values()) {
    const eventId = survivingEventByOrg.get(row.org_id);
    if (!eventId) continue;
    statements.push(prepared(
      db,
      "UPDATE attachments SET owner_id = ?, event_id = ?, updated_at = ? WHERE id = ?",
      row.person_id,
      eventId,
      now,
      row.attachment_id,
    ));
  }

  statements.push(
    prepared(
      db,
      "UPDATE person_merges SET status = 'undo_blocked', undo_reason = 'demo_person_removed', updated_at = ?" +
      " WHERE status = 'clean' AND org_id IN " + orgSql +
      " AND (retired_person_id IN " + selectedPeopleSql +
      " OR survivor_person_id IN " + selectedPeopleSql +
      " OR EXISTS (SELECT 1 FROM json_each(person_merges.event_scope_json) WHERE json_each.value IN " + eventFilter(eventIds) + "))",
      now,
      ...orgIds,
      ...selectedPeopleBindings,
      ...selectedPeopleBindings,
      ...eventIds,
    ),
  );

  for (const chunk of eventChunks) statements.push(...eventOwnedStatements(db, chunk, now));

  statements.push(
    prepared(db, "UPDATE mirror_credentials SET set_by_person_id = NULL, updated_at = ? WHERE org_id IN " + orgSql + " AND set_by_person_id IN " + selectedPeopleSql, now, ...orgIds, ...selectedPeopleBindings),
    prepared(db, "UPDATE api_tokens SET acts_as_person_id = NULL, updated_at = ? WHERE org_id IN " + orgSql + " AND acts_as_person_id IN " + selectedPeopleSql, now, ...orgIds, ...selectedPeopleBindings),
    prepared(db, "DELETE FROM magic_links WHERE person_id IN " + selectedPeopleSql, ...selectedPeopleBindings),
    prepared(db, "DELETE FROM auth_sessions WHERE person_id IN " + selectedPeopleSql, ...selectedPeopleBindings),
    prepared(db, "DELETE FROM api_tokens WHERE created_by IN " + selectedPeopleSql, ...selectedPeopleBindings),
    prepared(db, "DELETE FROM memberships WHERE person_id IN " + selectedPeopleSql, ...selectedPeopleBindings),
    prepared(db, "DELETE FROM person_list_members WHERE person_id IN " + selectedPeopleSql, ...selectedPeopleBindings),
    prepared(db, "DELETE FROM person_aliases WHERE person_id IN " + selectedPeopleSql, ...selectedPeopleBindings),
    prepared(db, "UPDATE person_events SET actor_person_id = NULL WHERE actor_person_id IN " + selectedPeopleSql + " AND person_id NOT IN " + selectedPeopleSql, ...selectedPeopleBindings, ...selectedPeopleBindings),
    prepared(db, "DELETE FROM person_events WHERE person_id IN " + selectedPeopleSql, ...selectedPeopleBindings),
    prepared(db, "UPDATE person_lists SET created_by = NULL WHERE created_by IN " + selectedPeopleSql, ...selectedPeopleBindings),
    prepared(db, "UPDATE audit_log SET actor_person_id = NULL WHERE actor_person_id IN " + selectedPeopleSql, ...selectedPeopleBindings),
    prepared(db, "DELETE FROM audit_log WHERE entity_type = 'person' AND entity_id IN " + selectedPeopleSql, ...selectedPeopleBindings),
    prepared(db, "DELETE FROM mirror_outbox WHERE table_name IN ('people', 'person') AND row_id IN " + selectedPeopleSql, ...selectedPeopleBindings),
    prepared(db, "UPDATE speaker_tasks SET completed_by_person_id = NULL, updated_at = ? WHERE completed_by_person_id IN " + selectedPeopleSql, now, ...selectedPeopleBindings),
    prepared(db, "UPDATE submissions SET decided_by_person_id = NULL, updated_at = ? WHERE decided_by_person_id IN " + selectedPeopleSql, now, ...selectedPeopleBindings),
    prepared(db, "UPDATE evaluations SET override_person_id = NULL, updated_at = ? WHERE override_person_id IN " + selectedPeopleSql, now, ...selectedPeopleBindings),
    prepared(db, "UPDATE people SET headshot_attachment_id = NULL WHERE id IN " + selectedPeopleSql, ...selectedPeopleBindings),
  );
  for (const chunk of eventChunks) {
    statements.push(prepared(
      db,
      "DELETE FROM attachments WHERE event_id IN " + eventFilter(chunk) +
      " OR (owner_type = 'person_headshot' AND owner_id IN " + selectedPeopleSql + ")",
      ...chunk,
      ...selectedPeopleBindings,
    ));
  }
  statements.push(
    prepared(
      db,
      "DELETE FROM people WHERE is_demo = 1 AND org_id IN " + orgSql + " AND " + noPersonReferencesPredicate(),
      ...selectedPeopleBindings,
    ),
    prepared(
      db,
      "DELETE FROM companies WHERE is_demo = 1 AND org_id IN " + orgSql +
      " AND NOT EXISTS (SELECT 1 FROM people retained WHERE retained.company_id = companies.id)" +
      " AND NOT EXISTS (SELECT 1 FROM sponsorships sponsorship WHERE sponsorship.company_id = companies.id)",
      ...selectedPeopleBindings,
    ),
  );
  for (const chunk of eventChunks) {
    statements.push(
      prepared(db, "DELETE FROM event_settings WHERE event_id IN " + eventFilter(chunk), ...chunk),
      prepared(
        db,
        "DELETE FROM mirror_outbox WHERE json_extract(payload, '$.event_id') IN " + eventFilter(chunk) +
        " OR (table_name = 'events' AND row_id IN " + eventFilter(chunk) + ")",
        ...chunk,
        ...chunk,
      ),
      prepared(db, "DELETE FROM events WHERE id IN " + eventFilter(chunk), ...chunk),
    );
  }

  const removedPeople = selectedPeople.results.length;
  await db.batch(statements);
  const removedObjects = media ? await deleteCommittedObjectKeys(db, media, exactObjectKeys) : 0;
  return { removedEvents: eventIds.length, removedPeople, removedObjects, removedAt: now };
}

function eventOwnedStatements(
  db: D1Database,
  eventIds: readonly string[],
  now: number,
): D1PreparedStatement[] {
  const eventIdsSql = eventFilter(eventIds);
  const bindings = [...eventIds];
  const submissionsSql = "(SELECT id FROM submissions WHERE event_id IN " + eventIdsSql + ")";
  const plansSql = "(SELECT id FROM evaluation_plans WHERE event_id IN " + eventIdsSql + ")";
  const roundsSql = "(SELECT r.id FROM evaluation_rounds r JOIN evaluation_plans p ON p.id = r.plan_id WHERE p.event_id IN " + eventIdsSql + ")";
  const committeesSql = "(SELECT id FROM committees WHERE event_id IN " + eventIdsSql + ")";
  const formsSql = "(SELECT id FROM forms WHERE event_id IN " + eventIdsSql + ")";
  const importsSql = "(SELECT id FROM imports WHERE event_id IN " + eventIdsSql + ")";
  const endpointsSql = "(SELECT id FROM webhook_endpoints WHERE event_id IN " + eventIdsSql + ")";
  return [
    prepared(db, "DELETE FROM webhook_deliveries WHERE endpoint_id IN " + endpointsSql, ...bindings),
    prepared(db, "DELETE FROM webhook_endpoints WHERE event_id IN " + eventIdsSql, ...bindings),
    prepared(db, "DELETE FROM submission_notes WHERE submission_id IN " + submissionsSql, ...bindings),
    prepared(db, "DELETE FROM submission_decisions WHERE event_id IN " + eventIdsSql, ...bindings),
    prepared(db, "DELETE FROM submission_answers WHERE submission_id IN " + submissionsSql, ...bindings),
    prepared(db, "DELETE FROM submission_tracks WHERE submission_id IN " + submissionsSql, ...bindings),
    prepared(db, "DELETE FROM participations WHERE submission_id IN " + submissionsSql, ...bindings),
    prepared(db, "DELETE FROM evaluations WHERE submission_id IN " + submissionsSql + " OR round_id IN " + roundsSql, ...bindings, ...bindings),
    prepared(db, "DELETE FROM comparisons WHERE round_id IN " + roundsSql, ...bindings),
    prepared(db, "DELETE FROM round_assignments WHERE submission_id IN " + submissionsSql + " OR round_id IN " + roundsSql, ...bindings, ...bindings),
    prepared(db, "DELETE FROM round_promotions WHERE submission_id IN " + submissionsSql + " OR from_round_id IN " + roundsSql + " OR to_round_id IN " + roundsSql, ...bindings, ...bindings, ...bindings),
    prepared(db, "DELETE FROM rubric_criteria WHERE round_id IN " + roundsSql, ...bindings),
    prepared(db, "DELETE FROM evaluation_rounds WHERE plan_id IN " + plansSql, ...bindings),
    prepared(db, "DELETE FROM evaluation_plans WHERE event_id IN " + eventIdsSql, ...bindings),
    prepared(db, "DELETE FROM committee_members WHERE committee_id IN " + committeesSql, ...bindings),
    prepared(db, "DELETE FROM committees WHERE event_id IN " + eventIdsSql, ...bindings),
    prepared(db, "DELETE FROM reviewer_track_scopes WHERE event_id IN " + eventIdsSql, ...bindings),
    prepared(db, "DELETE FROM saved_views WHERE event_id IN " + eventIdsSql, ...bindings),
    prepared(db, "DELETE FROM file_comments WHERE event_id IN " + eventIdsSql, ...bindings),
    prepared(db, "DELETE FROM calendar_invites WHERE submission_id IN " + submissionsSql, ...bindings),
    prepared(db, "DELETE FROM speaker_tasks WHERE event_id IN " + eventIdsSql, ...bindings),
    prepared(db, "DELETE FROM task_templates WHERE event_id IN " + eventIdsSql, ...bindings),
    prepared(db, "DELETE FROM agenda_items WHERE event_id IN " + eventIdsSql, ...bindings),
    prepared(db, "DELETE FROM schedule_claims WHERE event_id IN " + eventIdsSql, ...bindings),
    prepared(db, "DELETE FROM session_star_beacons WHERE event_id IN " + eventIdsSql, ...bindings),
    prepared(db, "DELETE FROM event_attendances WHERE event_id IN " + eventIdsSql, ...bindings),
    prepared(db, "DELETE FROM public_schedules WHERE event_id IN " + eventIdsSql, ...bindings),
    prepared(db, "DELETE FROM embeds WHERE event_id IN " + eventIdsSql, ...bindings),
    prepared(db, "DELETE FROM import_rows WHERE import_id IN " + importsSql, ...bindings),
    prepared(db, "DELETE FROM imports WHERE event_id IN " + eventIdsSql, ...bindings),
    prepared(db, "DELETE FROM submissions WHERE event_id IN " + eventIdsSql, ...bindings),
    prepared(db, "DELETE FROM sponsorship_contacts WHERE sponsorship_id IN (SELECT id FROM sponsorships WHERE event_id IN " + eventIdsSql + ")", ...bindings),
    prepared(db, "DELETE FROM sponsorships WHERE event_id IN " + eventIdsSql, ...bindings),
    prepared(db, "DELETE FROM sponsor_tiers WHERE event_id IN " + eventIdsSql, ...bindings),
    prepared(db, "DELETE FROM form_admins WHERE form_id IN " + formsSql, ...bindings),
    prepared(db, "DELETE FROM form_fields WHERE form_id IN " + formsSql, ...bindings),
    prepared(db, "DELETE FROM forms WHERE event_id IN " + eventIdsSql, ...bindings),
    prepared(db, "DELETE FROM email_templates WHERE event_id IN " + eventIdsSql, ...bindings),
    prepared(db, "DELETE FROM magic_links WHERE event_id IN " + eventIdsSql + " OR invite_event_id IN " + eventIdsSql + " OR id IN (SELECT queued.entity_id FROM outbox queued WHERE queued.event_id IN " + eventIdsSql + " AND queued.entity_id IS NOT NULL)", ...bindings, ...bindings, ...bindings),
    prepared(db, "DELETE FROM outbox WHERE event_id IN " + eventIdsSql, ...bindings),
    prepared(db, "DELETE FROM routing_rules WHERE event_id IN " + eventIdsSql, ...bindings),
    prepared(db, "DELETE FROM waves WHERE event_id IN " + eventIdsSql, ...bindings),
    prepared(db, "DELETE FROM rooms WHERE event_id IN " + eventIdsSql, ...bindings),
    prepared(db, "DELETE FROM buildings WHERE event_id IN " + eventIdsSql, ...bindings),
    prepared(db, "DELETE FROM tracks WHERE event_id IN " + eventIdsSql, ...bindings),
    prepared(db, "DELETE FROM formats WHERE event_id IN " + eventIdsSql, ...bindings),
    prepared(db, "UPDATE api_tokens SET scopes = json_set(scopes, '$.event_ids', json((SELECT COALESCE(json_group_array(value), '[]') FROM json_each(api_tokens.scopes, '$.event_ids') WHERE value NOT IN " + eventIdsSql + "))), updated_at = ? WHERE event_id IS NULL AND EXISTS (SELECT 1 FROM json_each(api_tokens.scopes, '$.event_ids') WHERE value IN " + eventIdsSql + ")", ...bindings, now, ...bindings),
    prepared(db, "DELETE FROM api_tokens WHERE event_id IN " + eventIdsSql, ...bindings),
    prepared(db, "DELETE FROM memberships WHERE event_id IN " + eventIdsSql, ...bindings),
  ];
}

async function deleteCommittedObjectKeys(
  db: D1Database,
  media: R2Bucket,
  keys: readonly string[],
): Promise<number> {
  const uniqueKeys = [...new Set(keys)];
  const stillReferenced = new Set<string>();
  for (let offset = 0; offset < uniqueKeys.length; offset += 90) {
    const chunk = uniqueKeys.slice(offset, offset + 90);
    const rows = await db.prepare("SELECT r2_key FROM attachments WHERE r2_key IN " + eventFilter(chunk)).bind(...chunk).all<{ r2_key: string }>();
    for (const row of rows.results) stillReferenced.add(row.r2_key);
  }
  const deletable = uniqueKeys.filter((key) => !stillReferenced.has(key));
  let deleted = 0;
  for (let offset = 0; offset < deletable.length; offset += R2_DELETE_CHUNK) {
    const chunk = deletable.slice(offset, offset + R2_DELETE_CHUNK);
    if (chunk.length === 0) continue;
    await media.delete(chunk);
    deleted += chunk.length;
  }
  return deleted;
}
