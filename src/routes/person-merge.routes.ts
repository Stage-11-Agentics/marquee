import { z } from "@hono/zod-openapi";

import { ApiError } from "../api/errors";
import { defineApiRoute, errorResponses, jsonResponse } from "../api/route";
import { requireOrgAccess } from "../lib/auth/org-access";
import {
  executePersonMerge,
  PersonMergeError,
  previewPersonMerge,
  undoPersonMerge,
  type MergeInput,
  type PersonMergeActor,
} from "../lib/person-merge";

const mergeParams = z.object({ mergeId: z.string().min(1) });
const mergeBody = z.object({
  person_ids: z.array(z.string().trim().min(1)).length(2),
  survivor_id: z.string().trim().min(1).optional(),
}).openapi("PersonMergeInput");
const executeBody = mergeBody.extend({ idempotency_key: z.string().uuid().optional() }).openapi("PersonMergeExecuteInput");
const previewResponse = z.object({ preview: z.unknown() }).openapi("PersonMergePreviewResponse");
const executeResponse = z.object({
  merge_id: z.string(),
  status: z.enum(["clean", "undone", "undo_blocked"]),
  retired_person_id: z.string(),
  survivor_person_id: z.string(),
  summary: z.object({
    moved: z.number().int().nonnegative(),
    deduped: z.number().int().nonnegative(),
    dropped: z.number().int().nonnegative(),
    aliases_created: z.number().int().nonnegative(),
    aliases_repointed: z.number().int().nonnegative(),
    collisions: z.number().int().nonnegative(),
    references: z.record(z.string(), z.number().int().nonnegative()),
  }),
  continuity: z.string(),
  can_undo: z.boolean(),
}).openapi("PersonMergeReceipt");
const undoResponse = z.object({
  merge_id: z.string(),
  status: z.enum(["undone", "undo_blocked"]),
  restored: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  skipped_rows: z.array(z.object({ table: z.string(), primary_key: z.string(), reason: z.string() })),
  reason: z.string().optional(),
}).openapi("PersonMergeUndo");
const mergeErrors = errorResponses([400, 401, 403, 404, 409, 422, 429, 500]);

function mergeInput(body: { person_ids: string[]; survivor_id?: string }): MergeInput {
  return {
    firstPersonId: body.person_ids[0]!,
    secondPersonId: body.person_ids[1]!,
    survivorPersonId: body.survivor_id,
  };
}

function actor(access: ReturnType<typeof requireOrgAccess>, requestId: string | undefined): PersonMergeActor {
  return {
    actorKind: access.kind === "session" ? "user" : "api_token",
    actorPersonId: access.personId,
    requestId: requestId ?? null,
  };
}

function asApiError(error: unknown): never {
  if (!(error instanceof PersonMergeError)) throw error;
  if (error.code === "invalid_merge") throw ApiError.unprocessable(error.message, undefined, error.details);
  if (error.code === "alias_conflict" || error.code === "already_merged" || error.code === "undo_blocked" || error.code === "merge_import_blocked") {
    throw ApiError.conflict(error.message, error.details);
  }
  throw ApiError.conflict(error.message, error.details);
}

const previewMerge = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/org/people/merge/preview",
    operationId: "previewOrgPersonMerge",
    summary: "Preview merging two organization people",
    description: "Shows the survivor projection, identity continuity, collision rows, and movement counts before any write.",
    tags: ["People"],
    request: { body: { content: { "application/json": { schema: mergeBody } } } },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "read" }, concurrency: "none" },
    responses: { 200: jsonResponse(previewResponse, "Merge preview"), ...mergeErrors },
  },
  async (context) => {
    const access = requireOrgAccess(context, true);
    const body = context.req.valid("json");
    try {
      const preview = await previewPersonMerge(context.env.DB, access.orgId, mergeInput(body));
      return context.json({ preview }, 200);
    } catch (error) {
      return asApiError(error);
    }
  },
);

const executeMerge = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/org/people/merge",
    operationId: "executeOrgPersonMerge",
    summary: "Merge two organization people",
    description: "Executes one atomic people merge and returns its durable receipt and Undo boundary.",
    tags: ["People"],
    request: { body: { content: { "application/json": { schema: executeBody } } } },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 200: jsonResponse(executeResponse, "Merge receipt"), ...mergeErrors },
  },
  async (context) => {
    const access = requireOrgAccess(context, true);
    const body = context.req.valid("json");
    const input = mergeInput(body);
    if (access.personId && (access.personId === input.firstPersonId || access.personId === input.secondPersonId)) {
      throw ApiError.conflict("The acting seat cannot be retired by its own merge");
    }
    try {
      const result = await executePersonMerge(
        context.env.DB,
        access.orgId,
        { ...input, idempotencyKey: body.idempotency_key ?? context.req.header("Idempotency-Key") ?? crypto.randomUUID() },
        actor(access, context.get("requestId")),
      );
      return context.json(result, 200);
    } catch (error) {
      return asApiError(error);
    }
  },
);

const undoMerge = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/org/people/merge/{mergeId}/undo",
    operationId: "undoOrgPersonMerge",
    summary: "Undo a people merge",
    description: "CAS-restores a merge receipt, preserving later human edits and reporting skipped rows.",
    tags: ["People"],
    request: { params: mergeParams },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 200: jsonResponse(undoResponse, "Merge undo result"), ...mergeErrors },
  },
  async (context) => {
    const access = requireOrgAccess(context, true);
    const { mergeId } = context.req.valid("param");
    try {
      const result = await undoPersonMerge(context.env.DB, access.orgId, mergeId, actor(access, context.get("requestId")));
      return context.json(result, 200);
    } catch (error) {
      return asApiError(error);
    }
  },
);

export const apiRoutes = [previewMerge, executeMerge, undoMerge];
