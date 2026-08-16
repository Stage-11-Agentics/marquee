import { z } from "@hono/zod-openapi";

import { ApiError } from "../api/errors";
import { defineApiRoute, errorResponses, jsonResponse } from "../api/route";
import type { ApiEnv } from "../api/runtime";
import { getAuth } from "../lib/auth/auth-middleware";
import { auditStatement } from "../lib/audit";

const params = z.object({ eventId: z.string().min(1), submissionId: z.string().min(1) });
const routingInput = z.object({
  track_ids: z.array(z.string().min(1)).max(50),
  primary_track_id: z.string().min(1).nullable(),
  tag_ids: z.array(z.string().min(1)).max(100),
  level_id: z.string().min(1).nullable(),
});
const routingProjection = z.object({
  submission_id: z.string(),
  track_ids: z.array(z.string()),
  primary_track_id: z.string().nullable(),
  tag_ids: z.array(z.string()),
  level_id: z.string().nullable(),
  applied_rule_id: z.string().nullable(),
});

type TaxonomyRow = { id: string; deleted_at: number | null };

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value) => right.includes(value));
}

async function ownedTaxonomy(
  db: D1Database,
  table: "tracks" | "tags" | "levels",
  eventId: string,
  ids: readonly string[],
): Promise<TaxonomyRow[]> {
  if (ids.length === 0) return [];
  const rows: TaxonomyRow[] = [];
  for (let offset = 0; offset < ids.length; offset += 80) {
    const chunk = ids.slice(offset, offset + 80);
    rows.push(...(await db.prepare(
      `SELECT id, deleted_at FROM ${table} WHERE event_id = ? AND id IN (${chunk.map(() => "?").join(",")})`,
    ).bind(eventId, ...chunk).all<TaxonomyRow>()).results);
  }
  return rows;
}

async function actorFor(context: import("hono").Context<ApiEnv>): Promise<{ kind: "user" | "api_token"; personId: string | null; requestId: string | null }> {
  const auth = getAuth(context);
  if (!auth) throw ApiError.unauthenticated();
  const requestId = context.get("requestId") ?? null;
  if (auth.kind === "session") return { kind: "user", personId: auth.personId, requestId };
  const row = await context.env.DB.prepare("SELECT created_by FROM api_tokens WHERE id = ?").bind(auth.tokenId).first<{ created_by: string }>();
  return { kind: "api_token", personId: row?.created_by ?? null, requestId };
}

const updateRouting = defineApiRoute({
  method: "put",
  path: "/api/v1/events/{eventId}/submissions/{submissionId}/routing",
  operationId: "updateSubmissionRouting",
  summary: "Replace a submission routing projection",
  description: "Organizer routing edits are explicit and never re-run public arrival rules.",
  tags: ["Submissions"],
  request: { params, body: { content: { "application/json": { schema: routingInput } } } },
  policy: { auth: { kind: "grants", grants: ["program:write"] }, rateLimit: { bucket: "write" }, concurrency: "none" },
  responses: { 200: jsonResponse(z.object({ data: routingProjection }), "Submission routing"), ...errorResponses([400, 401, 403, 404, 422, 429, 500]) },
}, async (context) => {
  const { eventId, submissionId } = context.req.valid("param");
  const body = context.req.valid("json");
  const submission = await context.env.DB.prepare(
    "SELECT id, primary_track_id, level_id, applied_rule_id FROM submissions WHERE id = ? AND event_id = ?",
  ).bind(submissionId, eventId).first<{ id: string; primary_track_id: string | null; level_id: string | null; applied_rule_id: string | null }>();
  if (!submission) throw ApiError.notFound("submission not found");

  const currentTracks = (await context.env.DB.prepare(
    "SELECT track_id AS id FROM submission_tracks WHERE submission_id = ? ORDER BY is_primary DESC, id",
  ).bind(submissionId).all<{ id: string }>()).results.map((row) => row.id);
  const currentTags = (await context.env.DB.prepare(
    "SELECT tag_id AS id FROM submission_tags WHERE submission_id = ? ORDER BY tag_id",
  ).bind(submissionId).all<{ id: string }>()).results.map((row) => row.id);
  const trackIds = unique(body.track_ids);
  const tagIds = unique(body.tag_ids);
  if ((body.primary_track_id === null) !== (trackIds.length === 0)) {
    throw ApiError.unprocessable("primary_track_id must be included in track_ids.", "primary_track_id");
  }
  if (body.primary_track_id !== null && !trackIds.includes(body.primary_track_id)) {
    throw ApiError.unprocessable("primary_track_id must be included in track_ids.", "primary_track_id");
  }

  const [tracks, tags, levels] = await Promise.all([
    ownedTaxonomy(context.env.DB, "tracks", eventId, trackIds),
    ownedTaxonomy(context.env.DB, "tags", eventId, tagIds),
    body.level_id === null ? Promise.resolve([] as TaxonomyRow[]) : ownedTaxonomy(context.env.DB, "levels", eventId, [body.level_id]),
  ]);
  if (tracks.length !== trackIds.length) throw ApiError.unprocessable("every track must belong to this conference.", "track_ids");
  if (tags.length !== tagIds.length) throw ApiError.unprocessable("every tag must belong to this conference.", "tag_ids");
  if (body.level_id !== null && levels.length !== 1) throw ApiError.unprocessable("level must belong to this conference.", "level_id");

  const currentTrackSet = new Set(currentTracks);
  const currentTagSet = new Set(currentTags);
  if (tracks.some((row) => row.deleted_at !== null && !currentTrackSet.has(row.id))) {
    throw ApiError.unprocessable("deleted routing options can only be retained when the submission already uses them.", "track_ids");
  }
  if (tags.some((row) => row.deleted_at !== null && !currentTagSet.has(row.id))) {
    throw ApiError.unprocessable("deleted routing options can only be retained when the submission already uses them.", "tag_ids");
  }
  if (body.level_id !== null && levels[0]?.deleted_at !== null && submission.level_id !== body.level_id) {
    throw ApiError.unprocessable("deleted routing options can only be retained when the submission already uses them.", "level_id");
  }
  const before = { track_ids: currentTracks, primary_track_id: submission.primary_track_id, tag_ids: currentTags, level_id: submission.level_id, applied_rule_id: submission.applied_rule_id };
  const after = { track_ids: trackIds, primary_track_id: body.primary_track_id, tag_ids: tagIds, level_id: body.level_id, applied_rule_id: submission.applied_rule_id };
  if (sameSet(currentTracks, trackIds) && currentTracks[0] === body.primary_track_id && sameSet(currentTags, tagIds) && submission.level_id === body.level_id) {
    return context.json({ data: { submission_id: submissionId, ...after } }, 200);
  }

  const actor = await actorFor(context);
  const now = Date.now();
  const statements: D1PreparedStatement[] = [
    context.env.DB.prepare("DELETE FROM submission_tracks WHERE submission_id = ?").bind(submissionId),
    ...trackIds.map((trackId, index) => context.env.DB.prepare(
      `INSERT INTO submission_tracks (id, submission_id, track_id, is_primary, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(crypto.randomUUID(), submissionId, trackId, index === 0 ? 1 : 0, now, now)),
    context.env.DB.prepare("DELETE FROM submission_tags WHERE submission_id = ?").bind(submissionId),
    ...tagIds.map((tagId) => context.env.DB.prepare(
      `INSERT INTO submission_tags (id, submission_id, tag_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    ).bind(crypto.randomUUID(), submissionId, tagId, now, now)),
    context.env.DB.prepare("UPDATE submissions SET primary_track_id = ?, level_id = ?, updated_at = ? WHERE id = ? AND event_id = ?").bind(body.primary_track_id, body.level_id, now, submissionId, eventId),
    auditStatement(context.env.DB, {
      eventId,
      actorKind: actor.kind,
      actorPersonId: actor.personId,
      action: "submission.routing_updated",
      entityType: "submission",
      entityId: submissionId,
      before,
      after,
      now,
      requestId: actor.requestId,
    }),
  ];
  await context.env.DB.batch(statements);
  return context.json({ data: { submission_id: submissionId, ...after } }, 200);
});

export const apiRoutes = [updateRouting];
