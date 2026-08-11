import { z } from "@hono/zod-openapi";
import type { Context } from "hono";

import { ApiError } from "../api/errors";
import { newUlid } from "../api/ids";
import { BOARD_STAGE_LABELS, BOARD_STAGE_SQL, type BoardSlot } from "../api/board";
import { defineApiRoute, errorResponses, jsonResponse } from "../api/route";
import type { ApiEnv } from "../api/runtime";
import type { DecisionActor } from "../jobs/cascade/decisions";
import { writeSubmissionDecision } from "../jobs/cascade/decisions";
import { getAuth } from "../lib/auth/auth-middleware";

const eventParams = z.object({ eventId: z.string().min(1) });
const submissionParams = eventParams.extend({ submissionId: z.string().min(1) });
const recordResponse = jsonResponse(z.unknown(), "Submission record");
const errors = errorResponses([400, 401, 403, 404, 409, 422, 429, 500]);

const personInput = z.object({
  person_id: z.string().min(1).optional(),
  name: z.string().trim().min(1).max(200).optional(),
  email: z.string().trim().email().optional(),
  company: z.string().trim().max(200).nullable().optional(),
  title: z.string().trim().max(200).nullable().optional(),
  role: z.enum(["speaker", "co_speaker", "moderator", "chairperson", "submitter", "sponsor_contact"]).default("speaker"),
  position: z.number().int().min(0).optional(),
});

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
  if (auth.kind === "session") return { kind: "user", personId: auth.personId };
  const token = await context.env.DB.prepare("SELECT created_by FROM api_tokens WHERE id = ?").bind(auth.tokenId).first<{ created_by: string }>();
  if (!token?.created_by) throw ApiError.unauthenticated("the token issuer is no longer available");
  return { kind: "api_token", personId: token.created_by };
}

async function audit(
  db: D1Database,
  eventId: string,
  entityId: string,
  action: string,
  actor: DecisionActor,
  after: unknown,
): Promise<void> {
  await db.prepare(`
    INSERT INTO audit_log
      (id, event_id, actor_person_id, actor_kind, action, entity_type, entity_id, before_json, after_json, created_at)
    VALUES (?, ?, ?, ?, ?, 'submission', ?, NULL, ?, ?)
  `).bind(newUlid(), eventId, actor.personId, actor.kind, action, entityId, JSON.stringify(after), Date.now()).run();
}

async function loadRecord(db: D1Database, eventId: string, submissionId: string): Promise<Record<string, unknown>> {
  const row = await db.prepare(`
    SELECT
      s.id, s.event_id, event.name AS event_name, event.timezone,
      s.form_id, form.name AS form_name, s.kind, s.bypass_evaluation,
      s.title, s.abstract, s.status, s.format_id, format.name AS format,
      s.primary_track_id, s.origin, s.vendor_affiliation, s.wave_id, wave.name AS wave,
      s.submitter_person_id, s.decided_at, s.decided_by_person_id, s.submitted_at,
      s.last_saved_at, s.is_published, s.external_ref, s.applied_rule_id,
      s.created_at, s.updated_at, ${BOARD_STAGE_SQL} AS stage,
      ai.starts_at, ai.duration_min, room.name AS room, building.name AS building,
      ai.is_published AS agenda_published
    FROM submissions s
    JOIN events event ON event.id = s.event_id
    LEFT JOIN forms form ON form.id = s.form_id
    LEFT JOIN formats format ON format.id = s.format_id
    LEFT JOIN waves wave ON wave.id = s.wave_id
    LEFT JOIN agenda_items ai ON ai.submission_id = s.id AND ai.kind = 'session'
    LEFT JOIN rooms room ON room.id = ai.room_id
    LEFT JOIN buildings building ON building.id = room.building_id
    WHERE s.event_id = ? AND s.id = ?
  `).bind(eventId, submissionId).first<BaseRecordRow>();
  if (!row) throw ApiError.notFound("submission not found");

  const [participants, answers, tracks, decisions, evaluations, history, rounds, reviewerOptions] = await Promise.all([
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
      SELECT answer.id, answer.field_id, field.key, field.label, answer.value_text, answer.value_json
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
        decision.decided_at, decision.decided_by_person_id, person.name AS decided_by_name
      FROM submission_decisions decision
      LEFT JOIN people person ON person.id = decision.decided_by_person_id
      WHERE decision.submission_id = ?
      ORDER BY decision.decided_at DESC, decision.id DESC
    `).bind(submissionId).all<Record<string, unknown>>(),
    db.prepare(`
      SELECT evaluation.id, evaluation.round_id, round.name AS round_name, round.position,
        evaluation.reviewer_person_id, person.name AS reviewer_name, evaluation.recommendation,
        evaluation.score, evaluation.comment, evaluation.criteria_scores, evaluation.updated_at
      FROM evaluations evaluation
      JOIN evaluation_rounds round ON round.id = evaluation.round_id
      JOIN people person ON person.id = evaluation.reviewer_person_id
      WHERE evaluation.submission_id = ?
      ORDER BY round.position, evaluation.updated_at DESC, evaluation.id
    `).bind(submissionId).all<Record<string, unknown>>(),
    db.prepare(`
      SELECT id, action, actor_kind, actor_person_id, entity_type, entity_id, after_json, created_at
      FROM audit_log
      WHERE event_id = ? AND entity_id = ?
      ORDER BY created_at DESC, id DESC
    `).bind(eventId, submissionId).all<Record<string, unknown>>(),
    db.prepare(`
      SELECT round.id, round.name, round.position, round.target_reviews_per_submission,
        plan.id AS plan_id, plan.name AS plan_name, plan.status AS plan_status,
        assignment.id AS assignment_id, assignment.reviewer_person_id,
        assignment.committee_id, assignment.status AS assignment_status,
        person.name AS reviewer_name, person.company AS reviewer_company,
        (SELECT COUNT(*) FROM round_assignments covered
         WHERE covered.round_id = round.id AND covered.reviewer_person_id = assignment.reviewer_person_id) AS assigned_count,
        (SELECT COUNT(*) FROM evaluations reviewed
         WHERE reviewed.round_id = round.id AND reviewed.reviewer_person_id = assignment.reviewer_person_id) AS reviewed_count
      FROM evaluation_rounds round
      JOIN evaluation_plans plan ON plan.id = round.plan_id
      LEFT JOIN round_assignments assignment
        ON assignment.round_id = round.id AND assignment.submission_id = ?
      LEFT JOIN people person ON person.id = assignment.reviewer_person_id
      WHERE plan.event_id = ?
      ORDER BY round.position, round.id, assignment.id
    `).bind(submissionId, eventId).all<Record<string, unknown>>(),
    db.prepare(`
      SELECT DISTINCT person.id, person.name, person.company,
        COALESCE((SELECT json_group_array(scope.track_id) FROM reviewer_track_scopes scope WHERE scope.event_id = membership.event_id AND scope.person_id = person.id), '[]') AS track_ids
      FROM memberships membership
      JOIN people person ON person.id = membership.person_id
      WHERE membership.event_id = ? AND membership.role = 'reviewer'
      ORDER BY person.name COLLATE NOCASE, person.id
    `).bind(eventId).all<Record<string, unknown>>(),
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
      target_reviews_per_submission: Number(item.target_reviews_per_submission),
      reviewers: [],
    };
    if (item.assignment_id !== null) {
      (current.reviewers as Array<Record<string, unknown>>).push({
        assignment_id: item.assignment_id,
        reviewer_person_id: item.reviewer_person_id,
        reviewer_name: item.reviewer_name,
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

  const normalizedAnswers = answers.results.map((answer) => ({
    ...answer,
    value_json: answer.value_json === null ? null : jsonValue(answer.value_json as string, null),
  }));
  const slot = slotFor(row);
  const hours = Math.max(0, Math.floor((Date.now() - row.updated_at) / 3_600_000));
  return {
    id: row.id,
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
    is_published: row.is_published === 1,
    tracks: tracks.results.map((track) => ({ ...track, is_primary: Boolean(track.is_primary) })),
    participants: participants.results,
    answers: normalizedAnswers,
    decisions: decisions.results,
    evaluations: evaluations.results.map((evaluation) => ({
      ...evaluation,
      criteria_scores: evaluation.criteria_scores === null ? null : jsonValue(evaluation.criteria_scores as string, null),
    })),
    routing: row.applied_rule_id === null ? null : { rule_id: row.applied_rule_id },
    evaluation: {
      rounds: [...roundMap.values()],
      reviewer_options: reviewerOptions.results.map((reviewer) => ({
        ...reviewer,
        track_ids: jsonValue(reviewer.track_ids as string, []),
      })),
    },
    history: history.results.map((entry) => ({
      ...entry,
      after_json: entry.after_json === null ? null : jsonValue(entry.after_json as string, null),
    })),
    actions: {
      can_decide: ["submitted", "in_review", "accepted", "waitlisted"].includes(row.status),
      can_schedule: row.kind === "session" && row.status === "accepted" && slot === null,
      can_publish: slot !== null && !slot.is_published,
    },
  };
}

async function validateOwnedIds(
  db: D1Database,
  orgId: string,
  eventId: string,
  body: z.infer<typeof createSubmissionInput>,
): Promise<{ trackIds: string[]; formatId: string | null; waveId: string | null }> {
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
  if (answers?.length) {
    const fields = await db.prepare(`
      SELECT field.id
      FROM form_fields field
      JOIN forms form ON form.id = field.form_id
      WHERE form.event_id = ? AND field.id IN (${answers.map(() => "?").join(",")})
    `).bind(eventId, ...answers.map((answer) => answer.field_id)).all<{ id: string }>();
    if (fields.results.length !== new Set(answers.map((answer) => answer.field_id)).size) throw ApiError.unprocessable("every answer field must belong to this conference", "answers");
  }
  // Keep the event organization in the function signature: it makes the
  // person ownership check below explicit at the call site and prevents a
  // future caller from silently widening the lookup.
  void orgId;
  return { trackIds, formatId, waveId };
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
    const makePerson = async (input: { person_id?: string; name?: string; email?: string; company?: string | null; title?: string | null }): Promise<string> => {
      if (input.person_id) {
        if (knownPeople.has(input.person_id)) return input.person_id;
        const person = await context.env.DB.prepare("SELECT id FROM people WHERE id = ? AND org_id = ?").bind(input.person_id, event.org_id).first();
        if (!person) throw ApiError.unprocessable("person does not belong to this organization", "person_id");
        knownPeople.add(input.person_id);
        return input.person_id;
      }
      if (!input.name || !input.email) throw ApiError.unprocessable("a new participant needs a name and email", "participants");
      const id = newUlid();
      personStatements.push(context.env.DB.prepare(`
        INSERT INTO people
          (id, org_id, email, name, title, company, bio, headshot_attachment_id, social_links, is_demo, last_write_source, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, '[]', 0, 'marquee', ?, ?)
      `).bind(id, event.org_id, input.email, input.name, input.title ?? null, input.company ?? null, now, now));
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
    addParticipant(submitterId, "submitter", participants.length);

    const participantIds = [...new Set(participants.map((participant) => participant.personId))];
    if (participantIds.some((id) => !knownPeople.has(id))) throw new Error("participant ownership was not resolved");
    const status = body.status ?? (body.kind === "session" && (body.bypass_evaluation ?? true) ? "accepted" : "submitted");
    const id = newUlid();
    const statements: D1PreparedStatement[] = [
      ...personStatements,
      context.env.DB.prepare(`
        INSERT INTO submissions
          (id, event_id, form_id, kind, bypass_evaluation, title, abstract, status,
           format_id, primary_track_id, origin, vendor_affiliation, wave_id,
           submitter_person_id, decided_at, decided_by_person_id, submitted_at,
           last_saved_at, resume_token_hash, is_published, external_ref,
           applied_rule_id, last_write_source, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'admin', ?, ?, ?, ?, ?, ?, ?, NULL, 0, ?, ?, 'marquee', ?, ?)
      `).bind(
        id, eventId, body.form_id ?? null, body.kind, body.kind === "session" || body.bypass_evaluation ? 1 : 0,
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
      ...((body.answers ?? []) as AnswerInput[]).map((answer) => context.env.DB.prepare(`
        INSERT INTO submission_answers (id, submission_id, field_id, value_text, value_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(newUlid(), id, answer.field_id, answer.value_text ?? null, answer.value_json === undefined ? null : JSON.stringify(answer.value_json), now, now)),
      context.env.DB.prepare(`
        INSERT INTO audit_log
          (id, event_id, actor_person_id, actor_kind, action, entity_type, entity_id, before_json, after_json, created_at)
        VALUES (?, ?, ?, ?, 'created', 'submission', ?, NULL, ?, ?)
      `).bind(newUlid(), eventId, actor.personId, actor.kind, id, JSON.stringify({ origin: "admin", kind: body.kind, status, bypass_evaluation: body.kind === "session" || body.bypass_evaluation === true }), now),
    ];
    try {
      await context.env.DB.batch(statements);
    } catch (error) {
      console.error("admin submission create failed", error);
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
    policy: { auth: { kind: "grants", grants: ["program:read"] }, rateLimit: { bucket: "read" }, concurrency: "none" },
    responses: { 200: recordResponse, ...errors },
  },
  async (context) => {
    const { eventId, submissionId } = context.req.valid("param");
    await eventFor(context.env.DB, eventId);
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
    const slot = await context.env.DB.prepare("SELECT id FROM agenda_items WHERE submission_id = ? AND event_id = ? AND kind = 'session'").bind(submissionId, eventId).first<{ id: string }>();
    if (!slot) throw ApiError.conflict("schedule the Session before publishing it");
    const actor = await actorFor(context);
    const now = Date.now();
    await context.env.DB.batch([
      context.env.DB.prepare("UPDATE agenda_items SET is_published = 1, updated_at = ? WHERE id = ?").bind(now, slot.id),
      context.env.DB.prepare("UPDATE submissions SET is_published = 1, updated_at = ? WHERE id = ? AND event_id = ?").bind(now, submissionId, eventId),
    ]);
    await audit(context.env.DB, eventId, submissionId, "published", actor, { agenda_item_id: slot.id, is_published: true });
    return context.json(await loadRecord(context.env.DB, eventId, submissionId), 200);
  },
);

export const apiRoutes = [createSubmission, getSubmissionRecord, scheduleSubmission, publishSubmission];
