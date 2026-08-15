import { z } from "@hono/zod-openapi";

import type { ApiRouteEntry } from "../api/route";
import { createListQuerySchema, createListResponseSchema } from "../api/list";
import { defineApiRoute, errorResponses, jsonResponse } from "../api/route";
import { ApiError } from "../api/errors";
import { authHasRole, tokenHasGrant } from "../lib/auth/scope-resolution";
import { getAuth } from "../lib/auth/auth-middleware";
import { listCommsAudience, type CommsRecipientRow } from "../jobs/mail/audience";
import { enqueueMailMessage } from "../jobs/mail/consumer";
import { enqueueBulkReminder } from "../jobs/mail/triggers";
import {
  COMMUNICATION_TEMPLATE_KEYS,
  defaultTemplateKeyFromId,
  findTemplate,
  listCommunicationTemplates,
  type MailTemplateKey,
} from "../jobs/mail/templates";
import { renderAdHocMail, renderMail, type MergeData } from "../jobs/mail/render";
import { mergeDataForRecipient, firstName } from "../jobs/mail/merge-data";
import { mergeFieldErrorMessage, unknownMergeFieldsForCommunication } from "../lib/mail-merge-fields";
import {
  DEMO_MAIL_ALLOWLIST_LIMIT,
  demoMailAllowlistForOrgEvent,
  demoMailEventInOrg,
  describeRejectedEmail,
  isAllowlistEmail,
  normalizeAllowlistEmail,
  parseAllowlist,
  writeDemoMailAllowlistForOrgEvent,
} from "../lib/demo-mail-allowlist";
import type { OutboxRow } from "../db/schema";
import {
  arrivalForSession,
  type ArrivalBuilding,
  type ArrivalProjection,
  type ArrivalSession,
} from "../lib/venue-geometry";
import { hasSpeakerTaskCancellationColumn, submissionFilterSchema } from "./submissions.queries";
import { auditStatement } from "../lib/audit";

const eventParams = z.object({ eventId: z.string().min(1) });
const templateParams = eventParams.extend({ templateId: z.string().min(1) });
const personParams = eventParams.extend({ personId: z.string().min(1) });

const templateSchema = z.object({
  id: z.string(),
  event_id: z.string(),
  key: z.string(),
  name: z.string(),
  subject: z.string(),
  body_md: z.string(),
  enabled: z.number().int(),
  updated_at: z.number(),
});

export const reminderSelectorSchema = z.object({
  status: z.string().optional(),
  track_id: z.string().optional(),
  format_id: z.string().optional(),
  task_state: z.enum(["open", "done"]).optional(),
  /** Exact selections use json_each(?) rather than one D1 placeholder per row. */
  submission_ids: z.array(z.string().min(1)).max(500).optional(),
  person_ids: z.array(z.string().min(1)).max(500).optional(),
  /** Board selections preserve the selected person/submission relationship. */
  recipient_pairs: z.array(z.object({
    person_id: z.string().min(1),
    submission_id: z.string().min(1).nullable(),
  })).max(500).optional(),
  /** Existing selectors keep their prior semantics unless the caller opts in. */
  role: z.enum(["speaker", "co_speaker", "moderator", "chairperson", "submitter", "sponsor_contact"]).optional(),
});

const selectorSchema = reminderSelectorSchema
  .default({});

export type ReminderSelector = z.infer<typeof reminderSelectorSchema>;
export type ReminderRecipientPair = NonNullable<ReminderSelector["recipient_pairs"]>[number];

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function uniqueRecipientPairs(pairs: readonly ReminderRecipientPair[]): ReminderRecipientPair[] {
  const seen = new Set<string>();
  return pairs.filter((pair) => {
    const key = `${pair.person_id}\u0000${pair.submission_id ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const templateBodySchema = z.object({
  key: z.string().min(1).max(80),
  name: z.string().min(1).max(160),
  subject: z.string().min(1).max(300),
  body_md: z.string().min(1).max(50_000),
  enabled: z.boolean().default(true),
});

const templatePatchSchema = templateBodySchema.partial();

const templateListResponse = z.object({ data: z.array(templateSchema) });
const outboxItemSchema = z.object({
  id: z.string(),
  event_id: z.string(),
  template_key: z.string(),
  person_id: z.string().nullable(),
  to_email: z.string(),
  subject: z.string(),
  html: z.string(),
  text: z.string(),
  status: z.string(),
  send_policy: z.string(),
  suppressed_reason: z.string().nullable(),
  idempotency_key: z.string(),
  provider_message_id: z.string().nullable(),
  error: z.string().nullable(),
  created_at: z.number(),
  sent_at: z.number().nullable(),
});
const outboxListResponse = z.object({
  data: z.array(outboxItemSchema),
  page: z.number(),
  per_page: z.number(),
  total: z.number(),
});
const demoMailAllowlistResponse = z.object({
  data: z.object({
    /** Whether suppression is actually in force here; outside demo mode the list is inert. */
    demo_mode: z.boolean(),
    limit: z.number().int().positive(),
    emails: z.array(z.string()),
  }),
});
const demoMailAllowlistInput = z.object({
  emails: z.array(z.string().trim().min(1).max(254)).max(DEMO_MAIL_ALLOWLIST_LIMIT * 4),
});
const audienceQuerySchema = createListQuerySchema(
  { ...submissionFilterSchema.shape, task_state: z.enum(["open", "done"]).optional() },
  ["name", "title"],
  { defaultSort: "name" },
);
const audienceItemSchema = z.object({
  person_id: z.string(),
  submission_id: z.string(),
  email: z.string(),
  name: z.string(),
  role: z.string(),
  submission_title: z.string(),
  format: z.string().nullable(),
  room: z.string().nullable(),
  starts_at: z.number().nullable(),
  task_title: z.string().nullable(),
  task_due_at: z.number().nullable(),
});
const audienceResponse = jsonResponse(
  createListResponseSchema(audienceItemSchema, "CommunicationAudience"),
  "The filtered communication audience",
);
const previewResponse = z.object({
  subject: z.string(),
  html: z.string(),
  text: z.string(),
  to_email: z.string(),
});
const skippedRecipientSchema = z.object({
  person_id: z.string(),
  name: z.string(),
  reason: z.string(),
});
const sendResponse = z.object({
  selected: z.number(),
  queued: z.number(),
  duplicate: z.number(),
  skipped: z.array(skippedRecipientSchema),
  outbox_ids: z.array(z.string()),
  outbox_rows: z.array(z.object({
    person_id: z.string(),
    entity_id: z.string(),
    outbox_id: z.string(),
    inserted: z.boolean(),
  })),
});

function requireComms(context: Parameters<NonNullable<ApiRouteEntry["handler"]>>[0], eventId: string, write: boolean): void {
  const auth = getAuth(context);
  if (!auth) throw ApiError.unauthenticated();
  if (auth.kind === "session") {
    if (!authHasRole(auth, "ops", eventId)) throw ApiError.forbidden("communications requires an ops role");
    return;
  }
  const required: "comms:send" | "program:read" = write ? "comms:send" : "program:read";
  if (!tokenHasGrant(auth, required, eventId)) {
    throw ApiError.forbidden(`communications requires ${required}`);
  }
}

function rejectUnknownMergeFields(subject: string, body: string): void {
  const unknown = unknownMergeFieldsForCommunication(subject, body);
  if (unknown.length > 0) throw ApiError.badRequest(mergeFieldErrorMessage(unknown), "template");
}

async function commsActor(
  context: Parameters<NonNullable<ApiRouteEntry["handler"]>>[0],
): Promise<{ personId: string; kind: "user" | "api_token" }> {
  const auth = getAuth(context);
  if (!auth) throw ApiError.unauthenticated();
  if (auth.kind === "session") return { personId: auth.personId, kind: "user" };
  const token = await context.env.DB
    .prepare("SELECT created_by FROM api_tokens WHERE id = ?")
    .bind(auth.tokenId)
    .first<{ created_by: string }>();
  if (!token?.created_by) throw ApiError.unauthenticated("the token issuer is no longer available");
  return { personId: token.created_by, kind: "api_token" };
}

export interface RecipientRow {
  person_id: string;
  submission_id: string | null;
  role: string;
  email: string;
  name: string;
  submission_title: string;
  room: string | null;
  room_id: string | null;
  starts_at: number | null;
  duration_min: number | null;
  event_timezone: string | null;
  building_id: string | null;
  building_name: string | null;
  building_address: string | null;
  building_lat: number | null;
  building_lng: number | null;
  building_access_minutes: number | null;
  building_access_note: string | null;
  task_title: string | null;
  task_due_at: number | null;
  task_template_due_at: number | null;
  arrival?: ArrivalProjection | null;
}

function arrivalBuildingFor(row: Pick<RecipientRow, "building_id" | "building_name" | "building_address" | "building_lat" | "building_lng" | "building_access_minutes" | "building_access_note">): ArrivalBuilding | null {
  if (!row.building_id || row.building_name === null || row.building_access_minutes === null) return null;
  return {
    id: row.building_id,
    name: row.building_name,
    address: row.building_address ?? "",
    lat: row.building_lat,
    lng: row.building_lng,
    access_minutes: row.building_access_minutes,
    access_note: row.building_access_note,
  };
}

function arrivalSessionFor(row: Pick<RecipientRow, "submission_id" | "starts_at" | "duration_min" | "room" | "building_id" | "building_name" | "building_address" | "building_lat" | "building_lng" | "building_access_minutes" | "building_access_note">): ArrivalSession | null {
  if (!row.submission_id) return null;
  return {
    id: row.submission_id,
    starts_at: row.starts_at,
    duration_min: row.duration_min,
    room_name: row.room,
    building: arrivalBuildingFor(row),
  };
}

async function hydrateRecipientArrivals(db: D1Database, eventId: string, rows: RecipientRow[]): Promise<RecipientRow[]> {
  const submissionRows = rows.filter((row) => row.submission_id !== null);
  if (submissionRows.length === 0) return rows;
  const personIds = unique(submissionRows.map((row) => row.person_id));
  const [event, primaryBuilding, schedule] = await Promise.all([
    db.prepare("SELECT timezone FROM events WHERE id = ?").bind(eventId).first<{ timezone: string }>(),
    db.prepare(
      `SELECT id, name, address, lat, lng, access_minutes, access_note
       FROM buildings WHERE event_id = ? ORDER BY position ASC, id ASC LIMIT 1`,
    ).bind(eventId).first<ArrivalBuilding>(),
    db.prepare(
      `SELECT participation.person_id, submission.id AS submission_id,
              agenda.starts_at, agenda.duration_min, room.id AS room_id, room.name AS room,
              building.id AS building_id, building.name AS building_name, building.address AS building_address,
              building.lat AS building_lat, building.lng AS building_lng,
              building.access_minutes AS building_access_minutes, building.access_note AS building_access_note
       FROM participations participation
       JOIN submissions submission ON submission.id = participation.submission_id AND submission.event_id = ?
       LEFT JOIN agenda_items agenda ON agenda.id = (
         SELECT selected_agenda.id FROM agenda_items selected_agenda
         WHERE selected_agenda.event_id = submission.event_id
           AND selected_agenda.submission_id = submission.id
           AND selected_agenda.kind = 'session'
         ORDER BY selected_agenda.starts_at ASC, selected_agenda.id ASC
         LIMIT 1
       )
       LEFT JOIN rooms room ON room.id = agenda.room_id AND room.event_id = submission.event_id
       LEFT JOIN buildings building ON building.id = room.building_id AND building.event_id = submission.event_id
       WHERE participation.person_id IN (SELECT CAST(value AS TEXT) FROM json_each(?))
       ORDER BY participation.person_id, agenda.starts_at, submission.id`,
    ).bind(eventId, JSON.stringify(personIds)).all<Pick<RecipientRow, "person_id" | "submission_id" | "starts_at" | "duration_min" | "room_id" | "room" | "building_id" | "building_name" | "building_address" | "building_lat" | "building_lng" | "building_access_minutes" | "building_access_note">>(),
  ]);
  const sessionsByPerson = new Map<string, ArrivalSession[]>();
  for (const scheduleRow of schedule.results) {
    const session = arrivalSessionFor(scheduleRow);
    if (!session) continue;
    const sessions = sessionsByPerson.get(scheduleRow.person_id) ?? [];
    if (!sessions.some((item) => item.id === session.id)) sessions.push(session);
    sessionsByPerson.set(scheduleRow.person_id, sessions);
  }
  return rows.map((row) => {
    const current = arrivalSessionFor(row);
    if (!current) return row;
    const sessions = sessionsByPerson.get(row.person_id) ?? [current];
    return {
      ...row,
      event_timezone: row.event_timezone ?? event?.timezone ?? "UTC",
      arrival: arrivalForSession({
        current,
        previousSessions: sessions,
        primaryBuilding,
        timezone: event?.timezone ?? "UTC",
      }),
    };
  });
}

/**
 * MRQ-24-owned reminder seam: return one stable recipient row per selected
 * person/submission, plus a person-only row for an accepted-speaker membership
 * whose local task has no submission. Future comms surfaces add selector
 * fields or consumers; they should keep this projection and its json-backed
 * exact-selection shape.
 */
export async function recipientsFor(
  db: D1Database,
  eventId: string,
  selector: ReminderSelector,
): Promise<RecipientRow[]> {
  // An explicit empty selection is a deliberate no-op. Treating [] as an
  // omitted filter would turn a cleared board selection into a bulk send.
  if (
    selector.submission_ids?.length === 0
    || selector.person_ids?.length === 0
    || selector.recipient_pairs?.length === 0
  ) return [];
  const includeCancelledAt = await hasSpeakerTaskCancellationColumn(db);
  const recipientPairs = selector.recipient_pairs ? uniqueRecipientPairs(selector.recipient_pairs) : null;
  const where = ["s.event_id = ?"];
  const bindings: (string | number)[] = [eventId];
  if (selector.status) {
    where.push("s.status = ?");
    bindings.push(selector.status);
  }
  if (selector.track_id) {
    where.push("EXISTS (SELECT 1 FROM submission_tracks stf WHERE stf.submission_id = s.id AND stf.track_id = ?)");
    bindings.push(selector.track_id);
  }
  if (selector.format_id) {
    where.push("s.format_id = ?");
    bindings.push(selector.format_id);
  }
  if (selector.submission_ids && selector.submission_ids.length > 0) {
    where.push("s.id IN (SELECT CAST(value AS TEXT) FROM json_each(?))");
    bindings.push(JSON.stringify([...new Set(selector.submission_ids)]));
  }
  if (selector.person_ids && selector.person_ids.length > 0) {
    where.push("p.id IN (SELECT CAST(value AS TEXT) FROM json_each(?))");
    bindings.push(JSON.stringify([...new Set(selector.person_ids)]));
  }
  if (recipientPairs) {
    const submittedPairs = recipientPairs.filter((pair): pair is ReminderRecipientPair & { submission_id: string } => pair.submission_id !== null);
    if (submittedPairs.length === 0) {
      where.push("1 = 0");
    } else {
      where.push(`EXISTS (
        SELECT 1 FROM json_each(?) selected_recipient
        WHERE json_extract(selected_recipient.value, '$.person_id') = p.id
          AND json_extract(selected_recipient.value, '$.submission_id') = s.id
      )`);
      bindings.push(JSON.stringify(submittedPairs));
    }
  }
  if (selector.role) {
    where.push("part.role = ?");
    bindings.push(selector.role);
  }
  if (selector.task_state) {
    where.push(`EXISTS (
      SELECT 1 FROM speaker_tasks stf
      WHERE stf.event_id = s.event_id AND stf.person_id = p.id AND stf.submission_id = s.id AND stf.status = ?
      ${includeCancelledAt && selector.task_state === "open" ? "AND stf.cancelled_at IS NULL" : ""}
    )`);
    bindings.push(selector.task_state);
  }
  // A person may hold more than one participation role on a submission. The
  // reminder seam publishes one stable row per person/submission; an explicit
  // role narrows that choice, otherwise the speaker role wins deterministically.
  where.push(`part.id = (
    SELECT chosen_part.id FROM participations chosen_part
    WHERE chosen_part.submission_id = s.id AND chosen_part.person_id = p.id
    ${selector.role ? "AND chosen_part.role = ?" : ""}
    ORDER BY CASE chosen_part.role
      WHEN 'speaker' THEN 0
      WHEN 'co_speaker' THEN 1
      WHEN 'moderator' THEN 2
      WHEN 'chairperson' THEN 3
      WHEN 'submitter' THEN 4
      WHEN 'sponsor_contact' THEN 5
      ELSE 6 END,
      chosen_part.position ASC, chosen_part.id ASC
    LIMIT 1
  )`);
  if (selector.role) bindings.push(selector.role);
  const selectedTaskStateCondition = selector.task_state
    ? `AND selected_task.status = '${selector.task_state === "open" ? "open" : "done"}'`
    : "";
  const selectedTaskCancellationCondition = includeCancelledAt && !selector.task_state
    ? "AND (selected_task.status <> 'open' OR selected_task.cancelled_at IS NULL)"
    : "";
  const result = await db
    .prepare(
      `SELECT DISTINCT p.id AS person_id, s.id AS submission_id, part.role, p.email, p.name,
              s.title AS submission_title, r.id AS room_id, r.name AS room, ai.starts_at, ai.duration_min,
              conference.timezone AS event_timezone,
              b.id AS building_id, b.name AS building_name, b.address AS building_address,
              b.lat AS building_lat, b.lng AS building_lng,
              b.access_minutes AS building_access_minutes, b.access_note AS building_access_note,
              st.title AS task_title, st.due_at AS task_due_at,
              st_template.due_at AS task_template_due_at
       FROM submissions s
       JOIN events conference ON conference.id = s.event_id
       JOIN participations part ON part.submission_id = s.id
       JOIN people p ON p.id = part.person_id
       LEFT JOIN agenda_items ai ON ai.id = (
         SELECT selected_agenda.id FROM agenda_items selected_agenda
         WHERE selected_agenda.event_id = s.event_id
           AND selected_agenda.submission_id = s.id
           AND selected_agenda.kind = 'session'
         ORDER BY selected_agenda.starts_at ASC, selected_agenda.id ASC
         LIMIT 1
       )
       LEFT JOIN rooms r ON r.id = ai.room_id AND r.event_id = s.event_id
       LEFT JOIN buildings b ON b.id = r.building_id AND b.event_id = s.event_id
       LEFT JOIN speaker_tasks st ON st.id = (
         SELECT selected_task.id FROM speaker_tasks selected_task
           WHERE selected_task.event_id = s.event_id
             AND selected_task.person_id = p.id
             AND selected_task.submission_id = s.id
             ${selectedTaskStateCondition}
             ${includeCancelledAt && selector.task_state === "open" ? "AND selected_task.cancelled_at IS NULL" : ""}
             ${selectedTaskCancellationCondition}
         ORDER BY CASE WHEN selected_task.status = 'open' THEN 0 ELSE 1 END,
                  selected_task.due_at ASC, selected_task.id ASC
         LIMIT 1
       )
       LEFT JOIN task_templates st_template
         ON st_template.id = st.template_id AND st_template.event_id = s.event_id
       WHERE ${where.join(" AND ")}
       ORDER BY p.name COLLATE NOCASE, s.title COLLATE NOCASE`,
    )
    .bind(...bindings)
    .all<RecipientRow>();
  const rows = [...result.results];

  // The seeded accepted-speaker roster can contain a real speaker whose local
  // accepted session is intentionally absent. Their task rows have a NULL
  // submission_id, so an exact board selection must still be able to address
  // them by person. Submission-scoped selectors cannot match a person-only
  // row, and non-speaker role selectors must not widen into one.
  const personOnlyPairIds = recipientPairs?.filter((pair) => pair.submission_id === null).map((pair) => pair.person_id) ?? [];
  const canAddressPersonOnly = Boolean(selector.person_ids?.length || personOnlyPairIds.length)
    && (!selector.role || selector.role === "speaker")
    && !selector.status && !selector.track_id && !selector.format_id;
  if (canAddressPersonOnly) {
    const personIds = recipientPairs ? unique(personOnlyPairIds) : unique(selector.person_ids!);
    const exactPairMode = recipientPairs !== null;
    const taskStateCondition = selector.task_state
      ? `AND selected_task.status = ?${includeCancelledAt && selector.task_state === "open" ? " AND selected_task.cancelled_at IS NULL" : ""}`
      : "";
    const taskCancellationCondition = includeCancelledAt && !selector.task_state
      ? "AND (selected_task.status <> 'open' OR selected_task.cancelled_at IS NULL)"
      : "";
    const fallbackBindings: (string | number)[] = [];
    // The selected-task subquery appears before the outer WHERE in SQL, so
    // its status placeholder must be bound before membership/event filters.
    if (selector.task_state) fallbackBindings.push(selector.task_state);
    fallbackBindings.push(eventId, JSON.stringify(personIds));
    const fallbackSelectionCondition = exactPairMode
      ? ""
      : selector.submission_ids && selector.submission_ids.length > 0
      ? `AND NOT EXISTS (
          SELECT 1 FROM participations selected_part
          WHERE selected_part.person_id = person.id
            AND selected_part.submission_id IN (SELECT CAST(value AS TEXT) FROM json_each(?))
        )`
      : `AND NOT EXISTS (
          SELECT 1 FROM participations any_part
          JOIN submissions any_submission ON any_submission.id = any_part.submission_id
            AND any_submission.event_id = membership.event_id
          WHERE any_part.person_id = person.id
        )`;
    if (!exactPairMode && selector.submission_ids && selector.submission_ids.length > 0) {
      fallbackBindings.push(JSON.stringify(unique(selector.submission_ids)));
    }
    const fallback = await db
      .prepare(
        `SELECT person.id AS person_id, NULL AS submission_id, 'speaker' AS role,
                person.email, person.name, '—' AS submission_title,
                NULL AS room_id, NULL AS room, NULL AS starts_at, NULL AS duration_min,
                event.timezone AS event_timezone, NULL AS building_id, NULL AS building_name,
                NULL AS building_address, NULL AS building_lat, NULL AS building_lng,
                NULL AS building_access_minutes, NULL AS building_access_note,
                st.title AS task_title, st.due_at AS task_due_at,
                st_template.due_at AS task_template_due_at
         FROM memberships membership
         JOIN people person ON person.id = membership.person_id
         JOIN events event ON event.id = membership.event_id
         LEFT JOIN speaker_tasks st ON st.id = (
           SELECT selected_task.id FROM speaker_tasks selected_task
           WHERE selected_task.event_id = membership.event_id
             AND selected_task.person_id = person.id
             AND selected_task.submission_id IS NULL
             ${taskStateCondition}
             ${taskCancellationCondition}
           ORDER BY CASE WHEN selected_task.status = 'open' THEN 0 ELSE 1 END,
                    selected_task.due_at ASC, selected_task.id ASC
           LIMIT 1
         )
         LEFT JOIN task_templates st_template
           ON st_template.id = st.template_id AND st_template.event_id = membership.event_id
         WHERE membership.event_id = ? AND membership.role = 'speaker'
           AND person.id IN (SELECT CAST(value AS TEXT) FROM json_each(?))
           ${fallbackSelectionCondition}
           ${selector.task_state ? `AND EXISTS (
             SELECT 1 FROM speaker_tasks selected_state_task
             WHERE selected_state_task.event_id = membership.event_id
               AND selected_state_task.person_id = person.id
               AND selected_state_task.submission_id IS NULL
               AND selected_state_task.status = ?
               ${includeCancelledAt && selector.task_state === "open" ? "AND selected_state_task.cancelled_at IS NULL" : ""}
           )` : ""}
         GROUP BY person.id, person.email, person.name, event.timezone, st.title, st.due_at, st_template.due_at
         ORDER BY person.name COLLATE NOCASE, person.id ASC`,
      )
      .bind(...fallbackBindings, ...(selector.task_state ? [selector.task_state] : []))
      .all<RecipientRow>();
    rows.push(...fallback.results);
  }

  const sorted = rows.sort((left, right) => left.name.localeCompare(right.name) || (left.submission_title ?? "").localeCompare(right.submission_title ?? "") || left.person_id.localeCompare(right.person_id));
  return hydrateRecipientArrivals(db, eventId, sorted);
}

function mergeDataFor(row: RecipientRow): MergeData {
  return mergeDataForRecipient({
    name: row.name,
    email: row.email,
    submissionTitle: row.submission_title,
    room: row.room,
    building: row.arrival?.building?.name ?? row.building_name,
    address: row.arrival?.building?.address ?? row.building_address,
    accessNote: row.arrival?.building?.access_note ?? row.building_access_note,
    leaveBy: row.arrival?.leave_by ?? null,
    timezone: row.event_timezone,
    startsAt: row.starts_at,
    taskTitle: row.task_title,
    taskDueAt: row.task_due_at,
    taskTemplateDueAt: row.task_template_due_at,
  });
}

interface SkippedRecipient {
  person_id: string;
  name: string;
  reason: string;
}

interface ReminderPerson {
  id: string;
  name: string;
  email: string;
}

interface ReminderParticipation {
  person_id: string;
  submission_id: string;
  role: string;
}

interface ReminderMembership {
  person_id: string;
  role: string;
}

function recipientKey(personId: string, submissionId: string | null): string {
  return `${personId}\u0000${submissionId ?? ""}`;
}

/**
 * Exact board selections are a promise to account for every selected pair.
 * `recipientsFor` intentionally returns only rows that satisfy its selector;
 * this companion lookup supplies a human-readable outcome for each pair that
 * did not survive that resolution.
 */
async function skippedRecipientsFor(
  db: D1Database,
  eventId: string,
  selector: ReminderSelector,
  requestedPairs: readonly ReminderRecipientPair[],
  resolved: readonly RecipientRow[],
): Promise<SkippedRecipient[]> {
  const resolvedKeys = new Set(resolved.map((row) => recipientKey(row.person_id, row.submission_id)));
  const missing = requestedPairs.filter((pair) => !resolvedKeys.has(recipientKey(pair.person_id, pair.submission_id)));
  if (missing.length === 0) return [];

  const personIds = unique(missing.map((pair) => pair.person_id));
  const [people, participations, memberships] = await Promise.all([
    db.prepare(
      `SELECT id, name, email FROM people
       WHERE id IN (SELECT CAST(value AS TEXT) FROM json_each(?))`,
    ).bind(JSON.stringify(personIds)).all<ReminderPerson>(),
    db.prepare(
      `SELECT participation.person_id, participation.submission_id, participation.role
       FROM participations participation
       JOIN submissions submission ON submission.id = participation.submission_id
       WHERE submission.event_id = ?
         AND participation.person_id IN (SELECT CAST(value AS TEXT) FROM json_each(?))`,
    ).bind(eventId, JSON.stringify(personIds)).all<ReminderParticipation>(),
    db.prepare(
      `SELECT person_id, role FROM memberships
       WHERE event_id = ?
         AND person_id IN (SELECT CAST(value AS TEXT) FROM json_each(?))`,
    ).bind(eventId, JSON.stringify(personIds)).all<ReminderMembership>(),
  ]);
  const peopleById = new Map(people.results.map((person) => [person.id, person]));
  const participationsByKey = new Set(participations.results.map((row) => recipientKey(row.person_id, row.submission_id)));
  const participationRolesByKey = new Map<string, Set<string>>();
  for (const row of participations.results) {
    const key = recipientKey(row.person_id, row.submission_id);
    const roles = participationRolesByKey.get(key) ?? new Set<string>();
    roles.add(row.role);
    participationRolesByKey.set(key, roles);
  }
  const membershipsByPerson = new Map<string, Set<string>>();
  for (const row of memberships.results) {
    const roles = membershipsByPerson.get(row.person_id) ?? new Set<string>();
    roles.add(row.role);
    membershipsByPerson.set(row.person_id, roles);
  }
  const participationPeople = new Set(participations.results.map((row) => row.person_id));

  return missing.map((pair) => {
    const person = peopleById.get(pair.person_id);
    if (!person) return { person_id: pair.person_id, name: pair.person_id, reason: "person record was not found" };
    if (!person.email.trim()) return { person_id: person.id, name: person.name, reason: "no email address on file" };
    const inEvent = membershipsByPerson.has(person.id) || participationPeople.has(person.id);
    if (!inEvent) return { person_id: person.id, name: person.name, reason: "not part of this conference" };
    if (pair.submission_id !== null) {
      const pairKey = recipientKey(pair.person_id, pair.submission_id);
      if (!participationsByKey.has(pairKey)) return { person_id: person.id, name: person.name, reason: "not a participant on this Session" };
      if (selector.role && !participationRolesByKey.get(pairKey)?.has(selector.role)) {
        return { person_id: person.id, name: person.name, reason: `does not have the ${selector.role.replace(/_/g, " ")} role on this Session` };
      }
    } else {
      const isSpeaker = membershipsByPerson.get(person.id)?.has("speaker")
        || participations.results.some((row) => row.person_id === person.id && ["speaker", "co_speaker"].includes(row.role));
      if (!isSpeaker) return { person_id: person.id, name: person.name, reason: "not a speaker on this conference" };
    }
    return { person_id: person.id, name: person.name, reason: "no open task remains" };
  });
}

async function resolveReminderSelection(
  db: D1Database,
  eventId: string,
  selector: ReminderSelector,
): Promise<{ selected: number; recipients: RecipientRow[]; skipped: SkippedRecipient[] }> {
  const resolved = await recipientsFor(db, eventId, selector);
  const exactPairs = selector.recipient_pairs ? uniqueRecipientPairs(selector.recipient_pairs) : null;
  const skipped = resolved
    .filter((row) => !row.email.trim())
    .map((row) => ({ person_id: row.person_id, name: row.name, reason: "no email address on file" }));
  const recipients = resolved.filter((row) => Boolean(row.email.trim()));
  if (!exactPairs) return { selected: resolved.length, recipients, skipped };
  const unresolved = await skippedRecipientsFor(db, eventId, selector, exactPairs, resolved);
  return {
    selected: exactPairs.length,
    recipients,
    skipped: [...skipped, ...unresolved],
  };
}

const getTemplates = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/events/{eventId}/templates",
    operationId: "listEmailTemplates",
    summary: "List communication templates",
    tags: ["Comms"],
    request: { params: eventParams },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "read" }, concurrency: "none" },
    responses: { 200: { content: { "application/json": { schema: templateListResponse } }, description: "Templates" }, ...errorResponses([401, 403, 500]) },
  },
  async (context) => {
    const { eventId } = context.req.valid("param");
    requireComms(context, eventId, false);
    const rows = await listCommunicationTemplates(context.env.DB, eventId);
    return context.json({
      data: rows.map(({ id, event_id, key, name, subject, body_md, enabled, updated_at }) => ({
        id, event_id, key, name, subject, body_md, enabled, updated_at,
      })),
    }, 200);
  },
);

const createTemplate = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/events/{eventId}/templates",
    operationId: "createEmailTemplate",
    summary: "Create a communication template",
    tags: ["Comms"],
    request: { params: eventParams, body: { content: { "application/json": { schema: templateBodySchema } } } },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 201: { content: { "application/json": { schema: templateSchema } }, description: "Created template" }, ...errorResponses([400, 401, 403, 409, 500]) },
  },
  async (context) => {
    const { eventId } = context.req.valid("param");
    requireComms(context, eventId, true);
    const body = context.req.valid("json");
    if (!(COMMUNICATION_TEMPLATE_KEYS as readonly string[]).includes(body.key)) throw ApiError.badRequest("unknown template key", "key");
    rejectUnknownMergeFields(body.subject, body.body_md);
    const now = Date.now();
    const id = crypto.randomUUID();
    try {
      await context.env.DB.prepare(
        `INSERT INTO email_templates (id, event_id, key, name, subject, body_md, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(id, eventId, body.key, body.name, body.subject, body.body_md, body.enabled ? 1 : 0, now, now).run();
    } catch {
      throw ApiError.conflict("a template with that key already exists");
    }
    const row = await context.env.DB.prepare("SELECT id, event_id, key, name, subject, body_md, enabled, updated_at FROM email_templates WHERE id = ?").bind(id).first();
    return context.json(row, 201);
  },
);

const updateTemplate = defineApiRoute(
  {
    method: "patch",
    path: "/api/v1/events/{eventId}/templates/{templateId}",
    operationId: "updateEmailTemplate",
    summary: "Edit or toggle a communication template",
    tags: ["Comms"],
    request: { params: templateParams, body: { content: { "application/json": { schema: templatePatchSchema } } } },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 200: { content: { "application/json": { schema: templateSchema } }, description: "Updated template" }, ...errorResponses([400, 401, 403, 404, 500]) },
  },
  async (context) => {
    const { eventId, templateId } = context.req.valid("param");
    requireComms(context, eventId, true);
    const body = context.req.valid("json");
    let persistedId = templateId;
    let current = await context.env.DB.prepare("SELECT * FROM email_templates WHERE id = ? AND event_id = ?").bind(templateId, eventId).first<{ key: string; name: string; subject: string; body_md: string; enabled: 0 | 1 }>();
    let fallbackId: string | null = null;
    if (!current) {
      const defaultKey = defaultTemplateKeyFromId(eventId, templateId);
      if (!defaultKey) throw ApiError.notFound("template not found");
      const fallback = await findTemplate(context.env.DB, eventId, defaultKey);
      fallbackId = crypto.randomUUID();
      persistedId = fallbackId;
      current = {
        key: fallback.key,
        name: fallback.name,
        subject: fallback.subject,
        body_md: fallback.body_md,
        enabled: fallback.enabled,
      };
    }
    const nextKey = body.key ?? current.key;
    if (!(COMMUNICATION_TEMPLATE_KEYS as readonly string[]).includes(nextKey)) throw ApiError.badRequest("unknown template key", "key");
    const nextSubject = body.subject ?? current.subject;
    const nextBody = body.body_md ?? current.body_md;
    rejectUnknownMergeFields(nextSubject, nextBody);
    const now = Date.now();
    if (fallbackId) {
      await context.env.DB.prepare(
        `INSERT INTO email_templates (id, event_id, key, name, subject, body_md, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(persistedId, eventId, current.key, current.name, current.subject, current.body_md, current.enabled, now, now).run();
    }
    await context.env.DB.prepare(
      `UPDATE email_templates SET key = ?, name = ?, subject = ?, body_md = ?, enabled = ?, updated_at = ? WHERE id = ? AND event_id = ?`,
    ).bind(nextKey, body.name ?? current.name, nextSubject, nextBody, body.enabled === undefined ? current.enabled : body.enabled ? 1 : 0, now, persistedId, eventId).run();
    const row = await context.env.DB.prepare("SELECT id, event_id, key, name, subject, body_md, enabled, updated_at FROM email_templates WHERE id = ?").bind(persistedId).first();
    return context.json(row, 200);
  },
);

const previewComms = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/events/{eventId}/comms/preview",
    operationId: "previewCommunication",
    summary: "Render one recipient's communication",
    tags: ["Comms"],
    request: {
      params: eventParams,
      body: { content: { "application/json": { schema: z.object({ person_id: z.string(), submission_id: z.string().optional(), role: reminderSelectorSchema.shape.role, template_key: z.string().optional(), subject: z.string().optional(), body: z.string().optional() }) } } },
    },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "read" }, concurrency: "none" },
    responses: { 200: { content: { "application/json": { schema: previewResponse } }, description: "Rendered preview" }, ...errorResponses([400, 401, 403, 404, 500]) },
  },
  async (context) => {
    const { eventId } = context.req.valid("param");
    requireComms(context, eventId, false);
    const body = context.req.valid("json");
    const recipient = await context.env.DB.prepare(
      `SELECT person.id, person.email, person.name
       FROM people person
       WHERE person.id = ?
         AND (
           EXISTS (SELECT 1 FROM memberships membership WHERE membership.event_id = ? AND membership.person_id = person.id)
           OR EXISTS (
             SELECT 1 FROM participations participation
             JOIN submissions submission ON submission.id = participation.submission_id
             WHERE submission.event_id = ? AND participation.person_id = person.id
           )
         )`,
    ).bind(body.person_id, eventId, eventId).first<{ id: string; email: string; name: string }>();
    if (!recipient) throw ApiError.notFound("recipient not found");
    const selected = body.submission_id
      ? (await recipientsFor(context.env.DB, eventId, {
        person_ids: [body.person_id],
        submission_ids: [body.submission_id],
        role: body.role,
      }))[0]
      : undefined;
    const data: MergeData = selected
      ? mergeDataFor(selected)
      : { "speaker.first_name": firstName(recipient.name), "speaker.name": recipient.name, "speaker.email": recipient.email };
    if (body.template_key) {
      if (!(COMMUNICATION_TEMPLATE_KEYS as readonly string[]).includes(body.template_key)) throw ApiError.badRequest("unknown template key", "template_key");
      const template = await findTemplate(context.env.DB, eventId, body.template_key);
      const rendered = renderMail(template, data);
      return context.json({ ...rendered, to_email: recipient.email }, 200);
    }
    if (body.subject === undefined || body.body === undefined) throw ApiError.badRequest("preview requires template_key or subject and body");
    return context.json({ ...renderAdHocMail(body.subject, body.body, data), to_email: recipient.email }, 200);
  },
);

const sendComms = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/events/{eventId}/comms/send",
    operationId: "sendCommunication",
    summary: "Queue a templated or ad-hoc communication",
    tags: ["Comms"],
    request: {
      params: eventParams,
      body: { content: { "application/json": { schema: z.object({ selector: selectorSchema, template_key: z.string().optional(), subject: z.string().optional(), body: z.string().optional() }) } } },
    },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 202: { content: { "application/json": { schema: sendResponse } }, description: "Messages queued" }, ...errorResponses([400, 401, 403, 500]) },
  },
  async (context) => {
    const { eventId } = context.req.valid("param");
    requireComms(context, eventId, true);
    const actor = await commsActor(context);
    const body = context.req.valid("json");
    const hasTemplate = body.template_key !== undefined;
    const hasAdHoc = body.subject !== undefined || body.body !== undefined;
    if (hasTemplate === hasAdHoc || (!hasTemplate && (body.subject === undefined || body.body === undefined))) {
      throw ApiError.badRequest("send requires exactly one of template_key or subject and body");
    }
    if (body.template_key && !(COMMUNICATION_TEMPLATE_KEYS as readonly string[]).includes(body.template_key)) {
      throw ApiError.badRequest("unknown template key", "template_key");
    }
    if (body.template_key) {
      const template = await findTemplate(context.env.DB, eventId, body.template_key);
      rejectUnknownMergeFields(template.subject, template.body_md);
    } else {
      rejectUnknownMergeFields(body.subject!, body.body!);
    }
    const selection = await resolveReminderSelection(context.env.DB, eventId, body.selector);
    const recipients = selection.recipients;
    const queued = await enqueueBulkReminder({
      db: context.env.DB,
      eventId,
      templateKey: (body.template_key ?? "custom") as MailTemplateKey,
      recipients: recipients.map((recipient) => ({ entityId: recipient.submission_id ?? recipient.person_id, personId: recipient.person_id, toEmail: recipient.email, data: mergeDataFor(recipient) })),
      subject: body.subject,
      body: body.body,
    });
    const outboxIds: string[] = [];
    const outboxRows = queued.map((item, index) => ({
      person_id: recipients[index]?.person_id ?? "",
      entity_id: recipients[index]?.submission_id ?? recipients[index]?.person_id ?? "",
      outbox_id: item.id,
      inserted: item.inserted,
    }));
    let duplicate = 0;
    for (const item of queued) {
      if (item.inserted) {
        outboxIds.push(item.id);
        await enqueueMailMessage(context.env.MAIL_QUEUE, item.id);
      } else {
        duplicate += 1;
      }
    }
    const auditRows = queued.flatMap((item, index) => {
      const recipient = recipients[index];
      if (!item.inserted || !recipient?.submission_id) return [];
      return [auditStatement(context.env.DB, {
        eventId,
        actorKind: actor.kind,
        actorPersonId: actor.personId,
        action: "submission.message_queued",
        entityType: "submission",
        entityId: recipient.submission_id,
        after: {
          outbox_id: item.id,
          person_id: recipient.person_id,
          role: recipient.role,
          template_key: body.template_key ?? "custom",
        },
        now: Date.now(),
        requestId: context.get("requestId") ?? null,
      })];
    });
    if (auditRows.length > 0) await context.env.DB.batch(auditRows);
    return context.json({ selected: selection.selected, queued: outboxIds.length, duplicate, skipped: selection.skipped, outbox_ids: outboxIds, outbox_rows: outboxRows }, 202);
  },
);

const getOutbox = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/events/{eventId}/outbox",
    operationId: "listOutbox",
    summary: "List rendered communication history",
    tags: ["Comms"],
    request: { params: eventParams, query: z.object({ page: z.coerce.number().int().min(1).default(1), per_page: z.coerce.number().int().min(1).max(100).default(50) }) },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "read" }, concurrency: "none" },
    responses: { 200: { content: { "application/json": { schema: outboxListResponse } }, description: "Outbox history" }, ...errorResponses([401, 403, 500]) },
  },
  async (context) => {
    const { eventId } = context.req.valid("param");
    requireComms(context, eventId, false);
    const { page, per_page } = context.req.valid("query");
    const totalRow = await context.env.DB.prepare("SELECT COUNT(*) AS total FROM outbox WHERE event_id = ?").bind(eventId).first<{ total: number }>();
    const rows = await context.env.DB.prepare(
      `SELECT id, event_id, template_key, person_id, to_email, subject, html, text, status, send_policy, suppressed_reason, idempotency_key, provider_message_id, error, created_at, sent_at
       FROM outbox WHERE event_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    ).bind(eventId, per_page, (page - 1) * per_page).all();
    return context.json({ data: rows.results, page, per_page, total: Number(totalRow?.total ?? 0) }, 200);
  },
);

const getPersonMessages = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/events/{eventId}/people/{personId}/messages",
    operationId: "listPersonMessages",
    summary: "List a person's rendered messages",
    tags: ["Comms"],
    request: { params: personParams },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "read" }, concurrency: "none" },
    responses: { 200: { content: { "application/json": { schema: z.object({ data: z.array(outboxItemSchema) }) } }, description: "Person message history" }, ...errorResponses([401, 403, 500]) },
  },
  async (context) => {
    const { eventId, personId } = context.req.valid("param");
    requireComms(context, eventId, false);
    const rows = await context.env.DB.prepare(
      `SELECT id, event_id, template_key, person_id, to_email, subject, html, text, status, send_policy, suppressed_reason, idempotency_key, provider_message_id, error, created_at, sent_at
       FROM outbox WHERE event_id = ? AND person_id = ? ORDER BY created_at DESC`,
    ).bind(eventId, personId).all<OutboxRow>();
    return context.json({ data: rows.results }, 200);
  },
);

const listCommunicationAudience = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/events/{eventId}/comms/audience",
    operationId: "listCommunicationAudience",
    summary: "List the filtered communication audience",
    description:
      "Resolve the canonical submissions list filters into one stable row per recipient without queueing mail.",
    tags: ["Comms"],
    request: { params: eventParams, query: audienceQuerySchema },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "read" }, concurrency: "none" },
    responses: { 200: audienceResponse, ...errorResponses([400, 401, 403, 404, 500]) },
  },
  async (context) => {
    const { eventId } = context.req.valid("param");
    requireComms(context, eventId, false);
    const query = context.req.valid("query");
    const result = await listCommsAudience(context.env.DB, { eventId, ...query });
    return context.json(result, 200);
  },
);

/**
 * Turning real mail on for an address is a heavier act than writing a message,
 * so it takes the same authority as editing the conference record itself
 * (`program:write`) rather than the ops role that may queue a send.
 */
function requireDemoMailAllowlistWrite(
  context: Parameters<NonNullable<ApiRouteEntry["handler"]>>[0],
  eventId: string,
): void {
  const auth = getAuth(context);
  if (!auth) throw ApiError.unauthenticated();
  if (auth.kind === "session") {
    if (!authHasRole(auth, "program_lead", eventId)) {
      throw ApiError.forbidden("changing which addresses receive real email requires a program lead or owner");
    }
    return;
  }
  if (!tokenHasGrant(auth, "program:write", eventId)) {
    throw ApiError.forbidden("changing which addresses receive real email requires program:write");
  }
}

/**
 * The organization this credential belongs to. Every allowlist query is scoped
 * by it, because a role alone does not answer "whose conference is this?" — an
 * org-wide membership carries `event_id = null` and therefore matches any event
 * id a caller cares to type, including another organization's.
 */
function demoMailAllowlistOrg(context: Parameters<NonNullable<ApiRouteEntry["handler"]>>[0]): string {
  const auth = getAuth(context);
  if (!auth) throw ApiError.unauthenticated();
  return auth.orgId;
}

/**
 * A conference outside this organization answers 404, not 403: it is not a
 * permission to explain, it is a conference this caller has no way of knowing
 * exists. The same convention `createEvent` already uses for `copy_from`.
 */
async function demoMailAllowlistState(
  db: D1Database,
  orgId: string,
  eventId: string,
): Promise<{ demo_mode: boolean; limit: number; emails: string[] }> {
  const [event, emails] = await Promise.all([
    demoMailEventInOrg(db, orgId, eventId),
    demoMailAllowlistForOrgEvent(db, orgId, eventId),
  ]);
  if (!event) throw ApiError.notFound("conference not found");
  return {
    // The list exists on every conference and is inert outside demo mode; the
    // screen needs to know which of those it is looking at so it can say so.
    demo_mode: event.demo_mode,
    limit: DEMO_MAIL_ALLOWLIST_LIMIT,
    emails,
  };
}

const getDemoMailAllowlist = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/events/{eventId}/demo-mail-allowlist",
    operationId: "getDemoMailAllowlist",
    summary: "List the addresses this conference sends real email to while in demo mode",
    tags: ["Comms"],
    request: { params: eventParams },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "read" }, concurrency: "none" },
    responses: { 200: jsonResponse(demoMailAllowlistResponse, "Addresses that receive real email"), ...errorResponses([401, 403, 404, 500]) },
  },
  async (context) => {
    const { eventId } = context.req.valid("param");
    requireComms(context, eventId, false);
    const orgId = demoMailAllowlistOrg(context);
    return context.json({ data: await demoMailAllowlistState(context.env.DB, orgId, eventId) }, 200);
  },
);

const putDemoMailAllowlist = defineApiRoute(
  {
    method: "put",
    path: "/api/v1/events/{eventId}/demo-mail-allowlist",
    operationId: "replaceDemoMailAllowlist",
    summary: "Replace the addresses this conference sends real email to while in demo mode",
    description:
      "The whole list is replaced. An empty array is a real choice — nobody receives real email — and is how the last address is removed.",
    tags: ["Comms"],
    request: { params: eventParams, body: { content: { "application/json": { schema: demoMailAllowlistInput } } } },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 200: jsonResponse(demoMailAllowlistResponse, "The saved list"), ...errorResponses([400, 401, 403, 404, 422, 429, 500]) },
  },
  async (context) => {
    const { eventId } = context.req.valid("param");
    requireDemoMailAllowlistWrite(context, eventId);
    const orgId = demoMailAllowlistOrg(context);
    const { emails } = context.req.valid("json");
    // Validated one address at a time so the message names the address that is
    // wrong, rather than rejecting a list of five for a typo in one.
    for (const email of emails) {
      if (!isAllowlistEmail(email)) {
        throw ApiError.unprocessable(`${describeRejectedEmail(email, "that")} is not a complete email address`, "emails");
      }
    }
    // Deduplicated before the cap is applied: two spellings of one address are
    // one address, and refusing the save over a repeat would be a lie.
    const normalized = parseAllowlist(JSON.stringify(emails.map(normalizeAllowlistEmail)));
    if (normalized.length > DEMO_MAIL_ALLOWLIST_LIMIT) {
      throw ApiError.unprocessable(`a conference can list at most ${DEMO_MAIL_ALLOWLIST_LIMIT} addresses`, "emails");
    }
    // The write is the authorization. A foreign event id derives no row, so the
    // statement changes nothing and reports it, rather than a guard above here
    // having promised something the write could still contradict.
    const saved = await writeDemoMailAllowlistForOrgEvent(context.env.DB, orgId, eventId, normalized, Date.now());
    if (saved === null) throw ApiError.notFound("conference not found");
    return context.json({ data: await demoMailAllowlistState(context.env.DB, orgId, eventId) }, 200);
  },
);

export const apiRoutes = [
  getTemplates,
  createTemplate,
  updateTemplate,
  previewComms,
  sendComms,
  getOutbox,
  getPersonMessages,
  listCommunicationAudience,
  getDemoMailAllowlist,
  putDemoMailAllowlist,
];

export type CommunicationAudienceItem = CommsRecipientRow;
