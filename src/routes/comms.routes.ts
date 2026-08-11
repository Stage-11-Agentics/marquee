import { z } from "@hono/zod-openapi";

import type { ApiRouteEntry } from "../api/route";
import { createListQuerySchema, createListResponseSchema } from "../api/list";
import { defineApiRoute, errorResponses, jsonResponse } from "../api/route";
import { ApiError } from "../api/errors";
import { authHasRole } from "../lib/auth/scope-resolution";
import { getAuth } from "../lib/auth/auth-middleware";
import { listCommsAudience, type CommsRecipientRow } from "../jobs/mail/audience";
import { enqueueMailMessage } from "../jobs/mail/consumer";
import { enqueueBulkReminder } from "../jobs/mail/triggers";
import {
  defaultTemplateKeyFromId,
  findTemplate,
  listCommunicationTemplates,
  MAIL_TEMPLATE_KEYS,
  type MailTemplateKey,
} from "../jobs/mail/templates";
import { renderAdHocMail, renderMail, type MergeData } from "../jobs/mail/render";
import { mergeDataForRecipient, firstName } from "../jobs/mail/merge-data";
import type { OutboxRow } from "../db/schema";
import { hasSpeakerTaskCancellationColumn, submissionFilterSchema } from "./submissions.queries";

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
const sendResponse = z.object({
  selected: z.number(),
  queued: z.number(),
  duplicate: z.number(),
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
  const eventAllowed = auth.eventId === null
    ? (auth.eventIds.length === 0 || auth.eventIds.includes(eventId))
    : auth.eventId === eventId;
  const required: "comms:send" | "program:read" = write ? "comms:send" : "program:read";
  if (!eventAllowed || (!auth.permissions.includes(required) && !auth.grants.includes(required))) {
    throw ApiError.forbidden(`communications requires ${required}`);
  }
}

export interface RecipientRow {
  person_id: string;
  submission_id: string | null;
  role: string;
  email: string;
  name: string;
  submission_title: string;
  room: string | null;
  starts_at: number | null;
  task_title: string | null;
  task_due_at: number | null;
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
  const result = await db
    .prepare(
      `SELECT DISTINCT p.id AS person_id, s.id AS submission_id, part.role, p.email, p.name,
              s.title AS submission_title, r.name AS room, ai.starts_at,
              st.title AS task_title, st.due_at AS task_due_at
       FROM submissions s
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
       LEFT JOIN rooms r ON r.id = ai.room_id
       LEFT JOIN speaker_tasks st ON st.id = (
         SELECT selected_task.id FROM speaker_tasks selected_task
           WHERE selected_task.event_id = s.event_id
             AND selected_task.person_id = p.id
             AND selected_task.submission_id = s.id
             ${selectedTaskStateCondition}
             ${includeCancelledAt && selector.task_state === "open" ? "AND selected_task.cancelled_at IS NULL" : ""}
         ORDER BY CASE WHEN selected_task.status = 'open' THEN 0 ELSE 1 END,
                  selected_task.due_at ASC, selected_task.id ASC
         LIMIT 1
       )
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
                person.email, person.name, '—' AS submission_title, NULL AS room,
                NULL AS starts_at, st.title AS task_title, st.due_at AS task_due_at
         FROM memberships membership
         JOIN people person ON person.id = membership.person_id
         LEFT JOIN speaker_tasks st ON st.id = (
           SELECT selected_task.id FROM speaker_tasks selected_task
           WHERE selected_task.event_id = membership.event_id
             AND selected_task.person_id = person.id
             AND selected_task.submission_id IS NULL
             ${taskStateCondition}
           ORDER BY CASE WHEN selected_task.status = 'open' THEN 0 ELSE 1 END,
                    selected_task.due_at ASC, selected_task.id ASC
           LIMIT 1
         )
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
         GROUP BY person.id, person.email, person.name, st.title, st.due_at
         ORDER BY person.name COLLATE NOCASE, person.id ASC`,
      )
      .bind(...fallbackBindings, ...(selector.task_state ? [selector.task_state] : []))
      .all<RecipientRow>();
    rows.push(...fallback.results);
  }

  return rows.sort((left, right) => left.name.localeCompare(right.name) || (left.submission_title ?? "").localeCompare(right.submission_title ?? "") || left.person_id.localeCompare(right.person_id));
}

function mergeDataFor(row: RecipientRow): MergeData {
  return mergeDataForRecipient({
    name: row.name,
    email: row.email,
    submissionTitle: row.submission_title,
    room: row.room,
    startsAt: row.starts_at,
    taskTitle: row.task_title,
    taskDueAt: row.task_due_at,
  });
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
    if (!(MAIL_TEMPLATE_KEYS as readonly string[]).includes(body.key)) throw ApiError.badRequest("unknown template key", "key");
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
    if (!current) {
      const defaultKey = defaultTemplateKeyFromId(eventId, templateId);
      if (!defaultKey) throw ApiError.notFound("template not found");
      const fallback = await findTemplate(context.env.DB, eventId, defaultKey);
      persistedId = crypto.randomUUID();
      current = {
        key: fallback.key,
        name: fallback.name,
        subject: fallback.subject,
        body_md: fallback.body_md,
        enabled: fallback.enabled,
      };
      const now = Date.now();
      await context.env.DB.prepare(
        `INSERT INTO email_templates (id, event_id, key, name, subject, body_md, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(persistedId, eventId, current.key, current.name, current.subject, current.body_md, current.enabled, now, now).run();
    }
    const nextKey = body.key ?? current.key;
    if (!(MAIL_TEMPLATE_KEYS as readonly string[]).includes(nextKey)) throw ApiError.badRequest("unknown template key", "key");
    const now = Date.now();
    await context.env.DB.prepare(
      `UPDATE email_templates SET key = ?, name = ?, subject = ?, body_md = ?, enabled = ?, updated_at = ? WHERE id = ? AND event_id = ?`,
    ).bind(nextKey, body.name ?? current.name, body.subject ?? current.subject, body.body_md ?? current.body_md, body.enabled === undefined ? current.enabled : body.enabled ? 1 : 0, now, persistedId, eventId).run();
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
    const selected = (await recipientsFor(context.env.DB, eventId, {
      person_ids: [body.person_id],
      ...(body.submission_id ? { submission_ids: [body.submission_id] } : {}),
      role: body.role,
      task_state: "open",
    }))[0];
    const data: MergeData = selected
      ? mergeDataFor(selected)
      : { "speaker.first_name": firstName(recipient.name), "speaker.name": recipient.name, "speaker.email": recipient.email };
    if (body.template_key) {
      if (!(MAIL_TEMPLATE_KEYS as readonly string[]).includes(body.template_key)) throw ApiError.badRequest("unknown template key", "template_key");
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
    const body = context.req.valid("json");
    const hasTemplate = body.template_key !== undefined;
    const hasAdHoc = body.subject !== undefined || body.body !== undefined;
    if (hasTemplate === hasAdHoc || (!hasTemplate && (body.subject === undefined || body.body === undefined))) {
      throw ApiError.badRequest("send requires exactly one of template_key or subject and body");
    }
    if (body.template_key && !(MAIL_TEMPLATE_KEYS as readonly string[]).includes(body.template_key)) {
      throw ApiError.badRequest("unknown template key", "template_key");
    }
    const recipients = await recipientsFor(context.env.DB, eventId, body.selector);
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
    return context.json({ selected: recipients.length, queued: outboxIds.length, duplicate, outbox_ids: outboxIds, outbox_rows: outboxRows }, 202);
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

export const apiRoutes = [
  getTemplates,
  createTemplate,
  updateTemplate,
  previewComms,
  sendComms,
  getOutbox,
  getPersonMessages,
  listCommunicationAudience,
];

export type CommunicationAudienceItem = CommsRecipientRow;
