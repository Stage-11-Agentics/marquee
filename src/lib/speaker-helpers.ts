import type { D1Database } from "@cloudflare/workers-types";

import { ApiError } from "../api/errors";
import { newUlid } from "../api/ids";
import type { AuditActorKind } from "../db/schema";
import { auditStatement } from "./audit";
import { revokeConferenceAccessStatements } from "./auth/access-revocation";

export interface SpeakerHelperView {
  id: string;
  event_id: string;
  speaker_person_id: string;
  speaker_name: string;
  helper_person_id: string;
  helper_name: string;
  helper_email: string;
  added_at: number;
  removed_at: number | null;
}

export interface HelperScope {
  event_id: string;
  event_name: string;
  event_slug: string;
  event_timezone: string;
  speaker_person_id: string;
  speaker_name: string;
  speaker_email: string;
  helper_name: string;
  helper_email: string;
  helper_id: string;
}

export interface SpeakerHelperActor {
  actorKind: AuditActorKind;
  actorPersonId: string;
  requestId: string | null;
}

export interface AddSpeakerHelperInput extends SpeakerHelperActor {
  eventId: string;
  speakerPersonId: string;
  helperName: string;
  helperEmail: string;
  now?: number;
}

export interface RemoveSpeakerHelperInput extends SpeakerHelperActor {
  eventId: string;
  speakerPersonId: string;
  helperPersonId: string;
  now?: number;
}

export function normalizeHelperEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizeHelperName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/**
 * The precedence is deliberately explicit: a person's own speaker seat wins
 * unless the request names the helper view; submitter wins over helper only
 * when the person has no speaker seat. This prevents an added helper row from
 * changing the meaning of an existing portal session.
 */
export function resolvePortalSeat(input: {
  hasSpeakerSeat: boolean;
  hasSubmitterSeat: boolean;
  hasHelperSeat: boolean;
  helperView?: boolean;
}): "speaker" | "submitter" | "helper" | "none" {
  if (input.helperView && input.hasHelperSeat) return "helper";
  if (input.hasSpeakerSeat) return "speaker";
  if (input.hasSubmitterSeat) return "submitter";
  if (input.hasHelperSeat) return "helper";
  return "none";
}

const SPEAKER_ROSTER_PREDICATE = `(
  EXISTS (
    SELECT 1 FROM memberships membership
    WHERE membership.event_id = conference.id
      AND membership.person_id = speaker.id
      AND membership.role IN ('speaker', 'co_speaker')
  )
  OR EXISTS (
    SELECT 1
    FROM participations participation
    JOIN submissions submission ON submission.id = participation.submission_id
    WHERE submission.event_id = conference.id
      AND participation.person_id = speaker.id
      AND participation.role IN ('speaker', 'co_speaker')
  )
)`;

async function eventAndSpeaker(
  db: D1Database,
  eventId: string,
  speakerPersonId: string,
): Promise<{ id: string; org_id: string; demo_mode: number } | null> {
  return db.prepare(
    `SELECT conference.id, conference.org_id, conference.demo_mode
       FROM events conference
       JOIN people speaker ON speaker.id = ? AND speaker.org_id = conference.org_id
      WHERE conference.id = ? AND ${SPEAKER_ROSTER_PREDICATE}`,
  ).bind(speakerPersonId, eventId).first<{ id: string; org_id: string; demo_mode: number }>();
}

export async function speakerIsOnEvent(db: D1Database, eventId: string, speakerPersonId: string): Promise<boolean> {
  return (await eventAndSpeaker(db, eventId, speakerPersonId)) !== null;
}

const HELPER_VIEW_COLUMNS = `
  helper.id, helper.event_id, helper.speaker_person_id,
  speaker.name AS speaker_name, helper.helper_person_id, helper.helper_name,
  helper_person.email AS helper_email, helper.added_at, helper.removed_at`;

export async function listSpeakerHelpers(
  db: D1Database,
  eventId: string,
  speakerPersonIds?: readonly string[],
  includeRemoved = false,
): Promise<SpeakerHelperView[]> {
  const ids = speakerPersonIds === undefined ? null : [...new Set(speakerPersonIds)];
  if (ids !== null && ids.length === 0) return [];
  const scope = ids === null ? "" : " AND helper.speaker_person_id IN (SELECT value FROM json_each(?))";
  const removed = includeRemoved ? "" : " AND helper.removed_at IS NULL";
  const bindings = ids === null ? [eventId] : [eventId, JSON.stringify(ids)];
  const result = await db.prepare(
    `SELECT ${HELPER_VIEW_COLUMNS}
       FROM speaker_helpers helper
       JOIN people speaker ON speaker.id = helper.speaker_person_id
       JOIN people helper_person ON helper_person.id = helper.helper_person_id
      WHERE helper.event_id = ?${scope}${removed}
      ORDER BY helper.speaker_person_id, helper.added_at DESC, helper.id DESC`,
  ).bind(...bindings).all<SpeakerHelperView>();
  return result.results;
}

export async function listHelperScopes(
  db: D1Database,
  helperPersonId: string,
  eventId?: string,
  speakerPersonId?: string,
): Promise<HelperScope[]> {
  const predicates = ["helper.helper_person_id = ?", "helper.removed_at IS NULL"];
  const bindings: string[] = [helperPersonId];
  if (eventId) {
    predicates.push("helper.event_id = ?");
    bindings.push(eventId);
  }
  if (speakerPersonId) {
    predicates.push("helper.speaker_person_id = ?");
    bindings.push(speakerPersonId);
  }
  const result = await db.prepare(
    `SELECT helper.event_id, conference.name AS event_name, conference.slug AS event_slug,
            conference.timezone AS event_timezone, helper.speaker_person_id,
            speaker.name AS speaker_name, speaker.email AS speaker_email,
            helper.helper_name, helper_person.email AS helper_email,
            helper.helper_person_id AS helper_id
       FROM speaker_helpers helper
       JOIN events conference ON conference.id = helper.event_id
       JOIN people speaker ON speaker.id = helper.speaker_person_id
       JOIN people helper_person ON helper_person.id = helper.helper_person_id
      WHERE ${predicates.join(" AND ")}
      ORDER BY conference.starts_on ASC, conference.id ASC, speaker.name COLLATE NOCASE ASC`,
  ).bind(...bindings).all<HelperScope>();
  return result.results;
}

export async function speakerHelperTaskAccess(
  db: D1Database,
  helperPersonId: string,
  taskId: string,
): Promise<{ eventId: string; speakerPersonId: string } | null> {
  return db.prepare(
    `SELECT task.event_id AS eventId, task.person_id AS speakerPersonId
       FROM speaker_tasks task
       JOIN speaker_helpers helper
         ON helper.event_id = task.event_id
        AND helper.speaker_person_id = task.person_id
        AND helper.helper_person_id = ?
        AND helper.removed_at IS NULL
      WHERE task.id = ? AND task.cancelled_at IS NULL`,
  ).bind(helperPersonId, taskId).first<{ eventId: string; speakerPersonId: string }>();
}

export async function speakerHelperForTaskHistory(
  db: D1Database,
  taskId: string,
  completedByPersonId: string,
  completedAt: number,
): Promise<string | null> {
  const row = await db.prepare(
    `SELECT helper.helper_name
       FROM speaker_tasks task
       JOIN speaker_helpers helper
         ON helper.event_id = task.event_id
        AND helper.speaker_person_id = task.person_id
        AND helper.helper_person_id = ?
        AND helper.added_at <= ?
        AND (helper.removed_at IS NULL OR helper.removed_at >= ?)
      WHERE task.id = ?
      ORDER BY helper.added_at DESC, helper.id DESC
      LIMIT 1`,
  ).bind(completedByPersonId, completedAt, completedAt, taskId).first<{ helper_name: string }>();
  return row?.helper_name ?? null;
}

export async function addSpeakerHelper(
  db: D1Database,
  input: AddSpeakerHelperInput,
): Promise<SpeakerHelperView> {
  const event = await eventAndSpeaker(db, input.eventId, input.speakerPersonId);
  if (!event) throw ApiError.notFound("speaker not found at this conference");
  const helperName = normalizeHelperName(input.helperName);
  const helperEmail = normalizeHelperEmail(input.helperEmail);
  if (!helperName) throw ApiError.unprocessable("helper name is required", "name");
  if (!helperEmail) throw ApiError.unprocessable("helper email is required", "email");
  const now = input.now ?? Date.now();
  const existingPerson = await db.prepare(
    "SELECT id, email FROM people WHERE org_id = ? AND lower(email) = ? LIMIT 1",
  ).bind(event.org_id, helperEmail).first<{ id: string; email: string }>();
  if (existingPerson?.id === input.speakerPersonId) {
    throw ApiError.unprocessable("a speaker cannot add themselves as a helper", "email");
  }
  const helperPersonId = existingPerson?.id ?? newUlid(now);
  const helperId = newUlid(now + 1);
  const current = await db.prepare(
    `SELECT id, event_id, speaker_person_id, helper_person_id, helper_name, added_by, added_at, removed_at
       FROM speaker_helpers
      WHERE event_id = ? AND speaker_person_id = ? AND helper_person_id = ?`,
  ).bind(input.eventId, input.speakerPersonId, helperPersonId).first<SpeakerHelperView & { added_by: string }>();
  const personInsert = existingPerson ? null : db.prepare(
    `INSERT INTO people
      (id, org_id, email, name, title, company, bio, social_links, is_demo, last_write_source, created_at, updated_at)
     VALUES (?, ?, ?, ?, NULL, NULL, NULL, '[]', ?, 'marquee', ?, ?)`,
  ).bind(helperPersonId, event.org_id, helperEmail, helperName, event.demo_mode === 1 ? 1 : 0, now, now);
  const helperWrite = current
    ? db.prepare(
      `UPDATE speaker_helpers
          SET helper_name = ?, added_by = ?, added_at = ?, removed_at = NULL
        WHERE id = ?`,
    ).bind(helperName, input.actorPersonId, now, current.id)
    : db.prepare(
      `INSERT INTO speaker_helpers
        (id, event_id, speaker_person_id, helper_person_id, helper_name, added_by, added_at, removed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
    ).bind(helperId, input.eventId, input.speakerPersonId, helperPersonId, helperName, input.actorPersonId, now);
  const entityId = current?.id ?? helperId;
  const after = { event_id: input.eventId, speaker_person_id: input.speakerPersonId, helper_person_id: helperPersonId, helper_name: helperName, active: true };
  await db.batch([
    ...(personInsert ? [personInsert] : []),
    helperWrite,
    auditStatement(db, {
      eventId: input.eventId,
      actorKind: input.actorKind,
      actorPersonId: input.actorPersonId,
      action: "speaker_helper.added",
      entityType: "speaker_helper",
      entityId,
      ...(current ? { before: { helper_name: current.helper_name, removed_at: current.removed_at } } : {}),
      after,
      now,
      requestId: input.requestId,
    }),
  ]);
  const row = await db.prepare(
    `SELECT ${HELPER_VIEW_COLUMNS}
       FROM speaker_helpers helper
       JOIN people speaker ON speaker.id = helper.speaker_person_id
       JOIN people helper_person ON helper_person.id = helper.helper_person_id
      WHERE helper.id = ?`,
  ).bind(entityId).first<SpeakerHelperView>();
  if (!row) throw new Error("speaker helper was not persisted");
  return row;
}

export async function removeSpeakerHelper(
  db: D1Database,
  input: RemoveSpeakerHelperInput,
): Promise<SpeakerHelperView> {
  const current = await db.prepare(
    `SELECT ${HELPER_VIEW_COLUMNS}
       FROM speaker_helpers helper
       JOIN events conference ON conference.id = helper.event_id
       JOIN people speaker ON speaker.id = helper.speaker_person_id
       JOIN people helper_person ON helper_person.id = helper.helper_person_id
      WHERE helper.event_id = ? AND helper.speaker_person_id = ?
        AND helper.helper_person_id = ? AND helper.removed_at IS NULL`,
  ).bind(input.eventId, input.speakerPersonId, input.helperPersonId).first<SpeakerHelperView>();
  if (!current) throw ApiError.notFound("active helper not found");
  const now = input.now ?? Date.now();
  const otherStanding = await db.prepare(
    `SELECT 1
       FROM memberships membership
      WHERE membership.event_id = ? AND membership.person_id = ?
      UNION ALL
     SELECT 1
       FROM participations participation
       JOIN submissions submission ON submission.id = participation.submission_id
      WHERE submission.event_id = ? AND participation.person_id = ?
      UNION ALL
     SELECT 1 FROM speaker_helpers other
      WHERE other.event_id = ? AND other.helper_person_id = ?
        AND other.removed_at IS NULL AND other.id <> ?
      LIMIT 1`,
  ).bind(input.eventId, input.helperPersonId, input.eventId, input.helperPersonId, input.eventId, input.helperPersonId, current.id).first();
  const statements = [
    db.prepare("UPDATE speaker_helpers SET removed_at = ? WHERE id = ? AND removed_at IS NULL").bind(now, current.id),
    auditStatement(db, {
      eventId: input.eventId,
      actorKind: input.actorKind,
      actorPersonId: input.actorPersonId,
      action: "speaker_helper.removed",
      entityType: "speaker_helper",
      entityId: current.id,
      before: { helper_name: current.helper_name, removed_at: null },
      after: { helper_name: current.helper_name, removed_at: now, helper_person_id: current.helper_person_id },
      now,
      requestId: input.requestId,
    }),
  ];
  if (!otherStanding) statements.push(...revokeConferenceAccessStatements(db, { personId: current.helper_person_id, eventId: input.eventId, now }));
  await db.batch(statements);
  return { ...current, removed_at: now };
}
