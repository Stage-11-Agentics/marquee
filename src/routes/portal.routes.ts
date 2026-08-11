/**
 * Speaker portal API.
 *
 * The portal is a session surface, not a public projection. The shared API
 * policy admits an authenticated principal; every handler below narrows that
 * principal to a session with an event-scoped speaker membership and repeats
 * the person/event predicate on each read and write.
 */

import { z } from "@hono/zod-openapi";

import { ApiError } from "../api/errors";
import { defineApiRoute, errorResponses, jsonResponse } from "../api/route";
import type { ApiEnv } from "../api/runtime";
import type { AuthContext, SessionAuth } from "../lib/auth/scope-resolution";
import { getAuth } from "../lib/auth/auth-middleware";
import { roomDisplayLabel } from "../lib/venues";
import { parseUploadOwnerConfig, policyFor } from "../lib/r2/policy";
import {
  isFieldApplicable,
  projectApplicableAnswers,
} from "../lib/form-conditions";
import { listFormFields, type FormFieldView } from "./forms.queries";

const eventQuery = z.object({ eventId: z.string().min(1).optional() });
const taskParams = z.object({ taskId: z.string().min(1) });
const submissionParams = z.object({ submissionId: z.string().min(1) });
const eventSubmissionParams = z.object({ eventId: z.string().min(1), submissionId: z.string().min(1) });

const profileBody = z.object({
  title: z.string().trim().max(200).nullable().optional(),
  company: z.string().trim().max(200).nullable().optional(),
  bio: z.string().max(20_000).nullable().optional(),
  social_links: z.array(z.string().url()).max(12).optional(),
  headshot_attachment_id: z.string().min(1).nullable().optional(),
});

const taskCompletionBody = z.object({
  acknowledged: z.boolean().optional(),
  answers: z.record(z.string(), z.unknown()).optional(),
  attachment_id: z.string().min(1).optional(),
});

const talkBody = z.object({
  title: z.string().trim().min(1).max(240).optional(),
  description: z.string().max(50_000).nullable().optional(),
});

const talkEditingBody = z.object({ enabled: z.boolean() });

const portalResponseSchema = z
  .object({
    event: z.any(),
    person: z.any(),
    submissions: z.array(z.any()),
    tasks: z.array(z.any()),
    handbook: z.object({ markdown: z.string() }),
  })
  .openapi("SpeakerPortal");

const taskResponseSchema = z.object({ task: z.any() }).openapi("SpeakerTaskCompletion");
const profileResponseSchema = z.object({ person: z.any() }).openapi("SpeakerProfile");
const talkResponseSchema = z.object({ submission: z.any(), history: z.array(z.any()) }).openapi("SpeakerTalk");
const talkEditingResponseSchema = z.object({ enabled: z.boolean() }).openapi("SpeakerTalkEditing");

type EventProjection = {
  id: string;
  name: string;
  slug: string;
  starts_on: string;
  ends_on: string;
  timezone: string;
  status: string;
};

type PersonProjection = {
  id: string;
  name: string;
  email: string;
  title: string | null;
  company: string | null;
  bio: string | null;
  social_links: string;
  headshot_attachment_id: string | null;
  updated_at: number;
};

type SubmissionProjection = {
  id: string;
  title: string;
  abstract: string | null;
  status: string;
  updated_at: number;
  format_name: string | null;
  wave_name: string | null;
  wave_decision_on: string | null;
  starts_at: number | null;
  duration_min: number | null;
  room_name: string | null;
  building_name: string | null;
  is_published: number | null;
  feedback_md: string | null;
  feedback_decided_at: number | null;
};

type TaskProjection = {
  id: string;
  event_id: string;
  person_id: string;
  submission_id: string | null;
  template_id: string;
  title: string;
  kind: "acknowledge" | "file" | "form";
  description: string;
  due_at: number;
  status: "open" | "done";
  completed_at: number | null;
  response_json: string | null;
  attachment_id: string | null;
  form_id: string | null;
  file_config: string | null;
};

type HistoryProjection = {
  id: string;
  actor_person_id: string | null;
  actor_name: string | null;
  created_at: number;
  before_json: string | null;
  after_json: string | null;
};

const HANDBOOKS: Record<string, string> = {
  "aie-nyc-2026": `# Speaker handbook

## Before the conference

Bring the version of your talk you want the room to remember. Your conference contact will use the portal task list for the remaining details.

## On site

The final room and arrival notes will appear in the confirmed schedule. Keep your profile and talk description current.

[Conference site](https://marquee.stage11.dev/agenda)
`,
  default: `# Speaker handbook

## Before the conference

Keep your profile, headshot, and talk description current in this portal.

## On site

Your confirmed schedule will show the room and time when it is ready.

[Conference site](/agenda)
`,
};

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function parseObject(value: string | null | undefined): Record<string, unknown> {
  const parsed = parseJson<unknown>(value, {});
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {};
}

function parseSocialLinks(value: string | null | undefined): string[] {
  const parsed = parseJson<unknown>(value, []);
  return Array.isArray(parsed) && parsed.every((item) => typeof item === "string") ? parsed : [];
}

function readStoredAnswer(row: { value_json: string | null; value_text: string | null }): unknown {
  if (row.value_json !== null) return parseJson<unknown>(row.value_json, row.value_text ?? "");
  return row.value_text ?? "";
}

function eventDateTime(event: EventProjection, startsAt: number | null): { day: string; date: string; time: string } | null {
  if (startsAt === null) return null;
  const date = new Date(startsAt);
  return {
    day: new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: event.timezone }).format(date),
    date: new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: event.timezone }).format(date),
    time: new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: event.timezone }).format(date),
  };
}

function statusLabel(status: string): string {
  return status
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function isSessionAuth(auth: AuthContext | null): auth is SessionAuth {
  return auth?.kind === "session";
}

function requireSession(context: import("hono").Context<ApiEnv>): SessionAuth {
  const auth = getAuth(context);
  if (!isSessionAuth(auth)) throw ApiError.forbidden("the speaker portal requires a browser session");
  return auth;
}

async function speakerEvent(
  db: D1Database,
  auth: SessionAuth,
  requestedEventId?: string,
): Promise<EventProjection> {
  const predicate = requestedEventId ? "AND e.id = ?" : "";
  const bindings = requestedEventId ? [auth.personId, auth.orgId, requestedEventId] : [auth.personId, auth.orgId];
  const event = await db
    .prepare(
      `SELECT e.id, e.name, e.slug, e.starts_on, e.ends_on, e.timezone, e.status
       FROM events e
       JOIN memberships m ON m.event_id = e.id AND m.person_id = ? AND m.org_id = ? AND m.role = 'speaker'
       WHERE 1 = 1 ${predicate}
       ORDER BY e.starts_on ASC, e.id ASC
       LIMIT 1`,
    )
    .bind(...bindings)
    .first<EventProjection>();
  if (!event) throw ApiError.notFound("conference not found");
  return event;
}

async function personFor(db: D1Database, personId: string): Promise<PersonProjection> {
  const person = await db
    .prepare(
      `SELECT id, name, email, title, company, bio, social_links, headshot_attachment_id, updated_at
       FROM people WHERE id = ?`,
    )
    .bind(personId)
    .first<PersonProjection>();
  if (!person) throw ApiError.notFound("speaker not found");
  return person;
}

async function listSubmissions(db: D1Database, event: EventProjection, personId: string): Promise<SubmissionProjection[]> {
  const rows = await db
    .prepare(
      `SELECT s.id, s.title, s.abstract, s.status, s.updated_at,
         format.name AS format_name, wave.name AS wave_name, wave.decision_on AS wave_decision_on,
         agenda.starts_at, agenda.duration_min, room.name AS room_name, building.name AS building_name,
         agenda.is_published,
         decision.feedback_md, decision.decided_at AS feedback_decided_at
       FROM submissions s
       JOIN participations participation
         ON participation.submission_id = s.id AND participation.person_id = ?
       LEFT JOIN formats format ON format.id = s.format_id AND format.event_id = s.event_id
       LEFT JOIN waves wave ON wave.id = s.wave_id AND wave.event_id = s.event_id
       LEFT JOIN agenda_items agenda
         ON agenda.submission_id = s.id AND agenda.event_id = s.event_id AND agenda.kind = 'session'
       LEFT JOIN rooms room ON room.id = agenda.room_id AND room.event_id = s.event_id
       LEFT JOIN buildings building ON building.id = room.building_id AND building.event_id = s.event_id
       LEFT JOIN submission_decisions decision ON decision.id = (
         SELECT latest.id FROM submission_decisions latest
         WHERE latest.submission_id = s.id AND latest.event_id = s.event_id
         ORDER BY latest.decided_at DESC, latest.id DESC LIMIT 1
       )
       WHERE s.event_id = ?
       ORDER BY s.updated_at DESC, s.id ASC`,
    )
    .bind(personId, event.id)
    .all<SubmissionProjection>();

  const seen = new Set<string>();
  return rows.results.filter((row) => {
    if (seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });
}

async function readSubmissionAnswers(
  db: D1Database,
  submissionId: string | null,
): Promise<Record<string, unknown>> {
  if (!submissionId) return {};
  const rows = await db
    .prepare(
      `SELECT field.key, answer.value_json, answer.value_text
       FROM submission_answers answer
       JOIN form_fields field ON field.id = answer.field_id
       WHERE answer.submission_id = ?`,
    )
    .bind(submissionId)
    .all<{ key: string; value_json: string | null; value_text: string | null }>();
  return Object.fromEntries(rows.results.map((row) => [row.key, readStoredAnswer(row)]));
}

function taskPayload(
  task: TaskProjection,
  fields: FormFieldView[],
  answers: Record<string, unknown>,
): Record<string, unknown> {
  if (task.kind === "acknowledge") {
    return { kind: task.kind, acknowledged: parseObject(task.response_json).acknowledged === true };
  }
  if (task.kind === "file") {
    const config = parseUploadOwnerConfig(task.file_config);
    const policy = policyFor("task_upload", config);
    const accept = policy?.rules.map((rule) => rule.extension) ?? [];
    return {
      kind: task.kind,
      attachment_id: task.attachment_id,
      accept,
      max_bytes: policy?.maxBytes ?? null,
    };
  }
  const projection = projectApplicableAnswers(fields, answers);
  return {
    kind: task.kind,
    form_id: task.form_id,
    fields: fields
      .filter((field) => isFieldApplicable(field, answers))
      .map((field) => ({
        key: field.key,
        label: field.label,
        help_text: field.help_text,
        type: field.type,
        required: field.required,
        position: field.position,
        config: field.config,
        condition: field.condition,
        value: projection.answers[field.key] ?? null,
      })),
    answers: projection.answers,
  };
}

async function listTasks(db: D1Database, event: EventProjection, personId: string): Promise<Record<string, unknown>[]> {
  const rows = await db
    .prepare(
      `SELECT task.id, task.event_id, task.person_id, task.submission_id, task.template_id,
         task.title, task.kind, task.description, task.due_at, task.status, task.completed_at,
         task.response_json, task.attachment_id, template.form_id, template.file_config
       FROM speaker_tasks task
       JOIN task_templates template ON template.id = task.template_id AND template.event_id = task.event_id
       WHERE task.event_id = ? AND task.person_id = ?
       ORDER BY task.due_at ASC, task.id ASC`,
    )
    .bind(event.id, personId)
    .all<TaskProjection>();

  return Promise.all(rows.results.map(async (task) => {
    const fields = task.kind === "form" && task.form_id ? await listFormFields(db, task.form_id) : [];
    const submissionAnswers = await readSubmissionAnswers(db, task.submission_id);
    const responseAnswers = task.kind === "form" ? parseObject(task.response_json) : {};
    const answers = { ...submissionAnswers, ...responseAnswers };
    return {
      id: task.id,
      title: task.title,
      kind: task.kind,
      description: task.description,
      due_at: task.due_at,
      status: task.status,
      completed_at: task.completed_at,
      overdue: task.status === "open" && task.due_at < Date.now(),
      payload: taskPayload(task, fields, answers),
    };
  }));
}

function submissionView(event: EventProjection, row: SubmissionProjection): Record<string, unknown> {
  const dateTime = eventDateTime(event, row.starts_at);
  const waveName = row.wave_name ?? (row.wave_decision_on ? "Next wave" : null);
  return {
    id: row.id,
    title: row.title,
    description: row.abstract,
    status: row.status,
    status_label: statusLabel(row.status),
    format: row.format_name ?? "—",
    wave: waveName,
    wave_decision_on: row.wave_decision_on,
    slot: dateTime
      ? {
          day: dateTime.day,
          date: dateTime.date,
          time: dateTime.time,
          starts_at: row.starts_at,
          duration_min: row.duration_min,
          room: row.room_name && row.building_name
            ? roomDisplayLabel({ name: row.room_name }, { name: row.building_name })
            : row.room_name ?? "—",
          is_published: row.is_published === 1,
        }
      : null,
    decision_feedback: row.feedback_md
      ? { markdown: row.feedback_md, decided_at: row.feedback_decided_at }
      : null,
    talk_editable: true,
  };
}

async function historyFor(db: D1Database, eventId: string, submissionId: string): Promise<Record<string, unknown>[]> {
  const rows = await db
    .prepare(
      `SELECT audit.id, audit.actor_person_id, person.name AS actor_name, audit.created_at,
         audit.before_json, audit.after_json
       FROM audit_log audit
       LEFT JOIN people person ON person.id = audit.actor_person_id
       WHERE audit.event_id = ? AND audit.entity_type = 'submission' AND audit.entity_id = ?
         AND audit.action = 'speaker_talk_updated'
       ORDER BY audit.created_at DESC, audit.id DESC`,
    )
    .bind(eventId, submissionId)
    .all<HistoryProjection>();
  return rows.results.map((row) => ({
    id: row.id,
    actor_person_id: row.actor_person_id,
    actor_name: row.actor_name,
    created_at: row.created_at,
    before: parseJson<Record<string, unknown> | null>(row.before_json, null),
    after: parseJson<Record<string, unknown> | null>(row.after_json, null),
  }));
}

async function talkIsEditable(db: D1Database, eventId: string, submissionId: string): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT form.status AS form_status, form.closes_at, setting.value_json
       FROM submissions submission
       LEFT JOIN forms form ON form.id = submission.form_id AND form.event_id = submission.event_id
       LEFT JOIN event_settings setting
         ON setting.event_id = submission.event_id AND setting.key = ?
       WHERE submission.id = ? AND submission.event_id = ?`,
    )
    .bind(`speaker_talk_editing:${submissionId}`, submissionId, eventId)
    .first<{ form_status: string | null; closes_at: number | null; value_json: string | null }>();
  if (!row) return false;
  if (parseJson<{ enabled?: boolean }>(row.value_json, {}).enabled === true) return true;
  return row.form_status === "open" && (row.closes_at === null || row.closes_at > Date.now());
}

async function portalSnapshot(db: D1Database, auth: SessionAuth, requestedEventId?: string) {
  const event = await speakerEvent(db, auth, requestedEventId);
  const person = await personFor(db, auth.personId);
  const [submissionRows, tasks] = await Promise.all([
    listSubmissions(db, event, auth.personId),
    listTasks(db, event, auth.personId),
  ]);
  const submissions = [...submissionRows];
  if (submissions.some((row) => row.wave_name === null && ["draft", "submitted", "in_review"].includes(row.status))) {
    const nextWave = await db
      .prepare(
        `SELECT name AS wave_name, decision_on AS wave_decision_on FROM waves
         WHERE event_id = ? AND sent_at IS NULL ORDER BY position ASC, id ASC LIMIT 1`,
      )
      .bind(event.id)
      .first<{ wave_name: string; wave_decision_on: string }>();
    if (nextWave) {
      for (const row of submissions) {
        if (row.wave_name === null && ["draft", "submitted", "in_review"].includes(row.status)) {
          row.wave_name = nextWave.wave_name;
          row.wave_decision_on = nextWave.wave_decision_on;
        }
      }
    }
  }
  const submissionViews = await Promise.all(submissions.map(async (row) => {
    const [history, talk_editable] = await Promise.all([
      historyFor(db, event.id, row.id),
      talkIsEditable(db, event.id, row.id),
    ]);
    return { ...submissionView(event, row), history, talk_editable };
  }));
  return {
    event,
    person: {
      id: person.id,
      name: person.name,
      email: person.email,
      title: person.title,
      company: person.company,
      bio: person.bio,
      social_links: parseSocialLinks(person.social_links),
      headshot_attachment_id: person.headshot_attachment_id,
      updated_at: person.updated_at,
    },
    submissions: submissionViews,
    tasks,
    handbook: { markdown: HANDBOOKS[event.slug] ?? HANDBOOKS.default },
  };
}

async function taskFor(db: D1Database, auth: SessionAuth, taskId: string): Promise<TaskProjection> {
  const task = await db
    .prepare(
      `SELECT task.id, task.event_id, task.person_id, task.submission_id, task.template_id,
         task.title, task.kind, task.description, task.due_at, task.status, task.completed_at,
         task.response_json, task.attachment_id, template.form_id, template.file_config
       FROM speaker_tasks task
       JOIN events conference ON conference.id = task.event_id AND conference.org_id = ?
       JOIN task_templates template ON template.id = task.template_id AND template.event_id = task.event_id
       JOIN memberships membership ON membership.event_id = task.event_id
         AND membership.person_id = task.person_id AND membership.role = 'speaker'
       WHERE task.id = ? AND task.person_id = ?`,
    )
    .bind(auth.orgId, taskId, auth.personId)
    .first<TaskProjection>();
  if (!task) throw ApiError.notFound("task not found");
  return task;
}

async function completeTask(
  db: D1Database,
  auth: SessionAuth,
  task: TaskProjection,
  body: z.infer<typeof taskCompletionBody>,
): Promise<Record<string, unknown>> {
  const now = Date.now();
  let response: Record<string, unknown> = parseObject(task.response_json);
  let attachmentId: string | null = task.attachment_id;

  if (task.kind === "acknowledge") {
    if (body.acknowledged !== true) throw ApiError.unprocessable("acknowledgement is required", "acknowledged");
    response = { acknowledged: true };
  } else if (task.kind === "file") {
    if (!body.attachment_id) throw ApiError.unprocessable("a completed upload is required", "attachment_id");
    const attachment = await db
      .prepare(
        `SELECT id FROM attachments
         WHERE id = ? AND event_id = ? AND owner_type = 'task_upload' AND owner_id = ? AND status = 'ready'`,
      )
      .bind(body.attachment_id, task.event_id, task.id)
      .first<{ id: string }>();
    if (!attachment) throw ApiError.unprocessable("the upload is not ready for this task", "attachment_id");
    attachmentId = attachment.id;
    response = { attachment_id: attachment.id };
  } else {
    if (!task.form_id) throw ApiError.conflict("this form task has no form definition");
    const fields = await listFormFields(db, task.form_id);
    const existing = await readSubmissionAnswers(db, task.submission_id);
    const rawAnswers = body.answers ?? {};
    const merged = { ...existing, ...rawAnswers };
    const projection = projectApplicableAnswers(fields, merged);
    if (projection.issues.length > 0) {
      throw ApiError.unprocessable("complete the visible required fields", projection.issues[0]?.fieldKey, projection.issues);
    }
    if (task.submission_id) {
      const statements = [];
      const applicable = new Set(projection.answers ? Object.keys(projection.answers) : []);
      for (const field of fields) {
        if (!isFieldApplicable(field, merged)) {
          statements.push(db.prepare("DELETE FROM submission_answers WHERE submission_id = ? AND field_id = ?").bind(task.submission_id, field.id));
          continue;
        }
        const value = projection.answers[field.key];
        if (value === undefined) {
          statements.push(db.prepare("DELETE FROM submission_answers WHERE submission_id = ? AND field_id = ?").bind(task.submission_id, field.id));
          continue;
        }
        const answer = JSON.stringify(value);
        statements.push(db.prepare(
          `INSERT INTO submission_answers (id, submission_id, field_id, value_text, value_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO NOTHING`,
        ).bind(crypto.randomUUID(), task.submission_id, field.id, typeof value === "string" ? value : null, answer, now, now));
      }
      // The schema has no natural unique key for answers. Remove the old row
      // for each field before inserting the canonical current value.
      for (const field of fields) {
        if (applicable.has(field.key)) {
          statements.unshift(db.prepare("DELETE FROM submission_answers WHERE submission_id = ? AND field_id = ?").bind(task.submission_id, field.id));
        }
      }
      if (statements.length > 0) await db.batch(statements);
    }
    response = projection.answers as Record<string, unknown>;
  }

  await db
    .prepare(
      `UPDATE speaker_tasks
       SET status = 'done', completed_at = ?, response_json = ?, attachment_id = ?, last_write_source = 'marquee', updated_at = ?
       WHERE id = ? AND event_id = ? AND person_id = ?`,
    )
    .bind(now, JSON.stringify(response), attachmentId, now, task.id, task.event_id, auth.personId)
    .run();

  return {
    id: task.id,
    title: task.title,
    kind: task.kind,
    status: "done",
    completed_at: now,
    attachment_id: attachmentId,
    response,
  };
}

async function editableTalk(
  db: D1Database,
  auth: SessionAuth,
  submissionId: string,
): Promise<{ eventId: string; submission: { id: string; title: string; abstract: string | null; updated_at: number }; formStatus: string | null; closesAt: number | null; override: boolean }> {
  const row = await db
    .prepare(
      `SELECT submission.id, submission.event_id, submission.title, submission.abstract, submission.updated_at,
         form.status AS form_status, form.closes_at
       FROM submissions submission
       JOIN events conference ON conference.id = submission.event_id AND conference.org_id = ?
       JOIN participations participation ON participation.submission_id = submission.id AND participation.person_id = ?
       LEFT JOIN forms form ON form.id = submission.form_id AND form.event_id = submission.event_id
       JOIN memberships membership ON membership.event_id = submission.event_id
         AND membership.person_id = ? AND membership.role = 'speaker'
       WHERE submission.id = ?`,
    )
    .bind(auth.orgId, auth.personId, auth.personId, submissionId)
    .first<{
      id: string;
      event_id: string;
      title: string;
      abstract: string | null;
      updated_at: number;
      form_status: string | null;
      closes_at: number | null;
    }>();
  if (!row) throw ApiError.notFound("submission not found");
  const setting = await db
    .prepare("SELECT value_json FROM event_settings WHERE event_id = ? AND key = ?")
    .bind(row.event_id, `speaker_talk_editing:${row.id}`)
    .first<{ value_json: string }>();
  return {
    eventId: row.event_id,
    submission: { id: row.id, title: row.title, abstract: row.abstract, updated_at: row.updated_at },
    formStatus: row.form_status,
    closesAt: row.closes_at,
    override: parseJson<{ enabled?: boolean }>(setting?.value_json, {}).enabled === true,
  };
}

function talkEditingOpen(current: Awaited<ReturnType<typeof editableTalk>>): boolean {
  if (current.override) return true;
  return current.formStatus === "open" && (current.closesAt === null || current.closesAt > Date.now());
}

async function updateProfile(context: import("hono").Context<ApiEnv>, body: z.infer<typeof profileBody>) {
  const auth = requireSession(context);
  await speakerEvent(context.env.DB, auth);
  const current = await personFor(context.env.DB, auth.personId);
  let headshot = current.headshot_attachment_id;
  if (body.headshot_attachment_id !== undefined) {
    if (body.headshot_attachment_id === null) {
      headshot = null;
    } else {
      const attachment = await context.env.DB
        .prepare(
          `SELECT id FROM attachments
           WHERE id = ? AND owner_type = 'person_headshot' AND owner_id = ? AND status = 'ready'`,
        )
        .bind(body.headshot_attachment_id, auth.personId)
        .first<{ id: string }>();
      if (!attachment) throw ApiError.unprocessable("the headshot upload is not ready for this speaker", "headshot_attachment_id");
      headshot = attachment.id;
    }
  }
  const now = Date.now();
  await context.env.DB
    .prepare(
      `UPDATE people
       SET title = ?, company = ?, bio = ?, social_links = ?, headshot_attachment_id = ?, last_write_source = 'marquee', updated_at = ?
       WHERE id = ?`,
    )
    .bind(
      body.title === undefined ? current.title : body.title,
      body.company === undefined ? current.company : body.company,
      body.bio === undefined ? current.bio : body.bio,
      JSON.stringify(body.social_links ?? parseSocialLinks(current.social_links)),
      headshot,
      now,
      auth.personId,
    )
    .run();
  const person = await personFor(context.env.DB, auth.personId);
  return context.json({
    person: {
      id: person.id,
      name: person.name,
      email: person.email,
      title: person.title,
      company: person.company,
      bio: person.bio,
      social_links: parseSocialLinks(person.social_links),
      headshot_attachment_id: person.headshot_attachment_id,
      updated_at: person.updated_at,
    },
  }, 200);
}

const getPortal = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/me/portal",
    operationId: "getSpeakerPortal",
    summary: "Read the authenticated speaker portal",
    description: "Returns only the current session speaker's conference status, submissions, tasks, profile, schedule, and handbook.",
    tags: ["Speaker portal"],
    request: { query: eventQuery },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "read" }, concurrency: "none" },
    responses: { 200: jsonResponse(portalResponseSchema, "Speaker portal snapshot"), ...errorResponses([401, 403, 404, 429, 500]) },
  },
  async (context) => {
    const auth = requireSession(context);
    const query = context.req.valid("query");
    return context.json(await portalSnapshot(context.env.DB, auth, query.eventId), 200);
  },
);

const completeSpeakerTask = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/me/tasks/{taskId}/complete",
    operationId: "completeSpeakerTask",
    summary: "Complete an authenticated speaker task",
    description: "Validates the actual acknowledge, form, or verified file payload before marking the speaker task done.",
    tags: ["Speaker portal"],
    request: { params: taskParams, body: { content: { "application/json": { schema: taskCompletionBody } } } },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 200: jsonResponse(taskResponseSchema, "Completed speaker task"), ...errorResponses([401, 403, 404, 409, 422, 429, 500]) },
  },
  async (context) => {
    const auth = requireSession(context);
    const task = await taskFor(context.env.DB, auth, context.req.valid("param").taskId);
    return context.json({ task: await completeTask(context.env.DB, auth, task, context.req.valid("json")) }, 200);
  },
);

const updateSpeakerProfile = defineApiRoute(
  {
    method: "patch",
    path: "/api/v1/me/profile",
    operationId: "updateSpeakerProfile",
    summary: "Update the authenticated speaker profile",
    description: "Updates the session speaker's public profile and optional ready headshot attachment.",
    tags: ["Speaker portal"],
    request: { body: { content: { "application/json": { schema: profileBody } } } },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 200: jsonResponse(profileResponseSchema, "Updated speaker profile"), ...errorResponses([401, 403, 404, 422, 429, 500]) },
  },
  async (context) => updateProfile(context, context.req.valid("json")),
);

const updateSpeakerTalk = defineApiRoute(
  {
    method: "patch",
    path: "/api/v1/me/submissions/{submissionId}/talk",
    operationId: "updateSpeakerTalk",
    summary: "Update an authenticated speaker talk",
    description: "Updates the speaker's own talk title and description while the conference form is open or an organizer override is active, recording immutable history.",
    tags: ["Speaker portal"],
    request: { params: submissionParams, body: { content: { "application/json": { schema: talkBody } } } },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 200: jsonResponse(talkResponseSchema, "Updated speaker talk"), ...errorResponses([401, 403, 404, 409, 422, 429, 500]) },
  },
  async (context) => {
    const auth = requireSession(context);
    const { submissionId } = context.req.valid("param");
    const body = context.req.valid("json");
    if (body.title === undefined && body.description === undefined) {
      throw ApiError.badRequest("title or description is required");
    }
    const current = await editableTalk(context.env.DB, auth, submissionId);
    if (!talkEditingOpen(current)) throw ApiError.forbidden("talk editing is closed for this conference");
    const next = {
      title: body.title ?? current.submission.title,
      description: body.description === undefined ? current.submission.abstract : body.description,
    };
    if (next.title === current.submission.title && next.description === current.submission.abstract) {
      return context.json({ submission: { ...current.submission, ...next }, history: await historyFor(context.env.DB, current.eventId, submissionId) }, 200);
    }
    const now = Date.now();
    await context.env.DB.batch([
      context.env.DB.prepare(
        `UPDATE submissions SET title = ?, abstract = ?, search_blob = ?, last_saved_at = ?, last_write_source = 'marquee', updated_at = ?
         WHERE id = ? AND event_id = ?`,
      ).bind(next.title, next.description, `${next.title} ${next.description ?? ""}`.toLowerCase(), now, now, submissionId, current.eventId),
      context.env.DB.prepare(
        `INSERT INTO audit_log (id, event_id, actor_person_id, actor_kind, action, entity_type, entity_id, before_json, after_json, created_at)
         VALUES (?, ?, ?, 'user', 'speaker_talk_updated', 'submission', ?, ?, ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        current.eventId,
        auth.personId,
        submissionId,
        JSON.stringify({ title: current.submission.title, description: current.submission.abstract }),
        JSON.stringify(next),
        now,
      ),
    ]);
    return context.json({
      submission: { ...current.submission, ...next, updated_at: now },
      history: await historyFor(context.env.DB, current.eventId, submissionId),
    }, 200);
  },
);

const updateSpeakerTalkEditing = defineApiRoute(
  {
    method: "patch",
    path: "/api/v1/events/{eventId}/submissions/{submissionId}/talk-editing",
    operationId: "updateSpeakerTalkEditing",
    summary: "Control speaker talk editing",
    description: "Allows program staff to reopen or close speaker title and description editing for one conference submission.",
    tags: ["Speaker portal"],
    request: { params: eventSubmissionParams, body: { content: { "application/json": { schema: talkEditingBody } } } },
    policy: { auth: { kind: "grants", grants: ["program:write"] }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 200: jsonResponse(talkEditingResponseSchema, "Talk editing setting"), ...errorResponses([401, 403, 404, 422, 429, 500]) },
  },
  async (context) => {
    const { eventId, submissionId } = context.req.valid("param");
    const exists = await context.env.DB
      .prepare("SELECT id FROM submissions WHERE id = ? AND event_id = ?")
      .bind(submissionId, eventId)
      .first<{ id: string }>();
    if (!exists) throw ApiError.notFound("submission not found");
    const { enabled } = context.req.valid("json");
    const now = Date.now();
    await context.env.DB.prepare(
      `INSERT INTO event_settings (id, event_id, key, value_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(event_id, key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
    ).bind(`speaker-talk-editing-${submissionId}`, eventId, `speaker_talk_editing:${submissionId}`, JSON.stringify({ enabled }), now, now).run();
    return context.json({ enabled }, 200);
  },
);

export const apiRoutes = [
  getPortal,
  completeSpeakerTask,
  updateSpeakerProfile,
  updateSpeakerTalk,
  updateSpeakerTalkEditing,
];
