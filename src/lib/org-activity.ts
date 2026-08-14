/**
 * The organization-level writer and reader for `audit_log` — the seam every
 * admin action records through, and the two lenses that read it back.
 *
 * There is one log. The org admin lens, the person's feed, and the submission
 * timeline are three queries against it, never three tables. What makes that
 * work in practice is this file being the only place an org-level action is
 * written: a writer that reaches for `auditStatement` directly has to decide
 * for itself what `org_id` means, and the first one that decides differently is
 * the first row that falls out of the lens without anyone noticing.
 *
 * **The org lens is `org_id = ?`, not a list of action names.** Actions land
 * here from tickets this file has never met — organization defaults, ownership
 * transfer — and a lens filtered on a hardcoded vocabulary would silently omit
 * every one of them until someone remembered to edit the filter. Setting the
 * scope is the writer's one obligation; being complete is then the reader's
 * guarantee rather than the reader's chore.
 */
import type { AuditActorKind } from "../db/schema";
import { auditStatement, type AuditEntry } from "./audit";
import { describeActivity, type ActivityLine } from "./activity-copy";
import type { AuthContext } from "./auth/scope-resolution";

/**
 * An org-level audit entry. Identical to `AuditEntry` except that the
 * organization is required and the conference is optional — which is precisely
 * the inversion that made the org lens impossible before MRQ-211.
 */
export type OrgActivityEntry = Omit<AuditEntry, "eventId" | "orgId"> & {
  orgId: string;
  /** Set when the action is scoped to one conference — an event-scoped invite. */
  eventId?: string | null;
};

/**
 * Compose the row into a caller's `batch()`. Prefer this over
 * `recordOrgActivity` wherever the change itself is batched: an organizer
 * removal that ends access in one transaction and records it in another can
 * report a removal that did not happen, or hide one that did.
 */
export function orgActivityStatement(db: D1Database, entry: OrgActivityEntry): D1PreparedStatement {
  return auditStatement(db, { ...entry, eventId: entry.eventId ?? null, orgId: entry.orgId });
}

/** Write one org-level row immediately. */
export async function recordOrgActivity(db: D1Database, entry: OrgActivityEntry): Promise<void> {
  await orgActivityStatement(db, entry).run();
}

/**
 * Who to credit, from the credential that made the request.
 *
 * A bearer token is credited to the seat it acts as, not to the person who
 * issued it months ago: the log answers "who did this", and an unbound token
 * genuinely has no person behind it — saying so beats naming someone who was
 * asleep. `actor_kind` keeps the distinction visible either way.
 */
export function orgActor(auth: AuthContext): { actorKind: AuditActorKind; actorPersonId: string | null } {
  if (auth.kind === "session") return { actorKind: "user", actorPersonId: auth.personId };
  return { actorKind: "api_token", actorPersonId: auth.actingPersonId ?? null };
}

/** One row of any lens: the fact, who did it, when, and what it was about. */
export interface ActivityEvent extends ActivityLine {
  id: string;
  action: string;
  actor_kind: string | null;
  actor_person_id: string | null;
  /** Null when the actor is not a person — a cron sweep, an import, a token. */
  actor_name: string | null;
  created_at: number;
  entity_type: string;
  entity_id: string;
  /** Null for an action about the organization itself. */
  event_id: string | null;
  event_name: string | null;
}

interface ActivityRow {
  id: string;
  action: string;
  actor_kind: string | null;
  actor_person_id: string | null;
  actor_name: string | null;
  created_at: number;
  before_json: string | null;
  after_json: string | null;
  entity_type: string;
  entity_id: string;
  event_id: string | null;
  event_name: string | null;
}

function parseJson(value: string | null): unknown {
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

/**
 * Row → line. The sentence is composed on the server so the page and an agent
 * reading the same endpoint get the same account, and so a second surface
 * cannot drift into its own wording for a row both are showing.
 */
export function projectActivity(row: ActivityRow): ActivityEvent {
  const before = parseJson(row.before_json);
  const after = parseJson(row.after_json);
  return {
    ...describeActivity({ action: row.action, before, after }),
    id: row.id,
    action: row.action,
    actor_kind: row.actor_kind,
    actor_person_id: row.actor_person_id,
    actor_name: row.actor_name,
    created_at: row.created_at,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    event_id: row.event_id,
    event_name: row.event_name,
  };
}

export const ACTIVITY_SELECT = `SELECT entry.id, entry.action, entry.actor_kind, entry.actor_person_id,
    actor.name AS actor_name, entry.created_at, entry.before_json, entry.after_json,
    entry.entity_type, entry.entity_id, entry.event_id, conference.name AS event_name
  FROM audit_log entry
  LEFT JOIN people actor ON actor.id = entry.actor_person_id
  LEFT JOIN events conference ON conference.id = entry.event_id`;

/** Newest first, tie-broken on the ULID so one batch keeps its write order. */
export const ACTIVITY_ORDER = "ORDER BY entry.created_at DESC, entry.id DESC";

export interface ActivityPage {
  rows: ActivityEvent[];
  total: number;
}

/**
 * Lens one — the organization's own admin actions, newest first.
 *
 * Paginated in SQL, on `idx_audit_org_created`: this log is the one surface
 * that only ever grows, so a lens that reads it whole is a lens that gets
 * slower every week it is used (R7).
 */
export async function orgActivityPage(
  db: D1Database,
  orgId: string,
  page: { limit: number; offset: number },
): Promise<ActivityPage> {
  const [count, rows] = await Promise.all([
    db.prepare("SELECT COUNT(*) AS total FROM audit_log WHERE org_id = ?").bind(orgId).first<{ total: number }>(),
    db
      .prepare(`${ACTIVITY_SELECT} WHERE entry.org_id = ? ${ACTIVITY_ORDER} LIMIT ? OFFSET ?`)
      .bind(orgId, page.limit, page.offset)
      .all<ActivityRow>(),
  ]);
  return { rows: rows.results.map(projectActivity), total: Number(count?.total ?? 0) };
}

/**
 * Lens two — one person's feed.
 *
 * Three sources, one ordered page. The audit rows are read by SUBJECT, not by
 * actor: an owner removing an organizer is a fact about the organizer's record,
 * and a lens keyed on `actor_person_id` would file it under the owner instead.
 * Every person-subject writer therefore records `entity_type = 'person'` with
 * the person's id, which keeps this an indexed read of
 * `idx_audit_entity_created` rather than a scan of the log looking for an id
 * inside a payload.
 *
 * The union is paginated in SQL rather than merged in memory, because the three
 * sources grow at different rates: a decade-long relationship accumulates
 * hundreds of notes and thousands of mails, and a feed assembled by reading all
 * of each and slicing the result gets slower every year the CRM is used (R7).
 */
const PERSON_FEED_SOURCES = `
  SELECT entry.id AS id, 'audit' AS kind, entry.action AS action,
         entry.before_json AS before_json, entry.after_json AS after_json,
         actor.name AS actor_name, entry.created_at AS created_at
    FROM audit_log entry
    LEFT JOIN people actor ON actor.id = entry.actor_person_id
   WHERE entry.entity_type = 'person' AND entry.entity_id = ?1
  UNION ALL
  SELECT annotation.id, annotation.kind, NULL, NULL, annotation.value_json,
         actor.name, annotation.created_at
    FROM person_events annotation
    LEFT JOIN people actor ON actor.id = annotation.actor_person_id
   WHERE annotation.person_id = ?1
  UNION ALL
  SELECT message.id, 'email', message.status, NULL,
         json_object('subject', message.subject, 'status', message.status),
         NULL, message.created_at
    FROM outbox message
   WHERE message.person_id = ?1`;

export interface PersonFeedEntry extends ActivityLine {
  id: string;
  /** `audit`, an annotation kind (`note`, `tag`, `stage`), or `email`. */
  kind: string;
  actor_name: string | null;
  created_at: number;
}

interface PersonFeedRow {
  id: string;
  kind: string;
  action: string | null;
  before_json: string | null;
  after_json: string | null;
  actor_name: string | null;
  created_at: number;
}

export async function personFeedPage(
  db: D1Database,
  personId: string,
  page: { limit: number; offset: number },
  /** Annotation and mail copy stays with the module that owns those kinds. */
  describeOther: (kind: string, payload: unknown) => ActivityLine,
): Promise<{ rows: PersonFeedEntry[]; total: number }> {
  const [count, rows] = await Promise.all([
    db
      .prepare(`SELECT COUNT(*) AS total FROM (${PERSON_FEED_SOURCES})`)
      .bind(personId)
      .first<{ total: number }>(),
    db
      .prepare(
        `SELECT * FROM (${PERSON_FEED_SOURCES})
         ORDER BY created_at DESC, id DESC
         LIMIT ?2 OFFSET ?3`,
      )
      .bind(personId, page.limit, page.offset)
      .all<PersonFeedRow>(),
  ]);
  return {
    rows: rows.results.map((row) => {
      const after = parseJson(row.after_json);
      const line = row.kind === "audit"
        ? describeActivity({ action: row.action ?? "", before: parseJson(row.before_json), after })
        : describeOther(row.kind, after);
      return { ...line, id: row.id, kind: row.kind, actor_name: row.actor_name, created_at: row.created_at };
    }),
    total: Number(count?.total ?? 0),
  };
}
