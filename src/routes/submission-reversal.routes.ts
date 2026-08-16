import { z } from "@hono/zod-openapi";
import type { Context } from "hono";

import { ApiError } from "../api/errors";
import { defineApiRoute, errorResponses, jsonResponse } from "../api/route";
import type { ApiEnv } from "../api/runtime";
import {
  calendarInvitesForSubmission,
  type CalendarInviteSummary,
} from "../jobs/calendar/invites";
import type {
  AcceptanceReversalChoice,
  DecisionActor,
} from "../jobs/cascade/decisions";
import { writeAcceptanceReversal } from "../jobs/cascade/decisions";
import { getAuth } from "../lib/auth/auth-middleware";

const eventSubmissionParams = z.object({
  eventId: z.string().min(1),
  submissionId: z.string().min(1),
});

const choiceSchema = z.enum(["cancel", "retain"]);
const reversalBodySchema = z
  .object({
    tasks: choiceSchema.default("cancel"),
    emails: choiceSchema.default("cancel"),
    calendar: choiceSchema.default("cancel"),
    outcome: z.enum(["withdrawn", "rejected"]).default("withdrawn"),
  })
  .strict();

const submissionSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  decided_at: z.number().int().nullable(),
  decided_by_person_id: z.string().nullable(),
});

const agendaSchema = z.object({
  id: z.string(),
  starts_at: z.number().int(),
  duration_min: z.number().int(),
  room: z.string(),
  building: z.string().nullable(),
});

const taskSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.enum(["open", "done"]),
  due_at: z.number().int(),
  completed_at: z.number().int().nullable(),
  cancelled_at: z.number().int().nullable(),
});

const scheduledEmailSchema = z.object({
  id: z.string(),
  template_key: z.string(),
  subject: z.string(),
  status: z.enum(["queued", "sent", "suppressed", "failed"]),
  scheduled_for: z.number().int().nullable(),
  suppressed_reason: z.string().nullable(),
});

const calendarInviteSchema = z.object({
  id: z.string(),
  person_id: z.string(),
  email: z.string(),
  uid: z.string(),
  sequence: z.number().int(),
  last_method: z.enum(["REQUEST", "CANCEL"]),
  status: z.string(),
});

const previewSchema = z.object({
  submission: submissionSchema,
  agenda: agendaSchema.nullable(),
  tasks: z.array(taskSchema),
  scheduled_emails: z.array(scheduledEmailSchema),
  calendar_invites: z.array(calendarInviteSchema),
});

const reversalResultSchema = z.object({
  id: z.string(),
  outcome: z.enum(["succeeded", "failed"]),
  resulting_status: z.enum(["withdrawn", "rejected"]).nullable(),
  tasks_cancelled: z.number().int().min(0),
  emails_cancelled: z.number().int().min(0),
  calendar_cancelled: z.number().int().min(0),
  error: z.string().optional(),
});

const previewResponseSchema = z.object({ data: previewSchema });
const reversalResponseSchema = z.object({
  data: reversalResultSchema,
  preview: previewSchema,
});

type SubmissionPreview = z.infer<typeof previewSchema>;

function smokeHarnessRequested(context: Parameters<typeof getAuth>[0]): boolean {
  return context.req.header("x-marquee-smoke-harness") === "1" && getAuth(context)?.kind === "token";
}

async function actorFor(context: Context<ApiEnv>): Promise<DecisionActor> {
  const auth = getAuth(context);
  if (!auth) throw ApiError.unauthenticated();
  const requestId = context.get("requestId") ?? null;
  if (auth.kind === "session") return { kind: "user", personId: auth.personId, requestId };
  const token = await context.env.DB
    .prepare("SELECT created_by FROM api_tokens WHERE id = ?")
    .bind(auth.tokenId)
    .first<{ created_by: string }>();
  if (!token?.created_by) throw ApiError.unauthenticated("the token issuer is no longer available");
  return { kind: "api_token", personId: token.created_by, requestId };
}

async function readPreview(
  db: D1Database,
  eventId: string,
  submissionId: string,
): Promise<SubmissionPreview | null> {
  const submission = await db
    .prepare(
      `SELECT id, title, status, decided_at, decided_by_person_id
       FROM submissions
       WHERE event_id = ? AND id = ?`,
    )
    .bind(eventId, submissionId)
    .first<SubmissionPreview["submission"]>();
  if (!submission) return null;

  const [agenda, tasks, emails, invites] = await Promise.all([
    db
      .prepare(
        `SELECT agenda.id, agenda.starts_at, agenda.duration_min,
                room.name AS room, building.name AS building
         FROM agenda_items agenda
         JOIN rooms room ON room.id = agenda.room_id
         LEFT JOIN buildings building ON building.id = room.building_id
         WHERE agenda.event_id = ? AND agenda.submission_id = ? AND agenda.kind = 'session'`,
      )
      .bind(eventId, submissionId)
      .first<NonNullable<SubmissionPreview["agenda"]>>(),
    db
      .prepare(
        `SELECT id, title, status, due_at, completed_at, cancelled_at
         FROM speaker_tasks
         WHERE event_id = ? AND submission_id = ?
         ORDER BY due_at ASC, id ASC`,
      )
      .bind(eventId, submissionId)
      .all<SubmissionPreview["tasks"][number]>(),
    db
      .prepare(
        `SELECT id, template_key, subject, status, scheduled_for, suppressed_reason
         FROM outbox
         WHERE event_id = ? AND entity_id = ? AND ics_body IS NULL
         ORDER BY created_at ASC, id ASC`,
      )
      .bind(eventId, submissionId)
      .all<SubmissionPreview["scheduled_emails"][number]>(),
    calendarInvitesForSubmission(db, eventId, submissionId),
  ]);

  return {
    submission,
    agenda: agenda ?? null,
    tasks: tasks.results,
    scheduled_emails: emails.results,
    calendar_invites: invites as CalendarInviteSummary[],
  };
}

const getReversalPreview = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/events/{eventId}/submissions/{submissionId}/reversal",
    operationId: "previewSubmissionAcceptanceReversal",
    summary: "Preview the acceptance reversal cascade",
    description: "Enumerate the portal tasks, scheduled emails, and calendar invites owned by an accepted submission.",
    tags: ["Submissions"],
    request: { params: eventSubmissionParams },
    policy: {
      auth: { kind: "grants", grants: ["program:read"] },
      rateLimit: { bucket: "read" },
      concurrency: "none",
    },
    responses: {
      200: jsonResponse(previewResponseSchema, "The row-level reversal preview."),
      ...errorResponses([401, 403, 404, 429, 500]),
    },
  },
  async (context) => {
    const { eventId, submissionId } = context.req.valid("param");
    const preview = await readPreview(context.env.DB, eventId, submissionId);
    if (!preview) throw ApiError.notFound("submission not found");
    return context.json({ data: preview }, 200);
  },
);

const reverseAcceptance = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/events/{eventId}/submissions/{submissionId}/reversal",
    operationId: "reverseSubmissionAcceptance",
    summary: "Reverse an accepted submission and selected cascades",
    description: "Apply cancel or retain choices for portal tasks, scheduled emails, and calendar invites with row-level effects.",
    tags: ["Submissions"],
    request: {
      params: eventSubmissionParams,
      body: { content: { "application/json": { schema: reversalBodySchema } } },
    },
    policy: {
      auth: { kind: "grants", grants: ["program:write"] },
      rateLimit: { bucket: "write" },
      concurrency: "none",
    },
    responses: {
      200: jsonResponse(reversalResponseSchema, "The reversal effects and post-mutation row preview."),
      ...errorResponses([400, 401, 403, 404, 422, 429, 500]),
    },
  },
  async (context) => {
    const { eventId, submissionId } = context.req.valid("param");
    const body = context.req.valid("json");
    const result = await writeAcceptanceReversal({
      cache: context.env.CACHE,
      db: context.env.DB,
      eventId,
      submissionId,
      actor: await actorFor(context),
      queue: context.env.MAIL_QUEUE,
      tasks: body.tasks as AcceptanceReversalChoice,
      emails: body.emails as AcceptanceReversalChoice,
      calendar: body.calendar as AcceptanceReversalChoice,
      outcome: body.outcome,
      origin: new URL(context.req.url).origin,
      smokeHarness: smokeHarnessRequested(context),
    });
    if (result.outcome === "failed") {
      if (result.error === "submission not found") throw ApiError.notFound("submission not found");
      throw ApiError.unprocessable(result.error ?? "acceptance reversal could not be applied");
    }
    const preview = await readPreview(context.env.DB, eventId, submissionId);
    if (!preview) throw new Error("reversal completed without a submission preview");
    return context.json({
      data: {
        id: result.id,
        outcome: result.outcome,
        resulting_status: result.resultingStatus,
        tasks_cancelled: result.tasksCancelled,
        emails_cancelled: result.emailsCancelled,
        calendar_cancelled: result.calendarCancelled,
        ...(result.error ? { error: result.error } : {}),
      },
      preview,
    }, 200);
  },
);

export const apiRoutes = [getReversalPreview, reverseAcceptance];
