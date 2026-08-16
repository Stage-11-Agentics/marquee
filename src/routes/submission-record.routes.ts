import { z } from "@hono/zod-openapi";
import type { Context } from "hono";

import { ApiError } from "../api/errors";
import { newUlid } from "../api/ids";
import { BOARD_STAGE_LABELS, BOARD_STAGE_SQL, type BoardSlot } from "../api/board";
import { LIST_DEFAULTS } from "../api/list";
import { parseKeysetPagination, totalPages } from "../api/pagination";
import { defineApiRoute, errorResponses, jsonResponse } from "../api/route";
import type { ApiEnv } from "../api/runtime";
import type { DecisionActor } from "../jobs/cascade/decisions";
import { writeSubmissionDecision } from "../jobs/cascade/decisions";
import { drainCalendarCancellations, prepareCalendarCancellationBatch } from "../jobs/calendar/invites";
import { getAuth } from "../lib/auth/auth-middleware";
import { authHasRole, membershipAllowsGrant, roleForEvent, tokenHasGrant } from "../lib/auth/scope-resolution";
import { decisionHistory, decisionRecipient } from "../lib/decision-history";
import { heldBackReason } from "../lib/delivery-health";
import { classifySendFailure } from "../lib/mail-failure";
import {
  attachmentPreviewPath,
  isPreviewableImage,
  missingFileAnswer,
  readStoredFileAnswer,
  type FileAnswerView,
  type StoredFileAnswer,
} from "../lib/file-answers";
import { projectApplicableAnswers, type FormAnswerValue } from "../lib/form-conditions";
import { errorFields } from "../lib/observability/log";
import { requireDraftRead, requireSubmissionRead } from "../lib/auth/program-access";
import { auditStatement, auditStatementFromSelect, writeAudit } from "../lib/audit";
import { contentOf, isContentAction, recordTimelinePage } from "../lib/history";
import { purgePublicEmbedCache } from "../lib/public-site";
import { PUBLISHED_CONTENT_REFUSAL, requirePublishedConfirmation } from "../lib/publication-guard";
import { SUBMISSION_REFERENCE_CODE_SQL, withSubmissionReferenceRetry } from "../lib/submission-reference";

const eventParams = z.object({ eventId: z.string().min(1) });
const submissionParams = eventParams.extend({ submissionId: z.string().min(1) });
const recordResponse = jsonResponse(z.unknown(), "Submission record");

/**
 * How much of the timeline the record opens with. A talk that has been edited,
 * re-decided and re-mailed for six months has a long one, and the answer an
 * organizer opens the record for — what happened most recently — is on page one.
 */
const RECORD_TIMELINE_PAGE_SIZE = 40;

const timelineQuery = z.object({
  page: z.coerce.number().int().min(1).optional().catch(undefined)
    .openapi({ type: "integer", minimum: 1 }),
  per_page: z.coerce.number().int().min(1).max(LIST_DEFAULTS.maxPerPage).optional().catch(undefined)
    .openapi({ type: "integer", minimum: 1, maximum: LIST_DEFAULTS.maxPerPage }),
  cursor: z.string().min(1).optional().catch(undefined)
    .openapi({ type: "string" }),
});
const errors = errorResponses([400, 401, 403, 404, 409, 422, 429, 500]);

const personInput = z.object({
  person_id: z.string().min(1).optional(),
  name: z.string().trim().min(1).max(200).optional(),
  email: z.string().trim().email().optional(),
  company: z.string().trim().max(200).nullable().optional(),
  title: z.string().trim().max(200).nullable().optional(),
  bio: z.string().max(20_000).nullable().optional(),
  role: z.enum(["speaker", "co_speaker", "moderator", "chairperson", "submitter", "sponsor_contact"]).default("speaker"),
  position: z.number().int().min(0).optional(),
});

/**
 * The roles an organizer can attach after intake. `submitter` is deliberately
 * absent: a record has exactly one, it is written when the record is created,
 * and a second one would make authorship ambiguous everywhere it is read.
 */
const participantInput = personInput.omit({ role: true, position: true }).extend({
  role: z.enum(["speaker", "co_speaker", "moderator", "chairperson", "sponsor_contact"]).default("co_speaker"),
});

const participantParams = submissionParams.extend({ participationId: z.string().min(1) });

const answerInput = z.object({
  field_id: z.string().min(1),
  value_text: z.string().nullable().optional(),
  value_json: z.unknown().optional(),
});
type AnswerInput = z.infer<typeof answerInput>;

const createSubmissionInput = z.object({
  kind: z.enum(["abstract", "session"]),
  title: z.string().trim().min(1).max(500),
  abstract: z.string().nullable().optional(),
  form_id: z.string().nullable().optional(),
  bypass_evaluation: z.boolean().optional(),
  status: z.enum(["draft", "submitted", "in_review", "accepted", "waitlisted", "rejected", "withdrawn"]).optional(),
  submitter_person_id: z.string().min(1).optional(),
  submitter: personInput.omit({ role: true, position: true }).optional(),
  participants: z.array(personInput).max(100).optional(),
  participant_ids: z.array(z.string().min(1)).max(100).optional(),
  speaker_person_ids: z.array(z.string().min(1)).max(100).optional(),
  answers: z.array(answerInput).max(200).optional(),
  track_ids: z.array(z.string().min(1)).max(20).optional(),
  tracks: z.array(z.string().min(1)).max(20).optional(),
  primary_track_id: z.string().min(1).nullable().optional(),
  format_id: z.string().min(1).nullable().optional(),
  wave_id: z.string().min(1).nullable().optional(),
  applied_rule_id: z.string().min(1).nullable().optional(),
  vendor_affiliation: z.enum(["none", "vendor_to_fi", "vendor_with_champion"]).default("none"),
  external_ref: z.string().max(500).nullable().optional(),
});

/** Draft editing has no status input: opening or saving it cannot submit it. */
const patchDraftInput = z.object({
  title: z.string().trim().min(1).max(500).optional(),
  abstract: z.string().nullable().optional(),
  answers: z.array(answerInput).max(200).optional(),
});

const contentInput = z.object({
  title: z.string().trim().min(1).max(500).optional(),
  abstract: z.string().nullable().optional(),
  /** Required when the Session is already live on the public site. */
  confirm_published: z.boolean().optional(),
});

const restoreInput = z.object({
  audit_id: z.string().min(1),
  confirm_published: z.boolean().optional(),
});

const scheduleInput = z.object({
  starts_at: z.number().int(),
  duration_min: z.number().int().positive().max(24 * 60),
  room_id: z.string().min(1),
  track_id: z.string().min(1).nullable().optional(),
});

interface EventRow {
  id: string;
  name: string;
  org_id: string;
  timezone: string;
}

interface BaseRecordRow {
  id: string;
  reference_code: string | null;
  event_id: string;
  event_name: string;
  timezone: string;
  form_id: string | null;
  form_name: string | null;
  kind: "abstract" | "session";
  bypass_evaluation: number;
  title: string;
  abstract: string | null;
  status: string;
  format_id: string | null;
  format: string | null;
  primary_track_id: string | null;
  origin: "public" | "admin" | "import";
  vendor_affiliation: string;
  wave_id: string | null;
  wave: string | null;
  submitter_person_id: string;
  decided_at: number | null;
  decided_by_person_id: string | null;
  submitted_at: number | null;
  last_saved_at: number | null;
  is_published: number;
  external_ref: string | null;
  applied_rule_id: string | null;
  applied_rule_name: string | null;
  created_at: number;
  updated_at: number;
  stage: keyof typeof BOARD_STAGE_LABELS;
  starts_at: number | null;
  duration_min: number | null;
  room: string | null;
  building: string | null;
  agenda_published: number | null;
}

function jsonValue<T>(value: string | null | undefined, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function slotFor(row: BaseRecordRow): BoardSlot | null {
  if (row.starts_at === null || row.duration_min === null || row.room === null || row.building === null) return null;
  const date = new Date(row.starts_at);
  const parts = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: row.timezone,
  }).formatToParts(date);
  const part = (type: string): string => parts.find((item) => item.type === type)?.value ?? "";
  return {
    starts_at: row.starts_at,
    day: `${part("weekday")} · ${part("month")} ${part("day")}`,
    time: new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: row.timezone }).format(date),
    duration_min: row.duration_min,
    room: row.room,
    building: row.building,
    timezone: row.timezone,
    is_published: row.agenda_published === 1,
  };
}

async function eventFor(db: D1Database, eventId: string): Promise<EventRow> {
  const event = await db.prepare("SELECT id, name, org_id, timezone FROM events WHERE id = ?").bind(eventId).first<EventRow>();
  if (!event) throw ApiError.notFound("conference not found");
  return event;
}

async function actorFor(context: Context<ApiEnv>): Promise<DecisionActor> {
  const auth = getAuth(context);
  if (!auth) throw ApiError.unauthenticated();
  const requestId = context.get("requestId") ?? null;
  if (auth.kind === "session") return { kind: "user", personId: auth.personId, requestId };
  const token = await context.env.DB.prepare("SELECT created_by FROM api_tokens WHERE id = ?").bind(auth.tokenId).first<{ created_by: string }>();
  if (!token?.created_by) throw ApiError.unauthenticated("the token issuer is no longer available");
  return { kind: "api_token", personId: token.created_by, requestId };
}

/**
 * Can this caller actually write program content on this conference?
 *
 * The record is READABLE by ops staff and form admins, neither of whom holds
 * `program:write` — so rendering the content editor and the restore control on
 * a read grant alone would hand them fields whose Save returns 403 and loses
 * what they typed. The projection answers the question the UI needs to ask,
 * from the same grant the write routes enforce.
 */
function canWriteProgram(context: Context<ApiEnv>, eventId: string): boolean {
  const auth = getAuth(context);
  if (!auth) return false;
  if (auth.kind === "token") return tokenHasGrant(auth, "program:write", eventId);
  const role = roleForEvent(auth.memberships, eventId);
  return role !== null && membershipAllowsGrant(role, "program:write");
}

function canViewSubmissionNotes(context: Context<ApiEnv>, eventId: string): boolean {
  const auth = getAuth(context);
  return auth !== null && authHasRole(auth, "ops", eventId);
}

async function audit(
  db: D1Database,
  eventId: string,
  entityId: string,
  action: string,
  actor: DecisionActor,
  after: unknown,
): Promise<void> {
  await writeAudit(db, {
    eventId,
    actorKind: actor.kind,
    actorPersonId: actor.personId,
    action,
    entityType: "submission",
    entityId,
    after,
    now: Date.now(),
    requestId: actor.requestId,
  });
}

type PersonDetails = {
  person_id?: string | undefined;
  name?: string | undefined;
  email?: string | undefined;
  company?: string | null | undefined;
  title?: string | null | undefined;
  bio?: string | null | undefined;
};

/**
 * A person born on an organizer surface.
 *
 * The bio used to be a literal NULL here, so a speaker created through the
 * admin record was born with a hole the organizer could not see and the portal
 * round-trip could not explain. Both organizer doors — record creation and the
 * participants panel — mint people through this one statement so a person's
 * shape cannot depend on which screen typed them in.
 */
function newPersonStatement(db: D1Database, orgId: string, personId: string, input: PersonDetails, now: number): D1PreparedStatement {
  return db.prepare(`
    INSERT INTO people
      (id, org_id, email, name, title, company, bio, headshot_attachment_id, social_links, is_demo, last_write_source, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, NULL, '[]', 0, 'marquee', ?, ?)
  `).bind(personId, orgId, input.email ?? null, input.name ?? null, input.title ?? null, input.company ?? null, input.bio?.trim() || null, now, now);
}

/**
 * The person a participant control is talking about: an existing organization
 * record when `person_id` is given, the person already holding that address
 * when one is known, and a new person otherwise. The INSERT is returned rather
 * than run so the caller can land it in the same batch as the participation it
 * exists for — a person with no participation is a stray the organizer never
 * asked for.
 */
async function resolvePerson(
  db: D1Database,
  orgId: string,
  input: PersonDetails,
  now: number,
): Promise<{ personId: string; statements: D1PreparedStatement[] }> {
  if (input.person_id) {
    const person = await db.prepare("SELECT id FROM people WHERE id = ? AND org_id = ?").bind(input.person_id, orgId).first<{ id: string }>();
    if (!person) throw ApiError.unprocessable("person does not belong to this organization", "person_id");
    return { personId: input.person_id, statements: [] };
  }
  if (!input.name || !input.email) throw ApiError.unprocessable("a new participant needs a name and email", "participants");
  const existing = await db.prepare("SELECT id FROM people WHERE org_id = ? AND lower(email) = lower(?)").bind(orgId, input.email).first<{ id: string }>();
  if (existing) return { personId: existing.id, statements: [] };
  const personId = newUlid();
  return { personId, statements: [newPersonStatement(db, orgId, personId, input, now)] };
}

async function submissionFor(db: D1Database, eventId: string, submissionId: string): Promise<{ id: string; status: string }> {
  const row = await db.prepare("SELECT id, status FROM submissions WHERE id = ? AND event_id = ?").bind(submissionId, eventId).first<{ id: string; status: string }>();
  if (!row) throw ApiError.notFound("submission not found");
  return row;
}

/** Appended, not inserted: an addition never reorders the people already listed. */
async function nextParticipantPosition(db: D1Database, submissionId: string): Promise<number> {
  const row = await db.prepare("SELECT MAX(position) AS highest FROM participations WHERE submission_id = ?").bind(submissionId).first<{ highest: number | null }>();
  return (row?.highest ?? -1) + 1;
}

/**
 * The statuses whose title and abstract an organizer may edit.
 *
 * Explicit rather than "anything but draft" so adding a status later is a
 * decision someone has to make on purpose. `rejected` and `withdrawn` are out:
 * their content is a historical record of what was declined, and quietly
 * letting it be rewritten would make every past decision unreadable. There is
 * no `scheduled` or `published` status to list — a scheduled Session's status
 * is still `accepted`; placement lives in `agenda_items` and publication in
 * `agenda_items.is_published`, which is what the shared publication guard reads.
 */
const EDITABLE_CONTENT_STATUSES = ["draft", "submitted", "in_review", "accepted", "waitlisted"] as const;

/**
 * How many decision mails the record carries. A record that has been resent ten
 * times has a delivery problem the outbox surface should answer, not a history
 * the organizer reads on the record; the newest handful is what "which address
 * did this go to" needs.
 */
const DECISION_SEND_LIMIT = 6;

interface ContentState {
  title: string;
  abstract: string | null;
}

/**
 * Build the UPDATE and its audit row as one pair, for a single `batch()`.
 *
 * Both organizer doors (the drafts editor and the record's content editor) and
 * the restore all route through here. An audit row that lands in a different
 * transaction from the change it describes is worse than no audit row at all —
 * it reads as authoritative while being free to disagree with reality — so the
 * two statements are produced together and are never separable by a caller.
 *
 * `search_blob` is deliberately NOT written here. The `submissions_search_blob_update`
 * trigger (`migrations/0001_init.sql`) rebuilds it after any UPDATE of title or
 * abstract, and its expression trims where a hand-rolled one does not. Writing
 * the column here too would be dead code that quietly disagrees with the value
 * the database actually keeps.
 */
function contentWriteStatements(
  db: D1Database,
  eventId: string,
  submissionId: string,
  before: ContentState,
  after: ContentState,
  actor: DecisionActor,
  action: "content_updated" | "content_restored",
  now: number,
): D1PreparedStatement[] {
  return [
    db.prepare(
      `UPDATE submissions
       SET title = ?, abstract = ?, last_saved_at = ?, last_write_source = 'marquee', updated_at = ?
       WHERE id = ? AND event_id = ?`,
    ).bind(after.title, after.abstract, now, now, submissionId, eventId),
    auditStatement(db, {
      eventId,
      actorKind: actor.kind,
      actorPersonId: actor.personId,
      action,
      entityType: "submission",
      entityId: submissionId,
      before: { title: before.title, abstract: before.abstract },
      after: { title: after.title, abstract: after.abstract },
      now,
      requestId: actor.requestId,
    }),
  ];
}

interface EditableRow {
  id: string;
  form_id: string | null;
  status: string;
  title: string;
  abstract: string | null;
}

async function editableContentFor(
  db: D1Database,
  eventId: string,
  submissionId: string,
): Promise<EditableRow> {
  const row = await db
    .prepare("SELECT id, form_id, status, title, abstract FROM submissions WHERE id = ? AND event_id = ?")
    .bind(submissionId, eventId)
    .first<EditableRow>();
  if (!row) throw ApiError.notFound("submission not found");
  if (!(EDITABLE_CONTENT_STATUSES as readonly string[]).includes(row.status)) {
    throw ApiError.conflict(`a ${row.status} record's content cannot be edited`);
  }
  return row;
}

/**
 * A live session's content is the public site's content.
 *
 * The confirm is a real gate, not decoration: it is the only thing standing
 * between a stray keystroke on an organizer's screen and a changed public
 * agenda. The UI supplies it as a second click; an API caller supplies the flag
 * and thereby says the same thing out loud.
 */
interface AnswerProjection extends Record<string, unknown> {
  id: string;
  field_id: string | null;
  key: string | null;
  label: string | null;
  type: string | null;
  value_text: string | null;
  value_json: unknown;
  file: FileAnswerView | null;
}

/**
 * Answers as an organizer reads them. A `file` field carries a resolved
 * `file` view instead of leaving its storage payload to be stringified, and a
 * file field the speaker never uploaded is listed as missing rather than
 * silently omitted — the heading the form promised has to appear either way.
 */
async function projectAnswers(
  db: D1Database,
  input: { eventId: string; formId: string | null; submissionId: string; rows: Array<Record<string, unknown>> },
): Promise<AnswerProjection[]> {
  const answers: AnswerProjection[] = input.rows.map((answer) => ({
    ...answer,
    id: String(answer.id),
    field_id: answer.field_id === null ? null : String(answer.field_id),
    key: answer.key === null ? null : String(answer.key),
    label: answer.label === null ? null : String(answer.label),
    type: answer.type === null || answer.type === undefined ? null : String(answer.type),
    value_text: answer.value_text === null ? null : String(answer.value_text),
    value_json: answer.value_json === null ? null : jsonValue(answer.value_json as string, null),
    file: null,
  }));

  if (input.formId !== null) {
    const unanswered = await db.prepare(`
      SELECT field.id, field.key, field.label, field.type
      FROM form_fields field
      WHERE field.form_id = ? AND field.type = 'file'
        AND NOT EXISTS (
          SELECT 1 FROM submission_answers answer
          WHERE answer.submission_id = ? AND answer.field_id = field.id
        )
      ORDER BY field.position, field.id
    `).bind(input.formId, input.submissionId).all<{ id: string; key: string; label: string; type: string }>();
    for (const field of unanswered.results) {
      answers.push({
        id: `unanswered:${field.id}`,
        field_id: field.id,
        key: field.key,
        label: field.label,
        type: field.type,
        value_text: null,
        value_json: null,
        file: missingFileAnswer(),
      });
    }
  }

  const stored = new Map<string, StoredFileAnswer>();
  for (const answer of answers) {
    const payload = readStoredFileAnswer(answer.value_json);
    if (payload) stored.set(payload.attachmentId, payload);
  }
  const attachments = new Map<string, { content_type: string; filename: string; size_bytes: number; status: string }>();
  if (stored.size > 0) {
    const ids = [...stored.keys()];
    const rows = await db.prepare(`
      SELECT id, content_type, filename, size_bytes, status
      FROM attachments
      WHERE event_id = ? AND id IN (SELECT CAST(value AS TEXT) FROM json_each(?))
    `).bind(input.eventId, JSON.stringify(ids)).all<{
      id: string; content_type: string; filename: string; size_bytes: number; status: string;
    }>();
    for (const row of rows.results) attachments.set(row.id, row);
  }

  for (const answer of answers) {
    if (answer.file) continue;
    const payload = readStoredFileAnswer(answer.value_json);
    if (!payload) {
      // A file field whose stored value is not a usable upload reads as missing,
      // never as the raw value.
      if (answer.type === "file") answer.file = missingFileAnswer();
      continue;
    }
    const attachment = attachments.get(payload.attachmentId);
    if (!attachment || attachment.status !== "ready") {
      answer.file = missingFileAnswer();
      continue;
    }
    answer.file = {
      state: "ready",
      attachment_id: payload.attachmentId,
      filename: attachment.filename || payload.filename,
      content_type: attachment.content_type,
      size_bytes: attachment.size_bytes,
      preview_url: isPreviewableImage(attachment.content_type)
        ? attachmentPreviewPath(input.eventId, payload.attachmentId)
        : null,
    };
  }

  return answers;
}

/**
 * `canWriteProgram` defaults to true because every caller but two is a route
 * the grants policy has already gated — reaching them at all proves the grant.
 * The two `authenticated` routes (the record read and the drafts editor) pass
 * the resolved answer, because they admit principals who genuinely lack it.
 */
async function loadRecord(
  db: D1Database,
  eventId: string,
  submissionId: string,
  canWriteProgram = true,
  canViewNotes = false,
): Promise<Record<string, unknown>> {
  const row = await db.prepare(`
    SELECT
      s.id, s.reference_code, s.event_id, event.name AS event_name, event.timezone,
      s.form_id, form.name AS form_name, s.kind, s.bypass_evaluation,
      s.title, s.abstract, s.status, s.format_id, format.name AS format,
      s.primary_track_id, s.origin, s.vendor_affiliation, s.wave_id, wave.name AS wave,
      s.submitter_person_id, s.decided_at, s.decided_by_person_id, s.submitted_at,
      s.last_saved_at, s.is_published, s.external_ref, s.applied_rule_id,
      routing_rule.name AS applied_rule_name,
      s.created_at, s.updated_at, ${BOARD_STAGE_SQL} AS stage,
      ai.starts_at, ai.duration_min, room.name AS room, building.name AS building,
      ai.is_published AS agenda_published
    FROM submissions s
    JOIN events event ON event.id = s.event_id
    LEFT JOIN forms form ON form.id = s.form_id
    LEFT JOIN formats format ON format.id = s.format_id
    LEFT JOIN waves wave ON wave.id = s.wave_id
    LEFT JOIN routing_rules routing_rule ON routing_rule.id = s.applied_rule_id AND routing_rule.event_id = s.event_id
    LEFT JOIN agenda_items ai ON ai.submission_id = s.id AND ai.kind = 'session'
    LEFT JOIN rooms room ON room.id = ai.room_id
    LEFT JOIN buildings building ON building.id = room.building_id
    WHERE s.event_id = ? AND s.id = ?
  `).bind(eventId, submissionId).first<BaseRecordRow>();
  if (!row) throw ApiError.notFound("submission not found");

  const [participants, answers, tracks, decisions, reversals, evaluations, comparisons, history, rounds, criteria, reviewerOptions, decisionSends] = await Promise.all([
    db.prepare(`
      SELECT participation.id, participation.person_id, person.name, person.email, person.company,
        person.title, participation.role, participation.position, participation.confirmation_status,
        participation.confirmed_at, participation.invited_at
      FROM participations participation
      JOIN people person ON person.id = participation.person_id
      WHERE participation.submission_id = ?
      ORDER BY participation.position, participation.id
    `).bind(submissionId).all<Record<string, unknown>>(),
    db.prepare(`
      SELECT answer.id, answer.field_id, field.key, field.label, field.type, answer.value_text, answer.value_json
      FROM submission_answers answer
      LEFT JOIN form_fields field ON field.id = answer.field_id
      WHERE answer.submission_id = ?
      ORDER BY field.position, answer.id
    `).bind(submissionId).all<Record<string, unknown>>(),
    db.prepare(`
      SELECT carried.track_id AS id, track.name, track.color, carried.is_primary
      FROM submission_tracks carried
      JOIN tracks track ON track.id = carried.track_id
      WHERE carried.submission_id = ?
      ORDER BY carried.is_primary DESC, track.position, track.id
    `).bind(submissionId).all<Record<string, unknown>>(),
    db.prepare(`
      SELECT decision.id, decision.decision, decision.resulting_status, decision.feedback_md,
        decision.decided_at, decision.decided_by_person_id,
        CASE WHEN EXISTS (
          SELECT 1 FROM audit_log decision_audit
           WHERE decision_audit.event_id = decision.event_id
             AND decision_audit.entity_type = 'submission'
             AND decision_audit.entity_id = decision.submission_id
             AND decision_audit.actor_kind = 'airtable'
             AND decision_audit.action IN ('submission.approve', 'submission.maybe', 'submission.deny')
             AND json_extract(decision_audit.after_json, '$.decision_id') = decision.id
        ) THEN 'Airtable' ELSE person.name END AS decided_by_name
      FROM submission_decisions decision
      LEFT JOIN people person ON person.id = decision.decided_by_person_id
      WHERE decision.submission_id = ?
      ORDER BY decision.decided_at DESC, decision.id DESC
    `).bind(submissionId).all<Record<string, unknown>>(),
    // An acceptance reversal is the most consequential action on this screen —
    // it can cancel a real person's portal tasks, kill queued mail, and send a
    // calendar cancellation — and it was the only one leaving no trace in
    // Decision History. It cannot be a `submission_decisions` row: that table
    // CHECKs `resulting_status IN ('accepted','waitlisted','rejected')` and the
    // default reversal outcome is `withdrawn`. The audit log already records
    // everything needed, so this is a read that was missing, not a write.
    db.prepare(`
      SELECT reversal.id, reversal.after_json, reversal.created_at,
        reversal.actor_person_id, COALESCE(reversal.actor_name, person.name) AS actor_name
      FROM audit_log reversal
      LEFT JOIN people person ON person.id = reversal.actor_person_id
      WHERE reversal.event_id = ? AND reversal.entity_id = ?
        AND reversal.action = 'submission.acceptance_reversed'
      ORDER BY reversal.created_at DESC, reversal.id DESC
    `).bind(eventId, submissionId).all<Record<string, unknown>>(),
    db.prepare(`
      SELECT evaluation.id, evaluation.round_id, round.name AS round_name, round.position,
        evaluation.reviewer_person_id, person.name AS reviewer_name, person.kind AS reviewer_kind, evaluation.recommendation,
        evaluation.score, evaluation.comment, evaluation.criteria_scores, evaluation.abstained, evaluation.updated_at,
        evaluation.override_score, evaluation.override_comment, evaluation.override_at,
        evaluation.override_person_id, overrider.name AS override_person_name,
        -- The plan's scale travels with the evaluation so the override control
        -- can bound its own input. Without it the only way to learn the range
        -- is to submit an out-of-range value and be refused.
        plan.scale_min, plan.scale_max
      FROM evaluations evaluation
      JOIN evaluation_rounds round ON round.id = evaluation.round_id
      JOIN evaluation_plans plan ON plan.id = round.plan_id
      JOIN people person ON person.id = evaluation.reviewer_person_id
      LEFT JOIN people overrider ON overrider.id = evaluation.override_person_id
      WHERE plan.event_id = ? AND evaluation.submission_id = ?
      ORDER BY round.position, evaluation.updated_at DESC, evaluation.id
    `).bind(eventId, submissionId).all<Record<string, unknown>>(),
    db.prepare(`
      SELECT comparison.id, comparison.round_id, round.name AS round_name, round.position,
        round.mode, comparison.reviewer_person_id, person.name AS reviewer_name, person.kind AS reviewer_kind,
        comparison.submission_ids, comparison.ranking, comparison.created_at, comparison.updated_at
      FROM comparisons comparison
      JOIN evaluation_rounds round ON round.id = comparison.round_id
      JOIN evaluation_plans plan ON plan.id = round.plan_id
      JOIN people person ON person.id = comparison.reviewer_person_id
      WHERE plan.event_id = ?
        AND EXISTS (
          SELECT 1 FROM json_each(comparison.submission_ids) candidate
          WHERE CAST(candidate.value AS TEXT) = ?
        )
      ORDER BY round.position, comparison.updated_at DESC, comparison.id
    `).bind(eventId, submissionId).all<Record<string, unknown>>(),
    // Reads through the shared projection, which resolves `actor_person_id`
    // against `people`. Without that join the card had nothing but
    // `actor_kind` to render, and printed the literal string "user" where a
    // name belongs.
    // Lens three of MRQ-211: the same audit rows, read into sentences and paged.
    // The record opens with the most recent page; "Load more" walks the rest
    // through `GET …/timeline`, so a six-month-old session with hundreds of
    // rows costs the same first paint as a fresh one.
    recordTimelinePage(db, eventId, submissionId, parseKeysetPagination({ per_page: RECORD_TIMELINE_PAGE_SIZE })),
    db.prepare(`
      SELECT round.id, round.name, round.position, round.mode, round.target_reviews_per_submission,
        plan.id AS plan_id, plan.name AS plan_name, plan.status AS plan_status,
        assignment.id AS assignment_id, assignment.reviewer_person_id,
        assignment.committee_id, assignment.status AS assignment_status,
        person.name AS reviewer_name, person.kind AS reviewer_kind, person.company AS reviewer_company,
        (SELECT COUNT(*) FROM round_assignments covered
         WHERE covered.round_id = round.id AND covered.reviewer_person_id = assignment.reviewer_person_id) AS assigned_count,
        (SELECT COUNT(*) FROM evaluations reviewed
         WHERE reviewed.round_id = round.id AND reviewed.reviewer_person_id = assignment.reviewer_person_id
           AND reviewed.abstained = 0) AS reviewed_count
      FROM evaluation_rounds round
      JOIN evaluation_plans plan ON plan.id = round.plan_id
      LEFT JOIN round_assignments assignment
        ON assignment.round_id = round.id AND assignment.submission_id = ?
      LEFT JOIN people person ON person.id = assignment.reviewer_person_id
      WHERE plan.event_id = ?
      ORDER BY round.position, round.id, assignment.id
    `).bind(submissionId, eventId).all<Record<string, unknown>>(),
    /**
     * An evaluation's criteria_scores is a map keyed by criterion id, which
     * says nothing on its own. Without the rubric beside it the record can only
     * render the aggregate — and a scorecard whose free-text criterion holds the
     * reviewer's written rationale shows the organizer nothing at all.
     */
    db.prepare(`
      SELECT criterion.id, criterion.round_id, criterion.name, criterion.kind,
        criterion.weight_pct, criterion.position
      FROM rubric_criteria criterion
      JOIN evaluation_rounds round ON round.id = criterion.round_id
      JOIN evaluation_plans plan ON plan.id = round.plan_id
      WHERE plan.event_id = ?
      ORDER BY criterion.round_id, criterion.position
    `).bind(eventId).all<Record<string, unknown>>(),
    db.prepare(`
      SELECT DISTINCT person.id, person.name, person.kind, person.company,
        COALESCE((SELECT json_group_array(scope.track_id) FROM reviewer_track_scopes scope WHERE scope.event_id = membership.event_id AND scope.person_id = person.id), '[]') AS track_ids
      FROM memberships membership
      JOIN people person ON person.id = membership.person_id
      WHERE membership.event_id = ? AND membership.role = 'reviewer'
      ORDER BY person.name COLLATE NOCASE, person.id
    `).bind(eventId).all<Record<string, unknown>>(),
    // Every decision mail this record has produced, newest first. "Correct the
    // address, then send again" is only actionable if the organizer can see
    // which address the last attempt actually used — otherwise they resend to
    // the same wrong mailbox and learn nothing. The original send carries the
    // submission id as its entity; a bulk notify or a deliberate retry carries
    // the decision id, so both keys are asked for. Served by
    // `idx_outbox_entity_status(event_id, entity_id, status)`.
    db.prepare(`
      SELECT mail.id, mail.to_email, mail.template_key, mail.status, mail.delivery_state,
        mail.suppressed_reason, mail.error, mail.created_at, mail.sent_at, mail.delivered_at
      FROM outbox mail
      WHERE mail.event_id = ?
        AND mail.template_key IN ('acceptance', 'rejection')
        AND (
          mail.entity_id = ?
          OR mail.entity_id IN (SELECT id FROM submission_decisions WHERE submission_id = ?)
        )
      ORDER BY mail.created_at DESC, mail.id DESC
      LIMIT ${DECISION_SEND_LIMIT}
    `).bind(eventId, submissionId, submissionId).all<Record<string, unknown>>(),
  ]);

  const roundMap = new Map<string, Record<string, unknown>>();
  for (const item of rounds.results) {
    const current = roundMap.get(String(item.id)) ?? {
      id: item.id,
      name: item.name,
      position: Number(item.position),
      plan_id: item.plan_id,
      plan_name: item.plan_name,
      plan_status: item.plan_status,
      mode: item.mode,
      target_reviews_per_submission: Number(item.target_reviews_per_submission),
      criteria: criteria.results
        .filter((criterion) => String(criterion.round_id) === String(item.id))
        .map((criterion) => ({
          id: criterion.id,
          name: criterion.name,
          kind: criterion.kind,
          weight_pct: Number(criterion.weight_pct ?? 0),
          position: Number(criterion.position ?? 0),
        })),
      reviewers: [],
      evaluations: [],
      comparisons: [],
    };
    if (item.assignment_id !== null) {
      (current.reviewers as Array<Record<string, unknown>>).push({
        assignment_id: item.assignment_id,
        reviewer_person_id: item.reviewer_person_id,
        reviewer_name: item.reviewer_name,
        reviewer_kind: item.reviewer_kind,
        reviewer_company: item.reviewer_company,
        committee_id: item.committee_id,
        status: item.assignment_status,
        coverage: {
          assigned: Number(item.assigned_count ?? 0),
          reviewed: Number(item.reviewed_count ?? 0),
        },
      });
    }
    roundMap.set(String(item.id), current);
  }

  const evaluationEvidence: Array<Record<string, unknown>> = evaluations.results.map((evaluation) => ({
    ...evaluation,
    abstained: Number(evaluation.abstained ?? 0) === 1,
    criteria_scores: evaluation.criteria_scores === null ? null : jsonValue(evaluation.criteria_scores as string, null),
  }));
  for (const evaluation of evaluationEvidence) {
    const round = roundMap.get(String(evaluation.round_id));
    if (round) (round.evaluations as Array<Record<string, unknown>>).push(evaluation);
  }

  const comparisonEvidence: Array<Record<string, unknown>> = comparisons.results.map((comparison) => ({
    ...comparison,
    ranking: jsonValue(comparison.ranking as string, []),
    submission_ids: jsonValue(comparison.submission_ids as string, []),
  }));
  for (const comparison of comparisonEvidence) {
    const round = roundMap.get(String(comparison.round_id));
    if (round) (round.comparisons as Array<Record<string, unknown>>).push(comparison);
  }

  const normalizedAnswers = await projectAnswers(db, {
    eventId: row.event_id,
    formId: row.form_id,
    submissionId,
    rows: answers.results,
  });
  const slot = slotFor(row);
  const hours = Math.max(0, Math.floor((Date.now() - row.updated_at) / 3_600_000));
  return {
    id: row.id,
    reference_code: row.reference_code,
    event_id: row.event_id,
    event_name: row.event_name,
    kind: row.kind,
    title: row.title,
    abstract: row.abstract,
    status: row.status,
    stage: row.stage,
    stage_label: BOARD_STAGE_LABELS[row.stage],
    bypass_evaluation: row.bypass_evaluation === 1,
    origin: row.origin,
    vendor_affiliation: row.vendor_affiliation,
    external_ref: row.external_ref,
    form: row.form_id === null ? null : { id: row.form_id, name: row.form_name },
    format: row.format_id === null ? null : { id: row.format_id, name: row.format },
    primary_track_id: row.primary_track_id,
    wave: row.wave_id === null ? null : { id: row.wave_id, name: row.wave },
    submitter_person_id: row.submitter_person_id,
    submitted_at: row.submitted_at,
    last_saved_at: row.last_saved_at,
    decided_at: row.decided_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    time_in_stage_hours: hours,
    time_in_stage: hours < 24 ? `${hours}h in stage` : `${Math.floor(hours / 24)}d in stage`,
    slot,
    // Publication belongs to the agenda placement. The submission column is a
    // legacy mirror and may lag during imports or older reversals.
    is_published: row.agenda_published === 1,
    tracks: tracks.results.map((track) => ({ ...track, is_primary: Boolean(track.is_primary) })),
    participants: participants.results,
    answers: normalizedAnswers,
    decisions: decisionHistory(decisions.results, reversals.results),
    decision_recipient: decisionRecipient(participants.results),
    decision_sends: decisionSends.results.map((send) => ({
      id: send.id,
      to_email: send.to_email,
      kind: send.template_key === "acceptance" ? "accepted" : "rejected",
      status: send.status,
      delivery_state: send.delivery_state ?? "unknown",
      // One line the organizer can read, whichever way the attempt ended. The
      // stored values are machine slugs and provider prose; neither belongs on
      // a record, and both already have organizer-facing translations.
      reason: send.suppressed_reason
        ? heldBackReason(String(send.suppressed_reason))
        : send.error
          ? classifySendFailure(String(send.error)).reason
          : null,
      created_at: send.created_at,
      sent_at: send.sent_at,
      delivered_at: send.delivered_at,
    })),
    evaluations: evaluationEvidence,
    comparisons: comparisonEvidence,
    routing: row.applied_rule_id === null ? null : {
      rule_id: row.applied_rule_id,
      name: row.applied_rule_name ?? "Unnamed routing rule",
    },
    evaluation: {
      rounds: [...roundMap.values()],
      reviewer_options: reviewerOptions.results.map((reviewer) => ({
        ...reviewer,
        track_ids: jsonValue(reviewer.track_ids as string, []),
      })),
    },
    history: history.entries.map((entry) => ({
      ...entry,
      // Kept for the existing wire shape; `after` carries the parsed value.
      after_json: entry.after,
    })),
    history_total: history.total,
    history_next_cursor: history.nextCursor,
    history_has_more: history.hasMore,
    actions: {
      // `declined` covers waitlisted, rejected, and withdrawn. All three stay
      // decidable: Maybe is a holding state the organizer resolves later, and
      // re-acceptance is already supported as an idempotent reconciliation, so
      // the record must keep a way back.
      can_decide: ["submitted", "in_review", "accepted", "waved", "declined"].includes(row.stage),
      can_schedule: row.kind === "session" && row.stage === "accepted" && slot === null && canWriteProgram,
      // Publishing is gated on the STORED status, not the derived stage: a
      // reversal leaves the agenda row in place, so a withdrawn record still
      // derives to `scheduled` and a stage test would happily publish it to
      // the public site.
      can_publish: slot !== null && !slot.is_published && row.status === "accepted" && canWriteProgram,
      can_unpublish: slot !== null && slot.is_published && canWriteProgram,
      // The UI renders the content editor and the restore control from this one
      // field, so it must answer exactly what the write routes enforce — which
      // is not one policy but two. Drafts go to `patchDraft`, gated on
      // `requireDraftRead`; reaching this projection for a draft has already
      // satisfied it, and form admins legitimately edit drafts with no
      // membership role at all (AC-247–249). Everything past Draft goes to
      // `updateSubmissionContent`, which requires `program:write`. Demanding
      // the grant on both would quietly take draft editing away from the
      // people the drafts queue exists for.
      can_edit_content: (EDITABLE_CONTENT_STATUSES as readonly string[]).includes(row.status)
        && (row.status === "draft" || canWriteProgram),
      // Restore has only ONE door — `restoreSubmissionContent`, which requires
      // `program:write` at every status including Draft. So it needs its own
      // flag: reusing `can_edit_content` would offer a form admin a Restore
      // button on a draft they may edit but may not restore, which is the same
      // dead end this pair exists to prevent, merely pointed the other way.
      can_restore_content: (EDITABLE_CONTENT_STATUSES as readonly string[]).includes(row.status) && canWriteProgram,
      // A resend is a deliberate write against an existing accepted/rejected
      // decision. The projection must not offer it to read-only operators or
      // to records whose status no longer matches a durable decision row.
      can_resend_decision: ["accepted", "rejected"].includes(row.status)
        && decisions.results.some((decision) => decision.resulting_status === row.status)
        && canWriteProgram,
      // Who is on stage is not content editing: a co-presenter is added to a
      // record at any status, including one already accepted and scheduled —
      // which is exactly when the organizer finds out about them. The one gate
      // is the grant the participants routes enforce.
      can_edit_participants: canWriteProgram,
      // Overriding a recorded score is the chair's authority over the review,
      // not the reviewer's, so it answers `program:write` and nothing else.
      can_override_scores: canWriteProgram,
      can_view_notes: canViewNotes,
    },
  };
}

async function validateOwnedIds(
  db: D1Database,
  orgId: string,
  eventId: string,
  body: z.infer<typeof createSubmissionInput>,
): Promise<{ trackIds: string[]; formatId: string | null; waveId: string | null; answers: AnswerInput[] }> {
  const trackIds = [...new Set([...(body.track_ids ?? body.tracks ?? []), ...(body.primary_track_id ? [body.primary_track_id] : [])])];
  if (trackIds.length > 0) {
    const result = await db.prepare(`SELECT id FROM tracks WHERE event_id = ? AND id IN (${trackIds.map(() => "?").join(",")})`).bind(eventId, ...trackIds).all<{ id: string }>();
    if (result.results.length !== trackIds.length) throw ApiError.unprocessable("every track must belong to this conference", "track_ids");
  }
  const formatId = body.format_id ?? null;
  if (formatId) {
    const format = await db.prepare("SELECT id FROM formats WHERE id = ? AND event_id = ?").bind(formatId, eventId).first();
    if (!format) throw ApiError.unprocessable("format does not belong to this conference", "format_id");
  }
  const waveId = body.wave_id ?? null;
  if (waveId) {
    const wave = await db.prepare("SELECT id FROM waves WHERE id = ? AND event_id = ?").bind(waveId, eventId).first();
    if (!wave) throw ApiError.unprocessable("wave does not belong to this conference", "wave_id");
  }
  if (body.form_id) {
    const form = await db.prepare("SELECT id, kind FROM forms WHERE id = ? AND event_id = ?").bind(body.form_id, eventId).first<{ id: string; kind: string }>();
    if (!form) throw ApiError.unprocessable("form does not belong to this conference", "form_id");
    if (form.kind !== body.kind) throw ApiError.unprocessable("form kind must match the submission kind", "form_id");
  }
  if (body.applied_rule_id) {
    const rule = await db.prepare("SELECT id FROM routing_rules WHERE id = ? AND event_id = ?").bind(body.applied_rule_id, eventId).first();
    if (!rule) throw ApiError.unprocessable("routing rule does not belong to this conference", "applied_rule_id");
  }
  const answers = body.answers as AnswerInput[] | undefined;
  let projectedAnswers: AnswerInput[] = [];
  if (answers?.length) {
    const fields = await db.prepare(`
      SELECT field.id, field.key, field.required, field.type, field.config, field.condition
      FROM form_fields field
      JOIN forms form ON form.id = field.form_id AND form.event_id = ?
      WHERE field.form_id = COALESCE(?, (SELECT form_id FROM form_fields WHERE id = ?))
    `).bind(eventId, body.form_id ?? null, answers[0]!.field_id).all<{
      id: string;
      key: string;
      required: 0 | 1;
      type: string;
      config: string | null;
      condition: string | null;
    }>();
    const fieldsById = new Map(fields.results.map((field) => [field.id, field]));
    const suppliedFields = answers.map((answer) => fieldsById.get(answer.field_id));
    if (suppliedFields.some((field) => !field)) throw ApiError.unprocessable("every answer field must belong to this form", "answers");

    const rawAnswers: Record<string, unknown> = {};
    for (const [index, answer] of answers.entries()) {
      const field = suppliedFields[index]!;
      rawAnswers[field.key] = answer.value_json === undefined ? answer.value_text ?? null : answer.value_json;
    }
    const projection = projectApplicableAnswers(fields.results, rawAnswers);
    const suppliedKeys = new Set(suppliedFields.map((field) => field!.key));
    const issues = projection.issues.filter((issue) => suppliedKeys.has(issue.fieldKey));
    if (issues.length > 0) {
      throw ApiError.unprocessable("one or more supplied answers are invalid", issues[0]!.fieldKey, issues);
    }
    const fieldsByKey = new Map(fields.results.map((field) => [field.key, field]));
    projectedAnswers = Object.entries(projection.answers).flatMap(([key, value]) => {
      const field = fieldsByKey.get(key);
      if (!field) return [];
      const answer: AnswerInput = { field_id: field.id };
      if (typeof value === "string") answer.value_text = value;
      else answer.value_json = value as FormAnswerValue;
      return [answer];
    });
  }
  // Keep the event organization in the function signature: it makes the
  // person ownership check below explicit at the call site and prevents a
  // future caller from silently widening the lookup.
  void orgId;
  return { trackIds, formatId, waveId, answers: projectedAnswers };
}

const createSubmission = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/events/{eventId}/submissions",
    operationId: "createAdminSubmission",
    summary: "Create an admin conference submission",
    description: "Create an Abstract or Session directly in the program record, with optional evaluation bypass and record participants.",
    tags: ["Submissions"],
    request: { params: eventParams, body: { content: { "application/json": { schema: createSubmissionInput } } } },
    policy: { auth: { kind: "grants", grants: ["program:write"] }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 201: recordResponse, ...errors },
  },
  async (context) => {
    const { eventId } = context.req.valid("param");
    const event = await eventFor(context.env.DB, eventId);
    const body = context.req.valid("json");
    const actor = await actorFor(context);
    const now = Date.now();
    const owned = await validateOwnedIds(context.env.DB, event.org_id, eventId, body);
    const personStatements: D1PreparedStatement[] = [];
    const knownPeople = new Set<string>();
    const makePerson = async (input: { person_id?: string; name?: string; email?: string; company?: string | null; title?: string | null; bio?: string | null }): Promise<string> => {
      if (input.person_id) {
        if (knownPeople.has(input.person_id)) return input.person_id;
        const person = await context.env.DB.prepare("SELECT id FROM people WHERE id = ? AND org_id = ?").bind(input.person_id, event.org_id).first();
        if (!person) throw ApiError.unprocessable("person does not belong to this organization", "person_id");
        knownPeople.add(input.person_id);
        return input.person_id;
      }
      if (!input.name || !input.email) throw ApiError.unprocessable("a new participant needs a name and email", "participants");
      const existing = await context.env.DB.prepare(
        "SELECT id FROM people WHERE org_id = ? AND lower(email) = lower(?)",
      ).bind(event.org_id, input.email).first<{ id: string }>();
      if (existing) {
        knownPeople.add(existing.id);
        return existing.id;
      }
      const id = newUlid();
      personStatements.push(newPersonStatement(context.env.DB, event.org_id, id, input, now));
      knownPeople.add(id);
      return id;
    };

    const submitterId = await makePerson(body.submitter ?? { person_id: body.submitter_person_id ?? actor.personId });
    const participants: Array<{ personId: string; role: string; position: number }> = [];
    const participantKeys = new Set<string>();
    const addParticipant = (personId: string, role: string, position: number) => {
      const key = `${personId}:${role}`;
      if (participantKeys.has(key)) return;
      participantKeys.add(key);
      participants.push({ personId, role, position });
    };
    for (const id of [...(body.participant_ids ?? []), ...(body.speaker_person_ids ?? [])]) addParticipant(await makePerson({ person_id: id }), "speaker", participants.length);
    for (const [index, participant] of (body.participants ?? []).entries()) {
      addParticipant(await makePerson(participant), participant.role, participant.position ?? index);
    }
    // A Session born on the organizer's builder has a person attached to it as
    // its speaker of record, unless that attachment is explicitly a private
    // sponsor contact. A sponsor contact with no named speaker is an honest
    // public "Speaker to be announced" state, not permission to publish the
    // contact's name. Keep the submitter role as authorship metadata, but never
    // make a builder-created Session public-speaker empty by leaving its only
    // ordinary attached person submitter-only.
    const submitterIsSponsorContact = participants.some((participant) =>
      participant.personId === submitterId && participant.role === "sponsor_contact",
    );
    if (body.kind === "session" && !submitterIsSponsorContact) {
      addParticipant(submitterId, "speaker", participants.length);
    }
    addParticipant(submitterId, "submitter", participants.length);

    const participantIds = [...new Set(participants.map((participant) => participant.personId))];
    if (participantIds.some((id) => !knownPeople.has(id))) throw new Error("participant ownership was not resolved");
    const status = body.status ?? (body.kind === "session" && (body.bypass_evaluation ?? true) ? "accepted" : "submitted");
    const id = newUlid();
    const statements: D1PreparedStatement[] = [
      ...personStatements,
      context.env.DB.prepare(`
        INSERT INTO submissions
          (id, event_id, reference_code, form_id, kind, bypass_evaluation, title, abstract, status,
           format_id, primary_track_id, origin, vendor_affiliation, wave_id,
           submitter_person_id, decided_at, decided_by_person_id, submitted_at,
           last_saved_at, resume_token_hash, is_published, external_ref,
           applied_rule_id, last_write_source, created_at, updated_at)
        VALUES (?, ?, ${SUBMISSION_REFERENCE_CODE_SQL}, ?, ?, ?, ?, ?, ?, ?, ?, 'admin', ?, ?, ?, ?, ?, ?, ?, NULL, 0, ?, ?, 'marquee', ?, ?)
      `).bind(
        id, eventId, eventId, body.form_id ?? null, body.kind, body.kind === "session" || body.bypass_evaluation ? 1 : 0,
        body.title.trim(), body.abstract ?? null, status, owned.formatId,
        body.primary_track_id ?? owned.trackIds[0] ?? null, body.vendor_affiliation, owned.waveId,
        submitterId, status === "accepted" ? now : null, status === "accepted" ? actor.personId : null,
        status === "draft" ? null : now, now, body.external_ref ?? null, body.applied_rule_id ?? null, now, now,
      ),
      ...participants.map((participant) => context.env.DB.prepare(`
        INSERT INTO participations
          (id, submission_id, person_id, role, position, confirmation_status, confirmed_at, invited_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'pending', NULL, NULL, ?, ?)
      `).bind(newUlid(), id, participant.personId, participant.role, participant.position, now, now)),
      ...owned.trackIds.map((trackId) => context.env.DB.prepare(`
        INSERT INTO submission_tracks (id, submission_id, track_id, is_primary, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(newUlid(), id, trackId, trackId === (body.primary_track_id ?? owned.trackIds[0]) ? 1 : 0, now, now)),
      ...owned.answers.map((answer) => context.env.DB.prepare(`
        INSERT INTO submission_answers (id, submission_id, field_id, value_text, value_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(newUlid(), id, answer.field_id, answer.value_text ?? null, answer.value_json === undefined ? null : JSON.stringify(answer.value_json), now, now)),
      auditStatement(context.env.DB, {
        eventId,
        actorKind: actor.kind,
        actorPersonId: actor.personId,
        action: "created",
        entityType: "submission",
        entityId: id,
        after: { origin: "admin", kind: body.kind, status, bypass_evaluation: body.kind === "session" || body.bypass_evaluation === true },
        now,
        requestId: actor.requestId,
      }),
    ];
    try {
      await withSubmissionReferenceRetry(() => context.env.DB.batch(statements));
    } catch (error) {
      context.get("logger")?.emit("worker_error", "error", {
        source: "createSubmissionRecord",
        ...errorFields(error),
      });
      throw ApiError.conflict("the submission could not be created with those record relationships");
    }
    return context.json(await loadRecord(context.env.DB, eventId, id), 201);
  },
);

const getSubmissionRecord = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/events/{eventId}/submissions/{submissionId}",
    operationId: "getSubmissionRecord",
    summary: "Read the full conference submission record",
    tags: ["Submissions"],
    request: { params: submissionParams },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "read" }, concurrency: "none" },
    responses: { 200: recordResponse, ...errors },
  },
  async (context) => {
    const { eventId, submissionId } = context.req.valid("param");
    await eventFor(context.env.DB, eventId);
    const submission = await context.env.DB.prepare("SELECT status FROM submissions WHERE id = ? AND event_id = ?").bind(submissionId, eventId).first<{ status: string }>();
    if (!submission) throw ApiError.notFound("submission not found");
    if (submission.status === "draft") await requireDraftRead(context, eventId);
    else await requireSubmissionRead(context, eventId);
    return context.json(await loadRecord(context.env.DB, eventId, submissionId, canWriteProgram(context, eventId), canViewSubmissionNotes(context, eventId)), 200);
  },
);

/**
 * Lens three of MRQ-211, paginated: this record's timeline.
 *
 * Submitted, routed, reviewed, decided, reversed, re-accepted, mailed — each
 * with its author and its moment. It reads the same `audit_log` rows the record
 * opens with, so the page and this endpoint can never tell different stories
 * about the same session.
 */
const getSubmissionTimeline = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/events/{eventId}/submissions/{submissionId}/timeline",
    operationId: "getSubmissionTimeline",
    summary: "Read one submission's timeline",
    description:
      "Every audited moment on this record, newest first, each read into a sentence with its author and timestamp. This is the answer to \"why is this talk in this state\".",
    tags: ["Submissions"],
    request: { params: submissionParams, query: timelineQuery },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "read" }, concurrency: "none" },
    responses: { 200: jsonResponse(z.unknown(), "Submission timeline"), ...errors },
  },
  async (context) => {
    const { eventId, submissionId } = context.req.valid("param");
    await eventFor(context.env.DB, eventId);
    const submission = await context.env.DB
      .prepare("SELECT status FROM submissions WHERE id = ? AND event_id = ?")
      .bind(submissionId, eventId)
      .first<{ status: string }>();
    if (!submission) throw ApiError.notFound("submission not found");
    // The same two-policy gate the record read applies: a draft is readable by
    // the form's admins, everything past it needs program read.
    if (submission.status === "draft") await requireDraftRead(context, eventId);
    else await requireSubmissionRead(context, eventId);
    const query = context.req.valid("query");
    const page = parseKeysetPagination({ ...query, per_page: query.per_page ?? RECORD_TIMELINE_PAGE_SIZE });
    const timeline = await recordTimelinePage(context.env.DB, eventId, submissionId, page);
    return context.json(
      {
        data: timeline.entries,
        page: page.page,
        per_page: page.perPage,
        total: timeline.total,
        total_pages: totalPages(timeline.total, page.perPage),
        next_cursor: timeline.nextCursor,
        has_more: timeline.hasMore,
      },
      200,
    );
  },
);

const patchDraft = defineApiRoute(
  {
    method: "patch",
    path: "/api/v1/events/{eventId}/submissions/{submissionId}",
    operationId: "patchDraftSubmission",
    summary: "Edit a conference draft without submitting it",
    description: "Draft edits preserve Draft status; the queue derives applicable missing fields through the shared condition evaluator.",
    tags: ["Submissions"],
    request: { params: submissionParams, body: { content: { "application/json": { schema: patchDraftInput } } } },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 200: recordResponse, ...errors },
  },
  async (context) => {
    const { eventId, submissionId } = context.req.valid("param");
    const body = context.req.valid("json");
    await eventFor(context.env.DB, eventId);
    const submission = await context.env.DB.prepare("SELECT id, form_id, status, title, abstract FROM submissions WHERE id = ? AND event_id = ?").bind(submissionId, eventId).first<EditableRow>();
    if (!submission) throw ApiError.notFound("submission not found");
    if (submission.status !== "draft") throw ApiError.conflict("only Draft records can be edited from the Drafts needing attention queue");
    await requireDraftRead(context, eventId);

    const now = Date.now();
    const before: ContentState = { title: submission.title, abstract: submission.abstract };
    const after: ContentState = {
      title: body.title ?? submission.title,
      abstract: body.abstract === undefined ? submission.abstract : body.abstract,
    };
    const contentChanged = after.title !== before.title || after.abstract !== before.abstract;
    // A draft edit is a content edit like any other: it earns the same audited
    // before/after row and the same search-index maintenance. Answers-only
    // saves write no content row, because nothing about the content changed.
    const statements: D1PreparedStatement[] = contentChanged
      ? contentWriteStatements(context.env.DB, eventId, submissionId, before, after, await actorFor(context), "content_updated", now)
      : [context.env.DB.prepare("UPDATE submissions SET last_saved_at = ?, updated_at = ? WHERE id = ? AND event_id = ? AND status = 'draft'").bind(now, now, submissionId, eventId)];

    if (body.answers !== undefined) {
      if (!submission.form_id) throw ApiError.unprocessable("a draft without a form cannot accept field answers", "answers");
      const fields = await context.env.DB.prepare("SELECT id, key, required, type, config, condition FROM form_fields WHERE form_id = ? ORDER BY position, id").bind(submission.form_id).all<{
        id: string;
        key: string;
        required: 0 | 1;
        type: string;
        config: string | null;
        condition: string | null;
      }>();
      const fieldsById = new Map(fields.results.map((field) => [field.id, field]));
      const rawAnswers: Record<string, unknown> = {};
      for (const answer of body.answers) {
        const field = fieldsById.get(answer.field_id);
        if (!field) throw ApiError.unprocessable("every answer field must belong to this draft's form", "answers");
        rawAnswers[field.key] = answer.value_json === undefined ? answer.value_text ?? null : answer.value_json;
      }
      const projection = projectApplicableAnswers(fields.results, rawAnswers);
      // This is still a draft: incomplete visible answers remain valid draft
      // state, while the queue derives the missing-field attention from the
      // same projection. Persist only its normalized, currently applicable map.
      const fieldsByKey = new Map(fields.results.map((field) => [field.key, field]));
      statements.push(context.env.DB.prepare("DELETE FROM submission_answers WHERE submission_id = ?").bind(submissionId));
      for (const [key, value] of Object.entries(projection.answers)) {
        const field = fieldsByKey.get(key);
        if (!field) continue;
        statements.push(context.env.DB.prepare(`
          INSERT INTO submission_answers (id, submission_id, field_id, value_text, value_json, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).bind(
          newUlid(), submissionId, field.id,
          typeof value === "string" ? value : null,
          typeof value === "string" ? null : JSON.stringify(value),
          now, now,
        ));
      }
    }
    await context.env.DB.batch(statements);
    return context.json(await loadRecord(context.env.DB, eventId, submissionId, canWriteProgram(context, eventId), canViewSubmissionNotes(context, eventId)), 200);
  },
);

const updateSubmissionContent = defineApiRoute(
  {
    method: "patch",
    path: "/api/v1/events/{eventId}/submissions/{submissionId}/content",
    operationId: "updateSubmissionContent",
    summary: "Edit a Session's title and abstract",
    description:
      "Organizer content editing for records past Draft. Every change writes a before/after history row in the same transaction; a live Session requires confirm_published.",
    tags: ["Submissions"],
    request: { params: submissionParams, body: { content: { "application/json": { schema: contentInput } } } },
    policy: { auth: { kind: "grants", grants: ["program:write"] }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 200: recordResponse, ...errors },
  },
  async (context) => {
    const { eventId, submissionId } = context.req.valid("param");
    const body = context.req.valid("json");
    if (body.title === undefined && body.abstract === undefined) {
      throw ApiError.badRequest("title or abstract is required");
    }
    await eventFor(context.env.DB, eventId);
    const current = await editableContentFor(context.env.DB, eventId, submissionId);
    const before: ContentState = { title: current.title, abstract: current.abstract };
    const after: ContentState = {
      title: body.title ?? current.title,
      abstract: body.abstract === undefined ? current.abstract : body.abstract,
    };
    // A save that changed nothing writes nothing. A history padded with rows
    // that say "changed nothing" is the fastest way to make an honest history
    // panel unreadable, and the organizer learns to stop trusting it.
    if (after.title === before.title && after.abstract === before.abstract) {
      return context.json(await loadRecord(context.env.DB, eventId, submissionId), 200);
    }
    await requirePublishedConfirmation(context.env.DB, eventId, submissionId, body.confirm_published === true, PUBLISHED_CONTENT_REFUSAL);
    const actor = await actorFor(context);
    await context.env.DB.batch(
      contentWriteStatements(context.env.DB, eventId, submissionId, before, after, actor, "content_updated", Date.now()),
    );
    return context.json(await loadRecord(context.env.DB, eventId, submissionId), 200);
  },
);

const restoreSubmissionContent = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/events/{eventId}/submissions/{submissionId}/content/restore",
    operationId: "restoreSubmissionContent",
    summary: "Restore an earlier version of a Session's content",
    description:
      "Re-applies the state a named history entry recorded before its change, as a forward edit with its own before/after row. No existing history row is ever altered or removed.",
    tags: ["Submissions"],
    request: { params: submissionParams, body: { content: { "application/json": { schema: restoreInput } } } },
    policy: { auth: { kind: "grants", grants: ["program:write"] }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 200: recordResponse, ...errors },
  },
  async (context) => {
    const { eventId, submissionId } = context.req.valid("param");
    const body = context.req.valid("json");
    await eventFor(context.env.DB, eventId);
    const current = await editableContentFor(context.env.DB, eventId, submissionId);

    // Scoped to this event AND this submission: an audit id is guessable enough
    // that "restore" must never be a way to read, or write, another record's
    // content.
    const entry = await context.env.DB
      .prepare("SELECT id, action, before_json FROM audit_log WHERE id = ? AND event_id = ? AND entity_type = 'submission' AND entity_id = ?")
      .bind(body.audit_id, eventId, submissionId)
      .first<{ id: string; action: string; before_json: string | null }>();
    if (!entry || !isContentAction(entry.action)) throw ApiError.notFound("no such history entry on this record");

    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = entry.before_json === null ? null : (JSON.parse(entry.before_json) as Record<string, unknown>);
    } catch {
      parsed = null;
    }
    const restored = contentOf(parsed);
    if (!restored) throw ApiError.unprocessable("that history entry records no earlier content to restore", "audit_id");

    const before: ContentState = { title: current.title, abstract: current.abstract };
    const after: ContentState = {
      title: restored.title ?? current.title,
      abstract: "abstract" in restored ? (restored.abstract ?? null) : current.abstract,
    };
    if (after.title === before.title && after.abstract === before.abstract) {
      return context.json(await loadRecord(context.env.DB, eventId, submissionId), 200);
    }
    await requirePublishedConfirmation(context.env.DB, eventId, submissionId, body.confirm_published === true, PUBLISHED_CONTENT_REFUSAL);
    const actor = await actorFor(context);
    // The restore's own before/after describes what the restore changed — not
    // what the original edit changed. That is what makes the row honest when
    // someone reads the history a month later.
    await context.env.DB.batch(
      contentWriteStatements(context.env.DB, eventId, submissionId, before, after, actor, "content_restored", Date.now()),
    );
    return context.json(await loadRecord(context.env.DB, eventId, submissionId), 200);
  },
);

const scheduleSubmission = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/events/{eventId}/submissions/{submissionId}/schedule",
    operationId: "scheduleSubmission",
    summary: "Place a Session on the working agenda",
    tags: ["Submissions"],
    request: { params: submissionParams, body: { content: { "application/json": { schema: scheduleInput } } } },
    policy: { auth: { kind: "grants", grants: ["program:write"] }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 200: recordResponse, ...errors },
  },
  async (context) => {
    const { eventId, submissionId } = context.req.valid("param");
    const body = context.req.valid("json");
    await eventFor(context.env.DB, eventId);
    const submission = await context.env.DB.prepare("SELECT id, kind, status FROM submissions WHERE id = ? AND event_id = ?").bind(submissionId, eventId).first<{ id: string; kind: string; status: string }>();
    if (!submission) throw ApiError.notFound("submission not found");
    if (submission.kind !== "session") throw ApiError.unprocessable("only Sessions can be placed on the agenda");
    if (submission.status !== "accepted") throw ApiError.conflict("a Session must be accepted before it can be scheduled");
    const room = await context.env.DB.prepare("SELECT id FROM rooms WHERE id = ? AND event_id = ?").bind(body.room_id, eventId).first();
    if (!room) throw ApiError.unprocessable("room does not belong to this conference", "room_id");
    if (body.track_id) {
      const track = await context.env.DB.prepare("SELECT id FROM tracks WHERE id = ? AND event_id = ?").bind(body.track_id, eventId).first();
      if (!track) throw ApiError.unprocessable("track does not belong to this conference", "track_id");
    }
    const actor = await actorFor(context);
    const now = Date.now();
    const existing = await context.env.DB.prepare("SELECT id FROM agenda_items WHERE submission_id = ?").bind(submissionId).first<{ id: string }>();
    if (existing) {
      await context.env.DB.prepare(`
        UPDATE agenda_items SET starts_at = ?, duration_min = ?, room_id = ?, track_id = ?, updated_at = ? WHERE id = ?
      `).bind(body.starts_at, body.duration_min, body.room_id, body.track_id ?? null, now, existing.id).run();
    } else {
      await context.env.DB.prepare(`
        INSERT INTO agenda_items
          (id, event_id, submission_id, kind, title, starts_at, duration_min, room_id, track_id, is_published, created_at, updated_at)
        VALUES (?, ?, ?, 'session', NULL, ?, ?, ?, ?, 0, ?, ?)
      `).bind(newUlid(), eventId, submissionId, body.starts_at, body.duration_min, body.room_id, body.track_id ?? null, now, now).run();
    }
    await audit(context.env.DB, eventId, submissionId, "scheduled", actor, { starts_at: body.starts_at, room_id: body.room_id, duration_min: body.duration_min });
    return context.json(await loadRecord(context.env.DB, eventId, submissionId), 200);
  },
);

interface PublicationSnapshot {
  status: string;
  submission_is_published: number;
  submission_updated_at: number;
  agenda_item_id: string | null;
  agenda_is_published: number | null;
  agenda_updated_at: number | null;
}

/**
 * Change the two publication flags as one audited state transition.
 *
 * The agenda row is the public site's gate, while the submission flag is the
 * record's durable projection. Keeping both in this conditional batch means a
 * reversal cannot leave the organizer looking at one truth and attendees at
 * another. The updated_at predicates are the record's lightweight CAS: a
 * stale screen gets a conflict instead of overwriting a newer schedule or
 * publication change.
 */
async function setPublication(
  db: D1Database,
  eventId: string,
  submissionId: string,
  published: boolean,
  actor: DecisionActor,
): Promise<void> {
  const current = await db.prepare(`
    SELECT
      s.status,
      s.is_published AS submission_is_published,
      s.updated_at AS submission_updated_at,
      ai.id AS agenda_item_id,
      ai.is_published AS agenda_is_published,
      ai.updated_at AS agenda_updated_at
    FROM submissions s
    LEFT JOIN agenda_items ai
      ON ai.submission_id = s.id AND ai.event_id = s.event_id AND ai.kind = 'session'
    WHERE s.id = ? AND s.event_id = ?
  `).bind(submissionId, eventId).first<PublicationSnapshot>();
  if (!current) throw ApiError.notFound("submission not found");
  if (!current.agenda_item_id || current.agenda_is_published === null || current.agenda_updated_at === null) {
    throw ApiError.conflict("schedule the Session before changing its public status");
  }
  if (published && current.status !== "accepted") {
    throw ApiError.conflict("this Session is not accepted, so it cannot be published");
  }

  const target = published ? 1 : 0;
  if (current.agenda_is_published === target && current.submission_is_published === target) return;

  const now = Date.now();
  const agendaUpdatedAt = Math.max(now, current.agenda_updated_at + 1);
  const submissionUpdatedAt = Math.max(now, current.submission_updated_at + 1);
  const before = {
    agenda_item_id: current.agenda_item_id,
    agenda_is_published: current.agenda_is_published === 1,
    submission_is_published: current.submission_is_published === 1,
  };
  const after = {
    agenda_item_id: current.agenda_item_id,
    agenda_is_published: published,
    submission_is_published: published,
  };
  const action = published ? "published" : "unpublished";

  const agendaUpdate = db.prepare(`
    UPDATE agenda_items
    SET is_published = ?, updated_at = ?
    WHERE id = ? AND event_id = ? AND kind = 'session'
      AND is_published = ? AND updated_at = ?
      AND EXISTS (
        SELECT 1 FROM submissions
        WHERE id = ? AND event_id = ? AND is_published = ? AND updated_at = ?
          AND (? = 0 OR status = 'accepted')
      )
  `).bind(
    target,
    agendaUpdatedAt,
    current.agenda_item_id,
    eventId,
    current.agenda_is_published,
    current.agenda_updated_at,
    submissionId,
    eventId,
    current.submission_is_published,
    current.submission_updated_at,
    published ? 1 : 0,
  );
  const submissionUpdate = db.prepare(`
    UPDATE submissions
    SET is_published = ?, updated_at = ?
    WHERE id = ? AND event_id = ?
      AND is_published = ? AND updated_at = ?
      AND EXISTS (
        SELECT 1 FROM agenda_items
        WHERE id = ? AND event_id = ? AND kind = 'session'
          AND is_published = ? AND updated_at = ?
      )
  `).bind(
    target,
    submissionUpdatedAt,
    submissionId,
    eventId,
    current.submission_is_published,
    current.submission_updated_at,
    current.agenda_item_id,
    eventId,
    target,
    agendaUpdatedAt,
  );
  const audit = auditStatementFromSelect(db, {
    eventId,
    actorKind: actor.kind,
    actorPersonId: actor.personId,
    action,
    entityType: "submission",
    entityId: submissionId,
    before,
    after,
    now,
    requestId: actor.requestId,
  }, `
    FROM agenda_items item
    JOIN submissions submission
      ON submission.id = item.submission_id AND submission.event_id = item.event_id
    WHERE item.id = ? AND item.event_id = ? AND item.kind = 'session'
      AND item.is_published = ? AND item.updated_at = ?
      AND submission.id = ? AND submission.event_id = ?
      AND submission.is_published = ? AND submission.updated_at = ?
  `, current.agenda_item_id, eventId, target, agendaUpdatedAt, submissionId, eventId, target, submissionUpdatedAt);

  const results = await db.batch([agendaUpdate, submissionUpdate, audit]);
  if (Number(results[0]?.meta?.changes ?? 0) !== 1 || Number(results[1]?.meta?.changes ?? 0) !== 1 || Number(results[2]?.meta?.changes ?? 0) !== 1) {
    throw ApiError.conflict(`this Session changed while ${published ? "publishing" : "removing it from the public site"}; refresh and try again`);
  }
}

const publishSubmission = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/events/{eventId}/submissions/{submissionId}/publish",
    operationId: "publishSubmission",
    summary: "Publish a scheduled Session",
    tags: ["Submissions"],
    request: { params: submissionParams },
    policy: { auth: { kind: "grants", grants: ["program:write"] }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 200: recordResponse, ...errors },
  },
  async (context) => {
    const { eventId, submissionId } = context.req.valid("param");
    await eventFor(context.env.DB, eventId);
    await setPublication(context.env.DB, eventId, submissionId, true, await actorFor(context));
    await purgePublicEmbedCache(context.env.CACHE, { eventId });
    return context.json(await loadRecord(context.env.DB, eventId, submissionId), 200);
  },
);

const unpublishSubmission = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/events/{eventId}/submissions/{submissionId}/unpublish",
    operationId: "unpublishSubmission",
    summary: "Remove a Session from the public agenda",
    description: "Sets agenda_items.is_published = 0 and submissions.is_published = 0 so the Session disappears from the public agenda and embeds immediately.",
    tags: ["Submissions"],
    request: { params: submissionParams },
    policy: { auth: { kind: "grants", grants: ["program:write"] }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 200: recordResponse, ...errors },
  },
  async (context) => {
    const { eventId, submissionId } = context.req.valid("param");
    await eventFor(context.env.DB, eventId);
    await setPublication(context.env.DB, eventId, submissionId, false, await actorFor(context));
    await purgePublicEmbedCache(context.env.CACHE, { eventId });
    return context.json(await loadRecord(context.env.DB, eventId, submissionId), 200);
  },
);

/**
 * A co-presenter joins a session after intake far more often than before it.
 * The record already RENDERED its participants; without these two routes the
 * only way to add one was to re-run the public form, which is not a thing an
 * organizer can do on someone else's behalf.
 *
 * Both doors take `program:write`, the same grant the content editor takes:
 * who is on stage is program content.
 */
const addParticipant = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/events/{eventId}/submissions/{submissionId}/participants",
    operationId: "addSubmissionParticipant",
    summary: "Attach a participant to a submission",
    description:
      "Adds a co-presenter, moderator, or chairperson after intake. Pass person_id for someone already in the organization, or name and email to create them; an address already known to the organization is matched rather than duplicated.",
    tags: ["Submissions"],
    request: { params: submissionParams, body: { content: { "application/json": { schema: participantInput } } } },
    policy: { auth: { kind: "grants", grants: ["program:write"] }, rateLimit: { bucket: "write" }, concurrency: "none" },
    // 200 is the already-attached answer: the record is returned either way,
    // and only one of the two paths actually created something.
    responses: { 200: recordResponse, 201: recordResponse, ...errors },
  },
  async (context) => {
    const { eventId, submissionId } = context.req.valid("param");
    const body = context.req.valid("json");
    const event = await eventFor(context.env.DB, eventId);
    await submissionFor(context.env.DB, eventId, submissionId);
    const now = Date.now();
    const resolved = await resolvePerson(context.env.DB, event.org_id, body, now);
    const existing = await context.env.DB.prepare(
      "SELECT id FROM participations WHERE submission_id = ? AND person_id = ? AND role = ?",
    ).bind(submissionId, resolved.personId, body.role).first<{ id: string }>();
    // Adding the same person in the same role twice is the organizer clicking
    // Add on a row that is already there. It is not an error worth a red
    // banner, but it must not create the duplicate the dedupe in
    // `participantListSql` then has to hide — and it is not a creation either,
    // so it answers 200 rather than claiming a 201 no reader could find.
    if (existing) return context.json(await loadRecord(context.env.DB, eventId, submissionId), 200);
    const position = await nextParticipantPosition(context.env.DB, submissionId);
    const participationId = newUlid();
    const actor = await actorFor(context);
    await context.env.DB.batch([
      ...resolved.statements,
      // `ON CONFLICT DO NOTHING` against uq_participations_person_submission_role
      // rather than trusting the read above: the check and this write are two
      // round trips, so two simultaneous Adds both pass the check. Without it
      // the loser of that race surfaces the constraint failure as a 500 —
      // the data stays correct either way, but a double-click deserves the
      // same quiet no-op as a second click a minute later.
      context.env.DB.prepare(`
        INSERT INTO participations
          (id, submission_id, person_id, role, position, confirmation_status, confirmed_at, invited_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'pending', NULL, NULL, ?, ?)
        ON CONFLICT (person_id, submission_id, role) DO NOTHING
      `).bind(participationId, submissionId, resolved.personId, body.role, position, now, now),
      auditStatement(context.env.DB, {
        eventId,
        actorKind: actor.kind,
        actorPersonId: actor.personId,
        action: "participant_added",
        entityType: "submission",
        entityId: submissionId,
        after: { participation_id: participationId, person_id: resolved.personId, role: body.role },
        now,
        requestId: actor.requestId,
      }),
    ]);
    return context.json(await loadRecord(context.env.DB, eventId, submissionId), 201);
  },
);

const removeParticipant = defineApiRoute(
  {
    method: "delete",
    path: "/api/v1/events/{eventId}/submissions/{submissionId}/participants/{participationId}",
    operationId: "removeSubmissionParticipant",
    summary: "Detach a participant from a submission",
    description:
      "Removes one participation. The submitter cannot be removed: the record's authorship, its resume link, and its speaker mail all key to that row.",
    tags: ["Submissions"],
    request: { params: participantParams },
    policy: { auth: { kind: "grants", grants: ["program:write"] }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 200: recordResponse, ...errors },
  },
  async (context) => {
    const { eventId, submissionId, participationId } = context.req.valid("param");
    await eventFor(context.env.DB, eventId);
    await submissionFor(context.env.DB, eventId, submissionId);
    const participation = await context.env.DB.prepare(
      "SELECT id, person_id, role FROM participations WHERE id = ? AND submission_id = ?",
    ).bind(participationId, submissionId).first<{ id: string; person_id: string; role: string }>();
    if (!participation) throw ApiError.notFound("participant not found on this record");
    if (participation.role === "submitter") {
      throw ApiError.unprocessable("the submitter cannot be removed from their own record", "participationId");
    }
    const actor = await actorFor(context);
    const now = Date.now();
    const calendarRecipientRole = participation.role === "speaker" || participation.role === "submitter";
    const stillReceivesCalendar = calendarRecipientRole
      ? await context.env.DB.prepare(
        `SELECT 1 FROM participations
          WHERE submission_id = ? AND person_id = ? AND role IN ('speaker', 'submitter') AND id <> ?
          LIMIT 1`,
      ).bind(submissionId, participation.person_id, participationId).first()
      : true;
    const calendarBatch = calendarRecipientRole && !stillReceivesCalendar
      ? await prepareCalendarCancellationBatch({
        db: context.env.DB,
        eventId,
        personId: participation.person_id,
        submissionId,
        now,
      })
      : null;
    await context.env.DB.batch([
      ...(calendarBatch?.statements ?? []),
      context.env.DB.prepare("DELETE FROM participations WHERE id = ? AND submission_id = ?").bind(participationId, submissionId),
      auditStatement(context.env.DB, {
        eventId,
        actorKind: actor.kind,
        actorPersonId: actor.personId,
        action: "participant_removed",
        entityType: "submission",
        entityId: submissionId,
        before: { participation_id: participationId, person_id: participation.person_id, role: participation.role },
        now,
        requestId: actor.requestId,
      }),
    ]);
    if (calendarBatch && calendarBatch.idempotencyKeys.length > 0) {
      await drainCalendarCancellations({
        db: context.env.DB,
        queue: context.env.MAIL_QUEUE,
        now,
        idempotencyKeys: calendarBatch.idempotencyKeys,
      });
    }
    return context.json(await loadRecord(context.env.DB, eventId, submissionId), 200);
  },
);

export const apiRoutes = [createSubmission, getSubmissionRecord, getSubmissionTimeline, patchDraft, updateSubmissionContent, restoreSubmissionContent, scheduleSubmission, publishSubmission, unpublishSubmission, addParticipant, removeParticipant];
