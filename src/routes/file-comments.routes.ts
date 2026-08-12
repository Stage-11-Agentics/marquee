import { z } from "@hono/zod-openapi";

import { ApiError } from "../api/errors";
import { defineApiRoute, errorResponses, jsonResponse } from "../api/route";
import type { ApiEnv } from "../api/runtime";
import { getAuth } from "../lib/auth/auth-middleware";
import type { SessionAuth } from "../lib/auth/scope-resolution";
import { addFileComment, fileTaskForSpeaker, listFileComments } from "../lib/file-comments";

const taskParams = z.object({ taskId: z.string().min(1) });
const eventTaskParams = z.object({ eventId: z.string().min(1), taskId: z.string().min(1) });
const commentBody = z.object({
  body: z.string().trim().min(1).max(10_000),
  attachment_id: z.string().min(1).nullable().optional(),
}).strict();

const commentSchema = z.object({
  id: z.string(),
  event_id: z.string(),
  owner_type: z.literal("task_upload"),
  owner_id: z.string(),
  attachment_id: z.string().nullable(),
  attachment_filename: z.string().nullable(),
  attachment_version: z.number().int().positive().nullable(),
  author_person_id: z.string(),
  author_name: z.string(),
  author_role: z.string(),
  body: z.string(),
  created_at: z.number().int(),
}).openapi("FileComment");

const commentsResponse = z.object({ comments: z.array(commentSchema) }).openapi("FileComments");
const commentResponse = z.object({ comment: commentSchema }).openapi("FileCommentResponse");

function speakerSession(context: import("hono").Context<ApiEnv>): SessionAuth {
  const auth = getAuth(context);
  if (auth?.kind !== "session") throw ApiError.forbidden("the speaker portal requires a browser session");
  return auth;
}

async function actorPersonId(context: import("hono").Context<ApiEnv>): Promise<string> {
  const auth = getAuth(context);
  if (!auth) throw ApiError.unauthenticated();
  if (auth.kind === "session") return auth.personId;
  const issuer = await context.env.DB
    .prepare("SELECT created_by FROM api_tokens WHERE id = ?")
    .bind(auth.tokenId)
    .first<{ created_by: string }>();
  if (!issuer?.created_by) throw ApiError.unauthenticated("the token issuer is no longer available");
  return issuer.created_by;
}

const getSpeakerFileComments = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/me/tasks/{taskId}/comments",
    operationId: "getSpeakerFileComments",
    summary: "Read comments on a speaker deliverable",
    description: "Returns the event-scoped comment thread anchored to the speaker's deliverable task slot.",
    tags: ["Speaker portal"],
    request: { params: taskParams },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "read" }, concurrency: "none" },
    responses: { 200: jsonResponse(commentsResponse, "Deliverable comments"), ...errorResponses([401, 403, 404, 429, 500]) },
  },
  async (context) => {
    const auth = speakerSession(context);
    const task = await fileTaskForSpeaker(context.env.DB, context.req.valid("param").taskId, auth.orgId, auth.personId);
    return context.json({ comments: await listFileComments(context.env.DB, task.event_id, task.id) }, 200);
  },
);

const addSpeakerFileComment = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/me/tasks/{taskId}/comments",
    operationId: "addSpeakerFileComment",
    summary: "Add a speaker deliverable comment",
    description: "Adds a comment to the deliverable task slot, optionally tagging the ready version visible to the speaker.",
    tags: ["Speaker portal"],
    request: { params: taskParams, body: { content: { "application/json": { schema: commentBody } } } },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 200: jsonResponse(commentResponse, "Added deliverable comment"), ...errorResponses([401, 403, 404, 422, 429, 500]) },
  },
  async (context) => {
    const auth = speakerSession(context);
    const task = await fileTaskForSpeaker(context.env.DB, context.req.valid("param").taskId, auth.orgId, auth.personId);
    const body = context.req.valid("json");
    return context.json({
      comment: await addFileComment(context.env.DB, {
        eventId: task.event_id,
        taskId: task.id,
        authorPersonId: auth.personId,
        body: body.body,
        attachmentId: body.attachment_id,
      }),
    }, 200);
  },
);

const getOrganizerFileComments = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/events/{eventId}/files/{taskId}/comments",
    operationId: "getOrganizerFileComments",
    summary: "Read comments on a library deliverable",
    description: "Returns comments anchored to a deliverable slot in the organizer Files library.",
    tags: ["Files"],
    request: { params: eventTaskParams },
    policy: { auth: { kind: "grants", grants: ["program:read"] }, rateLimit: { bucket: "read" }, concurrency: "none" },
    responses: { 200: jsonResponse(commentsResponse, "Deliverable comments"), ...errorResponses([401, 403, 404, 429, 500]) },
  },
  async (context) => {
    const { eventId, taskId } = context.req.valid("param");
    return context.json({ comments: await listFileComments(context.env.DB, eventId, taskId) }, 200);
  },
);

const addOrganizerFileComment = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/events/{eventId}/files/{taskId}/comments",
    operationId: "addOrganizerFileComment",
    summary: "Reply to a deliverable comment thread",
    description: "Adds an organizer reply to the slot-anchored Files library thread, optionally tagging a ready version.",
    tags: ["Files"],
    request: { params: eventTaskParams, body: { content: { "application/json": { schema: commentBody } } } },
    policy: { auth: { kind: "grants", grants: ["program:write"] }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 200: jsonResponse(commentResponse, "Added organizer comment"), ...errorResponses([401, 403, 404, 422, 429, 500]) },
  },
  async (context) => {
    const { eventId, taskId } = context.req.valid("param");
    const body = context.req.valid("json");
    return context.json({
      comment: await addFileComment(context.env.DB, {
        eventId,
        taskId,
        authorPersonId: await actorPersonId(context),
        body: body.body,
        attachmentId: body.attachment_id,
      }),
    }, 200);
  },
);

export const apiRoutes = [
  getSpeakerFileComments,
  addSpeakerFileComment,
  getOrganizerFileComments,
  addOrganizerFileComment,
];
