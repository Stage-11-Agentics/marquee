import { z } from "@hono/zod-openapi";

import type { TaskTemplateRow } from "../db/schema";
import { ApiError } from "../api/errors";
import { getAuth } from "../lib/auth/auth-middleware";
import { newUlid } from "../api/ids";
import { auditStatement } from "../lib/audit";
import { defineApiRoute, errorResponses, jsonResponse, type ApiRouteEntry } from "../api/route";
import { resolveTaskDueAt } from "../lib/task-due";
import { normalizeTaskFileConfig, readTaskFileConfig, TaskFileConfigError, type TaskFileConfig } from "../lib/task-template-config";
import {
  readTaskAppliesToRoles,
  roleInSql,
  WORK_HOLDING_PARTICIPATION_ROLES,
  writeTaskAppliesToRoles,
} from "../lib/participants";

const eventParams = z.object({ eventId: z.string().min(1) });
const templateParams = eventParams.extend({ templateId: z.string().min(1) });
const taskKind = z.enum(["acknowledge", "file", "form"]);
/**
 * Who a template is for. The enum is the on-stage population, so a template can
 * never be aimed at a role the fan-out does not reach — an organizer narrowing
 * a task to a role nobody can hold would produce a template that reaches no
 * one, and nothing on any screen would say so.
 */
const appliesToRoles = z
  .array(z.enum(WORK_HOLDING_PARTICIPATION_ROLES))
  .min(1)
  .max(WORK_HOLDING_PARTICIPATION_ROLES.length);
const fileConfigSchema = z.object({
  accept: z.array(z.string()),
  maxBytes: z.number().int().positive(),
});
const fileConfigResponseSchema = z.object({
  accept: z.array(z.string()).min(1),
  maxBytes: z.number().int().positive(),
});
const taskTemplateSchema = z.object({
  id: z.string(),
  event_id: z.string(),
  name: z.string(),
  kind: taskKind,
  description: z.string(),
  position: z.number().int().nonnegative(),
  file_config: fileConfigResponseSchema.nullable(),
  updated_at: z.number(),
  due_at: z.number().nullable(),
  due_offset_days: z.number().int().nullable(),
  form_id: z.string().nullable(),
  auto_assign: z.number().int(),
  applies_to_roles: z.array(z.enum(WORK_HOLDING_PARTICIPATION_ROLES)),
  assigned_count: z.number().int().nonnegative(),
  open_count: z.number().int().nonnegative(),
});
const taskTemplatesResponse = z.object({ data: z.array(taskTemplateSchema) });
const taskTemplateResponse = jsonResponse(z.object({ data: taskTemplateSchema }), "Updated task template");
const fileConfigBody = z.object({ file_config: fileConfigSchema.nullable() });

/** One assignment row as the organizer's task list reads it. */
const speakerTaskSchema = z.object({
  id: z.string(),
  template_id: z.string(),
  title: z.string(),
  kind: taskKind,
  due_at: z.number(),
  status: z.enum(["open", "done"]),
  completed_at: z.number().nullable(),
  cancelled: z.boolean(),
  person: z.object({ id: z.string(), name: z.string(), email: z.string() }),
  submission_id: z.string().nullable(),
  submission_title: z.string().nullable(),
});
const speakerTasksResponse = z.object({ data: z.array(speakerTaskSchema) });
const assigneeSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  company: z.string().nullable(),
  accepted_session_count: z.number().int().nonnegative(),
  sessions: z.array(z.object({ id: z.string(), title: z.string() })),
});
const assigneesResponse = z.object({ data: z.array(assigneeSchema) });

const MAX_ASSIGNEES = 200;
const personIdList = z.array(z.string().min(1)).min(1).max(MAX_ASSIGNEES);

/**
 * Which session each person's copy of the task belongs to.
 *
 * A batch-wide `submission_id` is only ever right for co-speakers of one
 * session; the picker assigns to many speakers at once, so the session has to
 * be resolved per person or the whole deliverables board files under the wrong
 * talk.
 */
const sessionAssignmentList = z
  .array(z.object({ person_id: z.string().min(1), submission_id: z.string().min(1).nullable() }))
  .max(MAX_ASSIGNEES);

const createTemplateBody = z.object({
  name: z.string().trim().min(1).max(200),
  kind: taskKind,
  description: z.string().max(2000).default(""),
  due_at: z.number().int().nullable().optional(),
  due_offset_days: z.number().int().min(0).max(3650).nullable().optional(),
  form_id: z.string().min(1).nullable().optional(),
  file_config: fileConfigSchema.nullable().optional(),
  auto_assign: z.boolean().default(false),
  applies_to_roles: appliesToRoles.optional(),
  assign_to: z.array(z.string().min(1)).max(MAX_ASSIGNEES).default([]),
  session_assignments: sessionAssignmentList.optional(),
});
const patchTemplateBody = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  kind: taskKind.optional(),
  description: z.string().max(2000).optional(),
  due_at: z.number().int().nullable().optional(),
  due_offset_days: z.number().int().min(0).max(3650).nullable().optional(),
  form_id: z.string().min(1).nullable().optional(),
  file_config: fileConfigSchema.nullable().optional(),
  auto_assign: z.boolean().optional(),
  applies_to_roles: appliesToRoles.optional(),
});
const assignBody = z.object({
  template_id: z.string().min(1),
  person_ids: personIdList,
  due_at: z.number().int().nullable().optional(),
  submission_id: z.string().min(1).nullable().optional(),
  session_assignments: sessionAssignmentList.optional(),
});

type TaskTemplateView = Pick<TaskTemplateRow, "id" | "event_id" | "name" | "kind" | "description" | "position" | "updated_at"> & {
  file_config: TaskFileConfig | null;
  due_at: number | null;
  due_offset_days: number | null;
  form_id: string | null;
  auto_assign: number;
  applies_to_roles: string[];
  assigned_count: number;
  open_count: number;
};

type TemplateListRow = Pick<
  TaskTemplateRow,
  "id" | "event_id" | "name" | "kind" | "description" | "position" | "file_config" | "updated_at" | "due_at" | "due_offset_days" | "form_id" | "auto_assign" | "applies_to_roles"
> & { assigned_count?: number | null; open_count?: number | null };

interface AuditActor {
  personId: string;
  kind: "user" | "api_token";
}

interface SpeakerTaskQueryRow {
  id: string;
  template_id: string;
  title: string;
  kind: "acknowledge" | "file" | "form";
  due_at: number;
  status: "open" | "done";
  completed_at: number | null;
  cancelled_at: number | null;
  submission_id: string | null;
  person_id: string;
  person_name: string;
  person_email: string;
  submission_title: string | null;
}

interface AssigneeQueryRow {
  id: string;
  name: string;
  email: string;
  company: string | null;
  accepted_session_count: number;
}

interface PersonSessionRow {
  person_id: string;
  submission_id: string;
  title: string;
}

/** A session as the assignment flow offers it: enough to pick one, nothing more. */
interface SessionOption {
  id: string;
  title: string;
}

/** The body's per-person session choices, keyed for lookup. Last entry wins. */
function sessionChoicesFrom(
  entries: ReadonlyArray<{ person_id: string; submission_id: string | null }> | undefined,
): Map<string, string | null> | undefined {
  if (entries === undefined) return undefined;
  return new Map(entries.map((entry) => [entry.person_id, entry.submission_id]));
}

/**
 * Every session each of these people is on at this conference, in the order the
 * picker shows them.
 *
 * Acceptance is not the gate: a speaker whose session is still in review is a
 * speaker the organizer is already chasing deliverables from — the same reason
 * the assignee list itself does not wait for acceptance. Rejected and withdrawn
 * sessions are gone, so a deck can never be filed under one.
 */
async function sessionsByPerson(
  db: D1Database,
  eventId: string,
  personIds: readonly string[],
): Promise<Map<string, SessionOption[]>> {
  const sessions = new Map<string, SessionOption[]>();
  if (personIds.length === 0) return sessions;
  const rows = await db.prepare(
    `SELECT DISTINCT part.person_id AS person_id, submission.id AS submission_id, submission.title AS title
     FROM participations part
     JOIN submissions submission ON submission.id = part.submission_id
     WHERE submission.event_id = ?
       AND submission.status NOT IN ('rejected', 'withdrawn')
       AND part.role IN ('speaker', 'co_speaker', 'submitter')
       AND part.person_id IN (SELECT CAST(value AS TEXT) FROM json_each(?))
     ORDER BY submission.title COLLATE NOCASE ASC, submission.id ASC`,
  ).bind(eventId, JSON.stringify([...new Set(personIds)])).all<PersonSessionRow>();
  for (const row of rows.results) {
    const list = sessions.get(row.person_id);
    const option = { id: row.submission_id, title: row.title };
    if (list) list.push(option); else sessions.set(row.person_id, [option]);
  }
  return sessions;
}

async function eventExists(db: D1Database, eventId: string): Promise<void> {
  const event = await db.prepare("SELECT id FROM events WHERE id = ?").bind(eventId).first<{ id: string }>();
  if (!event) throw ApiError.notFound("conference not found");
}

/**
 * Who to write on the audit row. A token acts as the person who issued it —
 * "an API token did it" names no one accountable.
 */
async function taskActor(context: Parameters<NonNullable<ApiRouteEntry["handler"]>>[0]): Promise<AuditActor> {
  const auth = getAuth(context);
  if (!auth) throw ApiError.unauthenticated();
  if (auth.kind === "session") return { personId: auth.personId, kind: "user" };
  const token = await context.env.DB.prepare("SELECT created_by FROM api_tokens WHERE id = ?").bind(auth.tokenId).first<{ created_by: string }>();
  if (!token?.created_by) throw ApiError.unauthenticated("the token issuer is no longer available");
  return { personId: token.created_by, kind: "api_token" };
}

function templateView(row: TemplateListRow): TaskTemplateView {
  return {
    id: row.id,
    event_id: row.event_id,
    name: row.name,
    kind: row.kind,
    description: row.description,
    position: row.position,
    file_config: readTaskFileConfig(row.file_config),
    updated_at: row.updated_at,
    due_at: row.due_at === null ? null : Number(row.due_at),
    due_offset_days: row.due_offset_days === null ? null : Number(row.due_offset_days),
    form_id: row.form_id,
    auto_assign: Number(row.auto_assign),
    applies_to_roles: readTaskAppliesToRoles(row.applies_to_roles),
    assigned_count: Number(row.assigned_count ?? 0),
    open_count: Number(row.open_count ?? 0),
  };
}

function normalizeForWrite(value: unknown): TaskFileConfig {
  try {
    return normalizeTaskFileConfig(value);
  } catch (error) {
    if (error instanceof TaskFileConfigError) throw ApiError.unprocessable(error.message, error.field);
    throw error;
  }
}

async function templateFor(db: D1Database, eventId: string, templateId: string): Promise<TaskTemplateRow> {
  const template = await db.prepare(
    `SELECT id, event_id, name, kind, description, due_at, due_offset_days, form_id, file_config, position, auto_assign, applies_to_roles, created_at, updated_at
     FROM task_templates WHERE id = ? AND event_id = ?`,
  ).bind(templateId, eventId).first<TaskTemplateRow>();
  if (!template) throw ApiError.notFound("task template not found");
  return template;
}

/** Read one template back through the list projection, so writes answer in the shape reads use. */
async function templateViewFor(db: D1Database, eventId: string, templateId: string): Promise<TaskTemplateView> {
  const row = await db.prepare(`${TEMPLATE_SELECT} WHERE template.id = ? AND template.event_id = ?`).bind(templateId, eventId).first<TemplateListRow>();
  if (!row) throw ApiError.notFound("task template not found");
  return templateView(row);
}

/**
 * The table's CHECK constraints, restated in Zod's place so a bad body answers
 * 422 with the offending field rather than a 500 from SQLite. Every rule here
 * mirrors one in `migrations/0001_init.sql:578`.
 */
function assertDeadline(dueAt: number | null, dueOffsetDays: number | null): void {
  if ((dueAt === null) === (dueOffsetDays === null)) {
    throw ApiError.unprocessable("a task needs exactly one deadline: a due date or a number of days after acceptance", "due_at");
  }
}

async function assertFormBelongsToEvent(db: D1Database, eventId: string, formId: string): Promise<void> {
  const form = await db.prepare("SELECT id FROM forms WHERE id = ? AND event_id = ?").bind(formId, eventId).first<{ id: string }>();
  if (!form) throw ApiError.unprocessable("that form belongs to another conference", "form_id");
}

/**
 * Shape rules the schema cannot express: a form task needs a form, and only a
 * file task may carry an upload policy — an accept-list on an acknowledge task
 * is a promise the portal would render and never honour.
 */
async function assertKindShape(
  db: D1Database,
  eventId: string,
  kind: "acknowledge" | "file" | "form",
  formId: string | null,
  fileConfig: TaskFileConfig | null,
): Promise<void> {
  if (kind === "form") {
    if (!formId) throw ApiError.unprocessable("a form task must name the form speakers fill in", "form_id");
    await assertFormBelongsToEvent(db, eventId, formId);
  } else if (formId) {
    throw ApiError.unprocessable("only a form task can name a form", "form_id");
  }
  if (kind !== "file" && fileConfig !== null) {
    throw ApiError.unprocessable("only a file task can carry an upload policy", "file_config");
  }
}

interface TaskCountsRow { done: number; open: number }

async function taskCountsFor(db: D1Database, templateId: string): Promise<TaskCountsRow> {
  const row = await db.prepare(
    `SELECT COALESCE(SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END), 0) AS done,
            COALESCE(SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END), 0) AS open
     FROM speaker_tasks WHERE template_id = ?`,
  ).bind(templateId).first<TaskCountsRow>();
  return { done: Number(row?.done ?? 0), open: Number(row?.open ?? 0) };
}

/**
 * Build the rows that assign a template to people, for composition into the
 * caller's `batch()`.
 *
 * Both doors into assignment — creating a template with `assign_to`, and
 * assigning an existing one — come through here, so the deadline arithmetic and
 * the duplicate rule are written once. A person who already holds an *open*
 * task for this template is skipped: pressing Assign twice must not mint a
 * second copy of the same obligation, and must not silently claim it did.
 *
 * The session each task belongs to is settled here too, in this order: the
 * organizer's explicit per-person choice, then a batch-wide `submission_id`,
 * then the person's own session when they have exactly one. That last step is
 * the whole point — a speaker with one talk should never need a human to say
 * which talk their slides are for, and a task born unattached cannot be placed
 * by the deliverables board or by a session-grouped export.
 */
async function assignmentStatements(
  db: D1Database,
  template: Pick<TaskTemplateRow, "id" | "event_id" | "name" | "kind" | "description" | "due_at" | "due_offset_days">,
  personIds: readonly string[],
  options: {
    now: number;
    actor: AuditActor;
    requestId: string | null;
    dueAtOverride?: number | null;
    submissionId?: string | null;
    sessionChoices?: ReadonlyMap<string, string | null>;
  },
): Promise<{ statements: D1PreparedStatement[]; assigned: string[]; skipped: string[] }> {
  const unique = [...new Set(personIds)];
  if (unique.length === 0) return { statements: [], assigned: [], skipped: [] };

  const idsJson = JSON.stringify(unique);
  const known = await db.prepare(
    `SELECT person.id FROM people person
     JOIN events event ON event.org_id = person.org_id
     WHERE event.id = ? AND person.id IN (SELECT CAST(value AS TEXT) FROM json_each(?))`,
  ).bind(template.event_id, idsJson).all<{ id: string }>();
  const knownIds = new Set(known.results.map((row) => row.id));
  const missing = unique.filter((id) => !knownIds.has(id));
  if (missing.length > 0) {
    throw ApiError.unprocessable(`${missing.length} of the selected people are not in this conference's organization`, "person_ids");
  }

  const existing = await db.prepare(
    `SELECT person_id FROM speaker_tasks
     WHERE template_id = ? AND status = 'open' AND cancelled_at IS NULL
       AND person_id IN (SELECT CAST(value AS TEXT) FROM json_each(?))`,
  ).bind(template.id, idsJson).all<{ person_id: string }>();
  const alreadyOwed = new Set(existing.results.map((row) => row.person_id));

  const assigned = unique.filter((id) => !alreadyOwed.has(id));
  const skipped = unique.filter((id) => alreadyOwed.has(id));
  const dueAt = options.dueAtOverride ?? resolveTaskDueAt(template, options.now);

  const sessions = await sessionsByPerson(db, template.event_id, assigned);
  const sessionFor = (personId: string): string | null => {
    const chosen = options.sessionChoices?.get(personId);
    if (chosen !== undefined) {
      if (chosen !== null && !(sessions.get(personId) ?? []).some((session) => session.id === chosen)) {
        throw ApiError.unprocessable("that speaker is not on the session you picked for them", "session_assignments");
      }
      return chosen;
    }
    if (options.submissionId) return options.submissionId;
    const own = sessions.get(personId) ?? [];
    return own.length === 1 ? (own[0] as SessionOption).id : null;
  };

  const statements = assigned.flatMap((personId) => {
    const taskId = newUlid(options.now);
    const submissionId = sessionFor(personId);
    return [
      db.prepare(
        `INSERT INTO speaker_tasks
          (id, event_id, person_id, submission_id, template_id, title, kind, description, due_at,
           status, completed_at, response_json, attachment_id, last_write_source, cancelled_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', NULL, NULL, NULL, 'marquee', NULL, ?, ?)`,
      ).bind(
        taskId,
        template.event_id,
        personId,
        submissionId,
        template.id,
        template.name,
        template.kind,
        template.description,
        dueAt,
        options.now,
        options.now,
      ),
      auditStatement(db, {
        eventId: template.event_id,
        actorKind: options.actor.kind,
        actorPersonId: options.actor.personId,
        action: "speaker_task.assigned",
        entityType: "speaker_task",
        entityId: taskId,
        after: { template_id: template.id, person_id: personId, title: template.name, due_at: dueAt, submission_id: submissionId },
        now: options.now,
        requestId: options.requestId,
      }),
    ];
  });

  return { statements, assigned, skipped };
}

/**
 * The one projection every template read answers with. The assignment counts
 * ride along because the authoring page's first question about any task is
 * "who owes this, and how many have done it" — a second round trip per row
 * would be a list that renders before it can tell the truth.
 */
const TEMPLATE_SELECT =
  `SELECT template.id, template.event_id, template.name, template.kind, template.description,
          template.position, template.file_config, template.updated_at, template.due_at,
          template.due_offset_days, template.form_id, template.auto_assign,
          template.applies_to_roles,
          (SELECT COUNT(*) FROM speaker_tasks task
            WHERE task.template_id = template.id AND task.cancelled_at IS NULL) AS assigned_count,
          (SELECT COUNT(*) FROM speaker_tasks task
            WHERE task.template_id = template.id AND task.cancelled_at IS NULL AND task.status = 'open') AS open_count
   FROM task_templates template`;

const listTaskTemplates = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/events/{eventId}/task-templates",
    operationId: "listTaskTemplates",
    summary: "List conference task templates",
    tags: ["Task templates"],
    request: { params: eventParams },
    policy: { auth: { kind: "grants", grants: ["program:read"] }, rateLimit: { bucket: "read" }, concurrency: "none" },
    responses: { 200: jsonResponse(taskTemplatesResponse, "Conference task templates"), ...errorResponses([401, 403, 404, 429, 500]) },
  },
  async (context) => {
    const { eventId } = context.req.valid("param");
    await eventExists(context.env.DB, eventId);
    const rows = await context.env.DB.prepare(
      `${TEMPLATE_SELECT} WHERE template.event_id = ? ORDER BY template.position, template.id`,
    ).bind(eventId).all<TemplateListRow>();
    return context.json({ data: rows.results.map(templateView) }, 200);
  },
);

const createTaskTemplate = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/events/{eventId}/task-templates",
    operationId: "createTaskTemplate",
    summary: "Create a task template, optionally assigning it to speakers",
    description:
      "Authors a task speakers must complete. Supply `due_at` for a fixed deadline or `due_offset_days` to count from acceptance — exactly one. `assign_to` assigns the new task to those people in the same write, bypassing `auto_assign`.",
    tags: ["Task templates"],
    request: { params: eventParams, body: { content: { "application/json": { schema: createTemplateBody } } } },
    policy: { auth: { kind: "grants", grants: ["program:write"] }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 201: jsonResponse(z.object({ data: taskTemplateSchema, assigned: z.number().int(), skipped: z.number().int() }), "Created task template"), ...errorResponses([400, 401, 403, 404, 422, 429, 500]) },
  },
  async (context) => {
    const { eventId } = context.req.valid("param");
    await eventExists(context.env.DB, eventId);
    const actor = await taskActor(context);
    const body = context.req.valid("json");

    const dueAt = body.due_at ?? null;
    const dueOffsetDays = body.due_offset_days ?? null;
    assertDeadline(dueAt, dueOffsetDays);
    const fileConfig = body.file_config === undefined || body.file_config === null ? null : normalizeForWrite(body.file_config);
    await assertKindShape(context.env.DB, eventId, body.kind, body.form_id ?? null, fileConfig);

    const now = Date.now();
    const requestId = context.get("requestId") ?? null;
    const templateId = newUlid(now);
    const positionRow = await context.env.DB
      .prepare("SELECT COALESCE(MAX(position), -1) + 1 AS next FROM task_templates WHERE event_id = ?")
      .bind(eventId).first<{ next: number }>();
    const template = {
      id: templateId,
      event_id: eventId,
      name: body.name,
      kind: body.kind,
      description: body.description,
      due_at: dueAt,
      due_offset_days: dueOffsetDays,
    };
    const assignment = await assignmentStatements(context.env.DB, template, body.assign_to, {
      now,
      actor,
      requestId,
      sessionChoices: sessionChoicesFrom(body.session_assignments),
    });

    await context.env.DB.batch([
      context.env.DB.prepare(
        `INSERT INTO task_templates
          (id, event_id, name, kind, description, due_at, due_offset_days, form_id, file_config, position, auto_assign, applies_to_roles, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        templateId,
        eventId,
        body.name,
        body.kind,
        body.description,
        dueAt,
        dueOffsetDays,
        body.form_id ?? null,
        fileConfig === null ? null : JSON.stringify(fileConfig),
        Number(positionRow?.next ?? 0),
        body.auto_assign ? 1 : 0,
        writeTaskAppliesToRoles(body.applies_to_roles),
        now,
        now,
      ),
      auditStatement(context.env.DB, {
        eventId,
        actorKind: actor.kind,
        actorPersonId: actor.personId,
        action: "task_template.created",
        entityType: "task_template",
        entityId: templateId,
        after: { name: body.name, kind: body.kind, due_at: dueAt, due_offset_days: dueOffsetDays, auto_assign: body.auto_assign ? 1 : 0, applies_to_roles: readTaskAppliesToRoles(body.applies_to_roles), assigned: assignment.assigned.length },
        now,
        requestId,
      }),
      ...assignment.statements,
    ]);

    return context.json(
      { data: await templateViewFor(context.env.DB, eventId, templateId), assigned: assignment.assigned.length, skipped: assignment.skipped.length },
      201,
    );
  },
);

const updateTaskTemplate = defineApiRoute(
  {
    method: "patch",
    path: "/api/v1/events/{eventId}/task-templates/{templateId}",
    operationId: "updateTaskTemplate",
    summary: "Update a task template",
    description:
      "Every field is optional. Changing the name, instructions, or deadline propagates to the template's still-open assignments — a deadline the organizer moved but the speaker's portal never heard about is worse than no deadline at all. Completed assignments keep what was asked of them at the time.",
    tags: ["Task templates"],
    request: { params: templateParams, body: { content: { "application/json": { schema: patchTemplateBody } } } },
    policy: { auth: { kind: "grants", grants: ["program:write"] }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 200: taskTemplateResponse, ...errorResponses([400, 401, 403, 404, 409, 422, 429, 500]) },
  },
  async (context) => {
    const { eventId, templateId } = context.req.valid("param");
    const template = await templateFor(context.env.DB, eventId, templateId);
    const actor = await taskActor(context);
    const body = context.req.valid("json");

    const kind = body.kind ?? template.kind;
    if (body.kind !== undefined && body.kind !== template.kind) {
      const counts = await taskCountsFor(context.env.DB, templateId);
      const total = counts.done + counts.open;
      if (total > 0) {
        throw ApiError.conflict(
          `this task is already assigned to ${total} speaker${total === 1 ? "" : "s"}; changing what it asks for would invalidate what they have already done. Create a new task instead.`,
          { assigned: total },
        );
      }
    }

    // `file_config` was the only field this route once accepted, and callers
    // still send it alone. Absent keeps whatever the template already carries.
    const fileConfigProvided = body.file_config !== undefined;
    if (fileConfigProvided && kind !== "file") {
      throw ApiError.unprocessable("only file task templates have upload settings", "file_config");
    }
    const nextFileConfig = fileConfigProvided
      ? (body.file_config === null || body.file_config === undefined ? null : normalizeForWrite(body.file_config))
      : readTaskFileConfig(template.file_config);

    const dueProvided = body.due_at !== undefined || body.due_offset_days !== undefined;
    const nextDueAt = body.due_at !== undefined ? body.due_at : (body.due_offset_days !== undefined ? null : template.due_at);
    const nextOffset = body.due_offset_days !== undefined ? body.due_offset_days : (body.due_at !== undefined ? null : template.due_offset_days);
    assertDeadline(nextDueAt, nextOffset);

    const nextFormId = body.form_id !== undefined ? body.form_id : template.form_id;
    await assertKindShape(context.env.DB, eventId, kind, nextFormId, kind === "file" ? nextFileConfig : null);

    const nextName = body.name ?? template.name;
    const nextDescription = body.description ?? template.description;
    const nextAutoAssign = body.auto_assign === undefined ? Number(template.auto_assign) : (body.auto_assign ? 1 : 0);
    const nextAppliesToRoles = readTaskAppliesToRoles(body.applies_to_roles ?? template.applies_to_roles);
    const now = Date.now();
    const requestId = context.get("requestId") ?? null;

    const statements = [
      context.env.DB.prepare(
        `UPDATE task_templates
         SET name = ?, kind = ?, description = ?, due_at = ?, due_offset_days = ?, form_id = ?, file_config = ?, auto_assign = ?, applies_to_roles = ?, updated_at = ?
         WHERE id = ? AND event_id = ?`,
      ).bind(
        nextName,
        kind,
        nextDescription,
        nextDueAt,
        nextOffset,
        nextFormId,
        kind === "file" && nextFileConfig !== null ? JSON.stringify(nextFileConfig) : null,
        nextAutoAssign,
        JSON.stringify(nextAppliesToRoles),
        now,
        templateId,
        eventId,
      ),
      auditStatement(context.env.DB, {
        eventId,
        actorKind: actor.kind,
        actorPersonId: actor.personId,
        action: "task_template.updated",
        entityType: "task_template",
        entityId: templateId,
        before: { name: template.name, kind: template.kind, description: template.description, due_at: template.due_at, due_offset_days: template.due_offset_days, auto_assign: Number(template.auto_assign), applies_to_roles: readTaskAppliesToRoles(template.applies_to_roles) },
        after: { name: nextName, kind, description: nextDescription, due_at: nextDueAt, due_offset_days: nextOffset, auto_assign: nextAutoAssign, applies_to_roles: nextAppliesToRoles },
        now,
        requestId,
      }),
    ];

    if (nextName !== template.name || nextDescription !== template.description || dueProvided) {
      // A fixed date is the same instant for everyone who owes the task. An
      // offset is not: it counts from each assignment, so the deadline is
      // recomputed against each row's own `created_at` rather than against the
      // moment of this edit — otherwise editing the wording of a task would
      // quietly hand every speaker a fresh extension.
      statements.push(nextDueAt !== null
        ? context.env.DB.prepare(
          `UPDATE speaker_tasks
           SET title = ?, description = ?, due_at = ?, updated_at = ?, last_write_source = 'marquee'
           WHERE template_id = ? AND status = 'open' AND cancelled_at IS NULL`,
        ).bind(nextName, nextDescription, nextDueAt, now, templateId)
        : context.env.DB.prepare(
          `UPDATE speaker_tasks
           SET title = ?, description = ?, due_at = created_at + ?, updated_at = ?, last_write_source = 'marquee'
           WHERE template_id = ? AND status = 'open' AND cancelled_at IS NULL`,
        ).bind(nextName, nextDescription, (nextOffset ?? 0) * 86_400_000, now, templateId));
    }

    await context.env.DB.batch(statements);
    return context.json({ data: await templateViewFor(context.env.DB, eventId, templateId) }, 200);
  },
);

const deleteTaskTemplate = defineApiRoute(
  {
    method: "delete",
    path: "/api/v1/events/{eventId}/task-templates/{templateId}",
    operationId: "deleteTaskTemplate",
    summary: "Delete a task template and its outstanding assignments",
    description:
      "Removes the template and every still-open assignment of it. Refuses when a speaker has already completed the task: those rows are the record that they did, and a tidy-up that deletes evidence is data loss by another name.",
    tags: ["Task templates"],
    request: { params: templateParams },
    policy: { auth: { kind: "grants", grants: ["program:write"] }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 204: { description: "Task template removed" }, ...errorResponses([401, 403, 404, 409, 429, 500]) },
  },
  async (context) => {
    const { eventId, templateId } = context.req.valid("param");
    const template = await templateFor(context.env.DB, eventId, templateId);
    const actor = await taskActor(context);
    const counts = await taskCountsFor(context.env.DB, templateId);
    if (counts.done > 0) {
      throw ApiError.conflict(
        `${counts.done} speaker${counts.done === 1 ? " has" : "s have"} already completed this task; deleting it would erase that record. Remove those assignments first if you truly mean to.`,
        { completed: counts.done },
      );
    }

    const now = Date.now();
    await context.env.DB.batch([
      // Cancelled rows go too: they still reference the template, so leaving
      // them behind would strand the delete on a foreign key.
      context.env.DB.prepare("DELETE FROM speaker_tasks WHERE template_id = ? AND status = 'open'").bind(templateId),
      context.env.DB.prepare("DELETE FROM task_templates WHERE id = ? AND event_id = ?").bind(templateId, eventId),
      auditStatement(context.env.DB, {
        eventId,
        actorKind: actor.kind,
        actorPersonId: actor.personId,
        action: "task_template.deleted",
        entityType: "task_template",
        entityId: templateId,
        before: { name: template.name, kind: template.kind, open_assignments: counts.open },
        now,
        requestId: context.get("requestId") ?? null,
      }),
    ]);
    return context.body(null, 204);
  },
);

const assignSpeakerTasks = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/events/{eventId}/speaker-tasks",
    operationId: "assignSpeakerTasks",
    summary: "Assign a task to one or more speakers",
    description:
      "Direct assignment, independent of `auto_assign` and of the acceptance cascade. People who already owe this task are reported as skipped rather than handed a duplicate. Each task is attached to a session: `session_assignments` names one per person, `submission_id` sets one for the whole batch, and a speaker with exactly one session of their own needs neither.",
    tags: ["Task templates"],
    request: { params: eventParams, body: { content: { "application/json": { schema: assignBody } } } },
    policy: { auth: { kind: "grants", grants: ["program:write"] }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: {
      201: jsonResponse(z.object({ assigned: z.number().int(), skipped: z.number().int() }), "Assignments created"),
      ...errorResponses([400, 401, 403, 404, 422, 429, 500]),
    },
  },
  async (context) => {
    const { eventId } = context.req.valid("param");
    const body = context.req.valid("json");
    const template = await templateFor(context.env.DB, eventId, body.template_id);
    const actor = await taskActor(context);

    if (body.submission_id) {
      const submission = await context.env.DB
        .prepare("SELECT id FROM submissions WHERE id = ? AND event_id = ?")
        .bind(body.submission_id, eventId).first<{ id: string }>();
      if (!submission) throw ApiError.unprocessable("that session belongs to another conference", "submission_id");
    }

    const now = Date.now();
    const assignment = await assignmentStatements(context.env.DB, template, body.person_ids, {
      now,
      actor,
      requestId: context.get("requestId") ?? null,
      dueAtOverride: body.due_at ?? undefined,
      submissionId: body.submission_id ?? null,
      sessionChoices: sessionChoicesFrom(body.session_assignments),
    });
    if (assignment.statements.length > 0) await context.env.DB.batch(assignment.statements);
    return context.json({ assigned: assignment.assigned.length, skipped: assignment.skipped.length }, 201);
  },
);

const listSpeakerTasks = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/events/{eventId}/speaker-tasks",
    operationId: "listSpeakerTasks",
    summary: "List every task assigned to a speaker for this conference",
    description:
      "Reads `speaker_tasks` directly rather than through event membership, so a speaker who arrived by any door — roster, import, or their own submission — still appears against what they owe.",
    tags: ["Task templates"],
    request: { params: eventParams },
    policy: { auth: { kind: "grants", grants: ["program:read"] }, rateLimit: { bucket: "read" }, concurrency: "none" },
    responses: { 200: jsonResponse(speakerTasksResponse, "Assigned speaker tasks"), ...errorResponses([401, 403, 404, 429, 500]) },
  },
  async (context) => {
    const { eventId } = context.req.valid("param");
    await eventExists(context.env.DB, eventId);
    const rows = await context.env.DB.prepare(
      `SELECT task.id, task.template_id, task.title, task.kind, task.due_at,
              task.status, task.completed_at, task.cancelled_at, task.submission_id,
              person.id AS person_id, person.name AS person_name, person.email AS person_email,
              submission.title AS submission_title
       FROM speaker_tasks task
       JOIN people person ON person.id = task.person_id
       LEFT JOIN submissions submission ON submission.id = task.submission_id
       WHERE task.event_id = ?
       ORDER BY task.due_at ASC, person.name COLLATE NOCASE ASC, task.id ASC`,
    ).bind(eventId).all<SpeakerTaskQueryRow>();
    return context.json({
      data: rows.results.map((row) => ({
        id: row.id,
        template_id: row.template_id,
        title: row.title,
        kind: row.kind,
        due_at: Number(row.due_at),
        status: row.status,
        completed_at: row.completed_at === null ? null : Number(row.completed_at),
        cancelled: row.cancelled_at !== null,
        person: { id: row.person_id, name: row.person_name, email: row.person_email },
        submission_id: row.submission_id,
        submission_title: row.submission_title,
      })),
    }, 200);
  },
);

const listTaskAssignees = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/events/{eventId}/task-assignees",
    operationId: "listTaskAssignees",
    summary: "List the people a task can be assigned to",
    description:
      "The union of this conference's speaker memberships and everyone taking part in one of its submissions. A speaker whose session is still in review is a speaker the organizer still has to chase, so the list does not wait for acceptance.",
    tags: ["Task templates"],
    request: { params: eventParams },
    policy: { auth: { kind: "grants", grants: ["program:read"] }, rateLimit: { bucket: "read" }, concurrency: "none" },
    responses: { 200: jsonResponse(assigneesResponse, "Assignable people"), ...errorResponses([401, 403, 404, 429, 500]) },
  },
  async (context) => {
    const { eventId } = context.req.valid("param");
    await eventExists(context.env.DB, eventId);
    const rows = await context.env.DB.prepare(
      `WITH candidate AS (
         SELECT person_id FROM memberships WHERE event_id = ? AND ${roleInSql("memberships", WORK_HOLDING_PARTICIPATION_ROLES)}
         UNION
         SELECT part.person_id FROM participations part
         JOIN submissions submission ON submission.id = part.submission_id
         WHERE submission.event_id = ? AND part.role IN ('speaker', 'submitter', 'co_speaker')
       )
       SELECT person.id, person.name, person.email, person.company,
              (SELECT COUNT(DISTINCT accepted.id)
                 FROM participations accepted_part
                 JOIN submissions accepted ON accepted.id = accepted_part.submission_id
                WHERE accepted_part.person_id = person.id
                  AND accepted.event_id = ? AND accepted.status = 'accepted') AS accepted_session_count
       FROM candidate
       JOIN people person ON person.id = candidate.person_id
       ORDER BY person.name COLLATE NOCASE ASC, person.id ASC`,
    ).bind(eventId, eventId, eventId).all<AssigneeQueryRow>();
    // The sessions ride along because the assignment flow's second question,
    // right after "who", is "for which talk" — and a picker that has to fetch
    // per speaker to answer it is a picker nobody waits for.
    const sessions = await sessionsByPerson(context.env.DB, eventId, rows.results.map((row) => row.id));
    return context.json({
      data: rows.results.map((row) => ({
        id: row.id,
        name: row.name,
        email: row.email,
        company: row.company,
        accepted_session_count: Number(row.accepted_session_count ?? 0),
        sessions: sessions.get(row.id) ?? [],
      })),
    }, 200);
  },
);

export const apiRoutes = [
  listTaskTemplates,
  createTaskTemplate,
  updateTaskTemplate,
  deleteTaskTemplate,
  assignSpeakerTasks,
  listSpeakerTasks,
  listTaskAssignees,
];
