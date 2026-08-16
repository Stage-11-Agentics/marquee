import type { AuthContext } from "../auth/scope-resolution";
import { auditStatement } from "../audit";
import type { AuditActorKind, EventRow } from "../../db/schema";

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
  const demoPeopleSql = `(SELECT id FROM people WHERE is_demo = 1 AND org_id IN (SELECT org_id FROM events WHERE id IN ${eventIdsSql}))`;

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

  if (options.removeDemoPeople) {
    statements.push(
      prepared(db, `DELETE FROM magic_links WHERE person_id IN ${demoPeopleSql}`, ...eventBindings),
      prepared(db, `DELETE FROM auth_sessions WHERE person_id IN ${demoPeopleSql}`, ...eventBindings),
      prepared(db, `DELETE FROM api_tokens WHERE created_by IN ${demoPeopleSql}`, ...eventBindings),
      prepared(db, `DELETE FROM memberships WHERE person_id IN ${demoPeopleSql}`, ...eventBindings),
      prepared(db, `DELETE FROM person_list_members WHERE person_id IN ${demoPeopleSql}`, ...eventBindings),
      prepared(
        db,
        `DELETE FROM person_events WHERE person_id IN ${demoPeopleSql} OR actor_person_id IN ${demoPeopleSql}`,
        ...eventBindings,
        ...eventBindings,
      ),
      prepared(db, `UPDATE person_lists SET created_by = NULL WHERE created_by IN ${demoPeopleSql}`, ...eventBindings),
      // Demo people can be deleted only after their FK is severed. Migration
      // 0021 snapshots actor_name when the fact is written, so this removes a
      // referential link without rewriting the fact's authorship or its copy.
      prepared(db, `UPDATE audit_log SET actor_person_id = NULL WHERE actor_person_id IN ${demoPeopleSql}`, ...eventBindings),
      prepared(db, `DELETE FROM people WHERE id IN ${demoPeopleSql}`, ...eventBindings),
      // Demo companies go with the demo people, and only after them:
      // `people.company_id` points here, so the other order aborts the batch.
      // This is the `is_demo` symmetry the cascade contract asks for — a demo
      // removal that left seeded companies behind would leave the CRM's second
      // noun holding rows nothing references.
      prepared(
        db,
        `DELETE FROM companies
         WHERE is_demo = 1 AND org_id IN (SELECT org_id FROM events WHERE id IN ${eventIdsSql})`,
        ...eventBindings,
      ),
    );
  }

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

  const removedPeople = options.removeDemoPeople
    ? await db.prepare(`SELECT COUNT(*) AS total FROM people WHERE id IN ${demoPeopleSql}`).bind(...eventBindings).first<{ total: number }>()
    : null;
  const removedObjects = media
    ? await deleteEventObjects(db, media, eventIds, options.preserveOrgAttachments !== false)
    : 0;

  await db.batch(statements);
  return {
    removedEvents: eventIds.length,
    removedPeople: Number(removedPeople?.total ?? 0),
    removedObjects,
    removedAt: now,
  };
}

async function deleteEventObjects(
  db: D1Database,
  media: R2Bucket,
  eventIds: readonly string[],
  preserveOrgAttachments: boolean,
): Promise<number> {
  const eventIdsSql = eventFilter(eventIds);
  const rows = await db.prepare(
    `SELECT r2_key FROM attachments
     WHERE event_id IN ${eventIdsSql}
       ${preserveOrgAttachments ? "AND owner_type <> 'person_headshot'" : ""}`,
  ).bind(...eventIds).all<{ r2_key: string }>();
  let removed = 0;
  for (let offset = 0; offset < rows.results.length; offset += R2_DELETE_CHUNK) {
    const keys = rows.results.slice(offset, offset + R2_DELETE_CHUNK).map((row) => row.r2_key);
    if (keys.length === 0) continue;
    await media.delete(keys);
    removed += keys.length;
  }
  return removed;
}
