import { z } from "@hono/zod-openapi";

import { ApiError } from "../api/errors";
import { defineApiRoute, errorResponses, jsonResponse } from "../api/route";
import type { Principal } from "../api/runtime";
import {
  authorizeReviewerScope,
  reviewerPersonIdForEvent,
} from "../lib/reviewer-scope";

const eventParams = z.object({ eventId: z.string().min(1) });
const roundParams = eventParams.extend({ roundId: z.string().min(1) });
const reviewerSubmissionParams = roundParams.extend({ submissionId: z.string().min(1) });
const recommendation = z.enum(["approve", "maybe", "deny"]);
const exportQuery = z.object({ format: z.literal("csv").default("csv") });

const evaluationInput = z.object({
  comment: z.string().max(20_000).default(""),
  criteria_scores: z.record(z.string(), z.number().min(0)).nullable().optional(),
  recommendation,
  score: z.number().nullable().optional(),
});

const ok = jsonResponse(z.unknown(), "Reviewer response");
const errors = errorResponses([400, 401, 403, 404, 409, 422, 500]);

interface RoundRow {
  anonymized: 0 | 1;
  closes_at: number | null;
  id: string;
  mode: "scorecard" | "comparison";
  name: string;
  opens_at: number | null;
  plan_name: string;
  plan_id: string;
  position: number;
  target_reviews_per_submission: number;
}

interface QueueRow {
  abstract: string | null;
  format: string | null;
  id: string;
  title: string;
  tracks: string;
}

interface DetailRow extends QueueRow {
  answers: string;
  fields: string;
  files: string;
  format_id: string | null;
  kind: "abstract" | "session";
  status: string;
  submitted_at: number | null;
  vendor_affiliation: string;
}

interface ReviewRow {
  comment: string;
  created_at: number;
  criteria_scores: string | null;
  recommendation: "approve" | "maybe" | "deny" | null;
  reviewer_person_id: string;
  score: number | null;
  updated_at: number;
}

interface IdentityRow {
  bio: string | null;
  company: string | null;
  email: string;
  headshot_attachment_id: string | null;
  id: string;
  name: string;
  speakers: string;
}

interface ScopeRow {
  color: string;
  id: string;
  name: string;
}

const proposalStatus = {
  approve: "accepted",
  maybe: "waitlisted",
  deny: "rejected",
} as const;

function proposalFor(value: "approve" | "maybe" | "deny") {
  return { decision: value, resulting_status: proposalStatus[value] };
}

function parseJsonArray(value: string | null | undefined): unknown[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function roundForEvent(db: D1Database, eventId: string, roundId: string): Promise<RoundRow> {
  const round = await db.prepare(`
    SELECT round.id, round.plan_id, plan.name AS plan_name, round.position, round.name, round.mode,
      round.anonymized, round.target_reviews_per_submission, round.opens_at, round.closes_at
    FROM evaluation_rounds round
    JOIN evaluation_plans plan ON plan.id = round.plan_id
    WHERE round.id = ? AND plan.event_id = ?
  `).bind(roundId, eventId).first<RoundRow>();
  if (!round) throw ApiError.notFound("evaluation round not found");
  return round;
}

async function assignedSubmissionIds(
  db: D1Database,
  eventId: string,
  roundId: string,
  personId: string,
): Promise<string[]> {
  const result = await db.prepare(`
    SELECT DISTINCT assignment.submission_id
    FROM round_assignments assignment
    JOIN submissions submission ON submission.id = assignment.submission_id
    LEFT JOIN committee_members member
      ON member.committee_id = assignment.committee_id AND member.person_id = ?
    LEFT JOIN committees committee ON committee.id = assignment.committee_id
    WHERE assignment.round_id = ?
      AND submission.event_id = ?
      AND assignment.status IN ('assigned', 'complete')
      AND (assignment.reviewer_person_id = ? OR (member.person_id IS NOT NULL AND committee.event_id = ?))
      AND NOT EXISTS (
        SELECT 1
        FROM evaluations evaluation
        WHERE evaluation.round_id = assignment.round_id
          AND evaluation.submission_id = assignment.submission_id
          AND evaluation.reviewer_person_id = ?
      )
    ORDER BY submission.updated_at DESC, submission.id
  `).bind(personId, roundId, eventId, personId, eventId, personId).all<{ submission_id: string }>();
  return result.results.map((row) => row.submission_id);
}

/**
 * The queue is a materialized view of the shared authorization helper. The
 * candidate query is only an efficient pre-filter; every returned ID still
 * passes authorizeReviewerScope before any evaluator-visible fields load.
 */
async function reviewerQueue(
  db: D1Database,
  principal: Principal,
  eventId: string,
  roundId: string,
): Promise<string[]> {
  const personId = reviewerPersonIdForEvent(principal, eventId);
  if (personId === null) {
    await authorizeReviewerScope({ db, principal, eventId, roundId, submissionId: "unknown", operation: "queue" });
    return [];
  }
  const candidates = await assignedSubmissionIds(db, eventId, roundId, personId);
  const allowed: string[] = [];
  for (const submissionId of candidates) {
    try {
      await authorizeReviewerScope({ db, principal, eventId, roundId, submissionId, operation: "queue" });
      allowed.push(submissionId);
    } catch (error) {
      // A direct assignment without an intersecting carried track is not a
      // queue item. It must not prevent other authorized cards from loading.
      if (error instanceof ApiError && error.status === 403) continue;
      throw error;
    }
  }
  return allowed;
}

async function reviewerTrackScopes(db: D1Database, eventId: string, personId: string): Promise<ScopeRow[]> {
  const result = await db.prepare(`
    SELECT track.id, track.name, track.color
    FROM reviewer_track_scopes scope
    JOIN tracks track ON track.id = scope.track_id AND track.event_id = scope.event_id
    WHERE scope.event_id = ? AND scope.person_id = ?
    ORDER BY track.position, track.id
  `).bind(eventId, personId).all<ScopeRow>();
  return result.results;
}

async function activeRoundForEvent(db: D1Database, eventId: string): Promise<RoundRow> {
  const round = await db.prepare(`
    SELECT round.id, round.plan_id, plan.name AS plan_name, round.position, round.name, round.mode,
      round.anonymized, round.target_reviews_per_submission, round.opens_at, round.closes_at
    FROM evaluation_rounds round
    JOIN evaluation_plans plan ON plan.id = round.plan_id
    WHERE plan.event_id = ? AND plan.status = 'open'
    ORDER BY plan.updated_at DESC, round.position, round.id
    LIMIT 1
  `).bind(eventId).first<RoundRow>();
  if (!round) throw ApiError.notFound("review round not found");
  return round;
}

async function queueRow(db: D1Database, eventId: string, submissionId: string): Promise<QueueRow | null> {
  const row = await db.prepare(`
    SELECT submission.id, submission.title, submission.abstract, format.name AS format,
      COALESCE((
        SELECT json_group_array(json_object(
          'id', ordered.id, 'name', ordered.name, 'color', ordered.color, 'is_primary', ordered.is_primary
        ))
        FROM (
          SELECT carried.id, track.name, track.color, carried.is_primary
          FROM submission_tracks carried
          JOIN tracks track ON track.id = carried.track_id
          WHERE carried.submission_id = submission.id
          ORDER BY carried.is_primary DESC, track.position, track.id
        ) ordered
      ), '[]') AS tracks
    FROM submissions submission
    LEFT JOIN formats format ON format.id = submission.format_id
    WHERE submission.id = ? AND submission.event_id = ?
  `).bind(submissionId, eventId).first<QueueRow>();
  return row ?? null;
}

async function detailRow(db: D1Database, eventId: string, submissionId: string): Promise<DetailRow | null> {
  const row = await db.prepare(`
    SELECT submission.id, submission.kind, submission.title, submission.abstract,
      submission.format_id, submission.status, submission.submitted_at,
      submission.vendor_affiliation, format.name AS format,
      COALESCE((
        SELECT json_group_array(json_object(
          'id', ordered.id, 'name', ordered.name, 'color', ordered.color, 'is_primary', ordered.is_primary
        ))
        FROM (
          SELECT carried.id, track.name, track.color, carried.is_primary
          FROM submission_tracks carried
          JOIN tracks track ON track.id = carried.track_id
          WHERE carried.submission_id = submission.id
          ORDER BY carried.is_primary DESC, track.position, track.id
        ) ordered
      ), '[]') AS tracks,
      COALESCE((
        SELECT json_group_array(json_object(
          'id', field.id, 'key', field.key, 'label', field.label, 'type', field.type,
          'required', field.required, 'value_text', answer.value_text, 'value_json', answer.value_json
        ))
        FROM (
          SELECT field.id, field.key, field.label, field.type, field.required, field.position
          FROM form_fields field
          WHERE field.form_id = submission.form_id
            AND lower(field.key) NOT LIKE '%name%'
            AND lower(field.key) NOT LIKE '%email%'
            AND lower(field.key) NOT LIKE '%company%'
            AND lower(field.key) NOT LIKE '%bio%'
            AND lower(field.key) NOT LIKE '%headshot%'
            AND lower(field.key) NOT LIKE '%speaker%'
            AND lower(field.key) NOT LIKE '%submitter%'
            AND lower(field.key) NOT LIKE '%contact%'
            AND lower(field.key) NOT LIKE '%phone%'
          ORDER BY field.position, field.id
        ) field
        LEFT JOIN submission_answers answer
          ON answer.field_id = field.id AND answer.submission_id = submission.id
      ), '[]') AS fields,
      COALESCE((
        SELECT json_group_array(json_object(
          'id', attachment.id, 'filename', attachment.filename,
          'content_type', attachment.content_type, 'size_bytes', attachment.size_bytes,
          'status', attachment.status
        ))
        FROM attachments attachment
        WHERE attachment.event_id = submission.event_id
          AND attachment.owner_type = 'submission_file'
          AND attachment.owner_id = submission.id
        ORDER BY attachment.created_at, attachment.id
      ), '[]') AS files,
      COALESCE((
        SELECT json_group_array(json_object(
          'field_id', answer.field_id, 'value_text', answer.value_text, 'value_json', answer.value_json
        ))
        FROM submission_answers answer
        WHERE answer.submission_id = submission.id
          AND NOT EXISTS (
            SELECT 1 FROM form_fields hidden_field
            WHERE hidden_field.id = answer.field_id
              AND (
                lower(hidden_field.key) LIKE '%name%'
                OR lower(hidden_field.key) LIKE '%email%'
                OR lower(hidden_field.key) LIKE '%company%'
                OR lower(hidden_field.key) LIKE '%bio%'
                OR lower(hidden_field.key) LIKE '%headshot%'
                OR lower(hidden_field.key) LIKE '%speaker%'
                OR lower(hidden_field.key) LIKE '%submitter%'
                OR lower(hidden_field.key) LIKE '%contact%'
                OR lower(hidden_field.key) LIKE '%phone%'
              )
          )
      ), '[]') AS answers
    FROM submissions submission
    LEFT JOIN formats format ON format.id = submission.format_id
    WHERE submission.id = ? AND submission.event_id = ?
  `).bind(submissionId, eventId).first<DetailRow>();
  return row ?? null;
}

async function reviewForReviewer(
  db: D1Database,
  roundId: string,
  submissionId: string,
  reviewerPersonId: string,
): Promise<ReviewRow | null> {
  const row = await db.prepare(`
    SELECT recommendation, score, criteria_scores, comment, reviewer_person_id, created_at, updated_at
    FROM evaluations
    WHERE round_id = ? AND submission_id = ? AND reviewer_person_id = ?
  `).bind(roundId, submissionId, reviewerPersonId).first<ReviewRow>();
  return row ?? null;
}

async function identityForSubmission(
  db: D1Database,
  eventId: string,
  submissionId: string,
): Promise<IdentityRow | null> {
  const row = await db.prepare(`
    SELECT submitter.id, submitter.name, submitter.email, submitter.company, submitter.bio,
      submitter.headshot_attachment_id,
      COALESCE((
        SELECT json_group_array(json_object(
          'id', speaker.id, 'name', speaker.name, 'email', speaker.email,
          'company', speaker.company, 'bio', speaker.bio,
          'headshot_attachment_id', speaker.headshot_attachment_id
        ))
        FROM participations participation
        JOIN people speaker ON speaker.id = participation.person_id
        WHERE participation.submission_id = submission.id
        ORDER BY participation.position, participation.id
      ), '[]') AS speakers
    FROM submissions submission
    JOIN people submitter ON submitter.id = submission.submitter_person_id
    WHERE submission.id = ? AND submission.event_id = ?
  `).bind(submissionId, eventId).first<IdentityRow>();
  return row ?? null;
}

function reviewPayload(review: ReviewRow | null): Record<string, unknown> | null {
  if (!review) return null;
  const proposal = review.recommendation ? proposalFor(review.recommendation) : null;
  return {
    actor_id: review.reviewer_person_id,
    comment: review.comment,
    created_at: review.created_at,
    criteria_scores: review.criteria_scores ? JSON.parse(review.criteria_scores) : null,
    decision_proposal: proposal,
    recommendation: review.recommendation,
    score: review.score,
    updated_at: review.updated_at,
  };
}

async function reviewerQueuePayload(
  db: D1Database,
  principal: Principal,
  eventId: string,
  round: RoundRow,
): Promise<Record<string, unknown>> {
  const ids = await reviewerQueue(db, principal, eventId, round.id);
  const personId = reviewerPersonIdForEvent(principal, eventId);
  const data: Array<Record<string, unknown>> = [];
  for (const [index, submissionId] of ids.entries()) {
    await authorizeReviewerScope({ db, principal, eventId, roundId: round.id, submissionId, operation: "queue" });
    const row = await queueRow(db, eventId, submissionId);
    if (row) data.push({ ...row, tracks: parseJsonArray(row.tracks), queue_id: row.id, position: index + 1 });
  }
  return {
    current_id: data[0]?.id ?? null,
    current_index: data.length ? 0 : null,
    data,
    plan: { id: round.plan_id, name: round.plan_name },
    position: data.length ? 1 : 0,
    remaining: data.length,
    round: { anonymized: Boolean(round.anonymized), id: round.id, name: round.name },
    scopes: personId ? await reviewerTrackScopes(db, eventId, personId) : [],
    total: data.length,
  };
}

const reviewerQueueRoute = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/events/{eventId}/rounds/{roundId}/queue",
    operationId: "getReviewerQueue",
    summary: "Read the authenticated reviewer’s authorized queue",
    tags: ["Reviewer"],
    request: { params: roundParams },
    policy: { auth: { kind: "grants", grants: ["review:write"] }, rateLimit: { bucket: "read" }, concurrency: "none" },
    responses: { 200: ok, ...errors },
  },
  async (context) => {
    const { eventId, roundId } = context.req.valid("param");
    const round = await roundForEvent(context.env.DB, eventId, roundId);
    const principal = context.get("principal");
    return context.json(await reviewerQueuePayload(context.env.DB, principal, eventId, round), 200);
  },
);

const reviewerContextQueueRoute = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/events/{eventId}/reviewer/queue",
    operationId: "getReviewerQueueContext",
    summary: "Read the current reviewer queue without admin plan access",
    tags: ["Reviewer"],
    request: { params: eventParams },
    policy: { auth: { kind: "grants", grants: ["review:write"] }, rateLimit: { bucket: "read" }, concurrency: "none" },
    responses: { 200: ok, ...errors },
  },
  async (context) => {
    const { eventId } = context.req.valid("param");
    const principal = context.get("principal");
    const round = await activeRoundForEvent(context.env.DB, eventId);
    return context.json(await reviewerQueuePayload(context.env.DB, principal, eventId, round), 200);
  },
);

const reviewerRecordRoute = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/events/{eventId}/rounds/{roundId}/submissions/{submissionId}",
    operationId: "getReviewerSubmission",
    summary: "Read an evaluator-visible submission without blind identity fields",
    tags: ["Reviewer"],
    request: { params: reviewerSubmissionParams },
    policy: { auth: { kind: "grants", grants: ["review:write"] }, rateLimit: { bucket: "read" }, concurrency: "none" },
    responses: { 200: ok, ...errors },
  },
  async (context) => {
    const { eventId, roundId, submissionId } = context.req.valid("param");
    const principal = context.get("principal");
    const authorization = await authorizeReviewerScope({ db: context.env.DB, principal, eventId, roundId, submissionId, operation: "record" });
    const round = await roundForEvent(context.env.DB, eventId, roundId);
    const row = await detailRow(context.env.DB, eventId, submissionId);
    if (!row) throw ApiError.forbidden("reviewer resource is outside your authorized tracks");
    const review = await reviewForReviewer(context.env.DB, roundId, submissionId, authorization.personId);
    const identity = round.anonymized ? null : await identityForSubmission(context.env.DB, eventId, submissionId);
    const reviewData = reviewPayload(review);
    return context.json({
      abstract: row.abstract,
      answers: parseJsonArray(row.answers),
      blind_mode: Boolean(round.anonymized),
      decision_proposal: reviewData?.decision_proposal ?? null,
      fields: parseJsonArray(row.fields),
      files: parseJsonArray(row.files),
      format: row.format,
      format_id: row.format_id,
      id: row.id,
      identity,
      kind: row.kind,
      review: reviewData,
      status: row.status,
      submitted_at: row.submitted_at,
      title: row.title,
      tracks: parseJsonArray(row.tracks),
      vendor_affiliation: row.vendor_affiliation,
    }, 200);
  },
);

const reviewerFilesRoute = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/events/{eventId}/rounds/{roundId}/submissions/{submissionId}/files",
    operationId: "getReviewerSubmissionFiles",
    summary: "Read authorized reviewer file metadata",
    tags: ["Reviewer"],
    request: { params: reviewerSubmissionParams },
    policy: { auth: { kind: "grants", grants: ["review:write"] }, rateLimit: { bucket: "read" }, concurrency: "none" },
    responses: { 200: ok, ...errors },
  },
  async (context) => {
    const { eventId, roundId, submissionId } = context.req.valid("param");
    const principal = context.get("principal");
    await authorizeReviewerScope({ db: context.env.DB, principal, eventId, roundId, submissionId, operation: "file" });
    const files = await context.env.DB.prepare(`
      SELECT id, filename, content_type, size_bytes, status, created_at
      FROM attachments
      WHERE event_id = ? AND owner_type = 'submission_file' AND owner_id = ?
      ORDER BY created_at, id
    `).bind(eventId, submissionId).all<Record<string, string | number>>();
    return context.json({ data: files.results }, 200);
  },
);

const reviewerExportRoute = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/events/{eventId}/rounds/{roundId}/export",
    operationId: "exportReviewerQueue",
    summary: "Export the authorized blind reviewer queue",
    tags: ["Reviewer"],
    request: { params: roundParams, query: exportQuery },
    policy: { auth: { kind: "grants", grants: ["review:write"] }, rateLimit: { bucket: "read" }, concurrency: "none" },
    responses: { 200: { content: { "text/csv": { schema: z.string() } }, description: "Authorized reviewer CSV" }, ...errors },
  },
  async (context) => {
    const { eventId, roundId } = context.req.valid("param");
    context.req.valid("query");
    const principal = context.get("principal");
    const ids = await reviewerQueue(context.env.DB, principal, eventId, roundId);
    const lines = ["submission_id,title,abstract,format,tracks"];
    for (const submissionId of ids) {
      await authorizeReviewerScope({ db: context.env.DB, principal, eventId, roundId, submissionId, operation: "export" });
      const row = await queueRow(context.env.DB, eventId, submissionId);
      if (row) {
        const tracks = parseJsonArray(row.tracks)
          .map((track) => (track as { name?: string }).name ?? "")
          .join(" | ");
        lines.push([row.id, row.title, row.abstract ?? "", row.format ?? "", tracks].map(csv).join(","));
      }
    }
    return new Response(`${lines.join("\n")}\n`, {
      headers: {
        "Content-Disposition": "attachment; filename=review-queue.csv",
        "Content-Type": "text/csv; charset=utf-8",
      },
    });
  },
);

function csv(value: string): string {
  return `"${value.replaceAll('"', '""').replaceAll("\n", " ").replaceAll("\r", " ")}"`;
}

const writeEvaluationRoute = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/events/{eventId}/rounds/{roundId}/submissions/{submissionId}/evaluations",
    operationId: "writeReviewerEvaluation",
    summary: "Save an authorized reviewer recommendation",
    tags: ["Reviewer"],
    request: { params: reviewerSubmissionParams, body: { content: { "application/json": { schema: evaluationInput } } } },
    policy: { auth: { kind: "grants", grants: ["review:write"] }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 200: ok, ...errors },
  },
  async (context) => {
    const { eventId, roundId, submissionId } = context.req.valid("param");
    const principal = context.get("principal");
    const authorization = await authorizeReviewerScope({ db: context.env.DB, principal, eventId, roundId, submissionId, operation: "evaluation-write" });
    const body = context.req.valid("json");
    const now = Date.now();
    const score = body.score ?? null;
    const criteriaScores = body.criteria_scores === undefined || body.criteria_scores === null
      ? null
      : JSON.stringify(body.criteria_scores);
    await context.env.DB.prepare(`
      INSERT INTO evaluations (id, round_id, submission_id, reviewer_person_id, recommendation, score, criteria_scores, comment, abstained, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
      ON CONFLICT(round_id, submission_id, reviewer_person_id) DO UPDATE SET
        recommendation = excluded.recommendation,
        score = excluded.score,
        criteria_scores = excluded.criteria_scores,
        comment = excluded.comment,
        abstained = 0,
        updated_at = excluded.updated_at
    `).bind(
      crypto.randomUUID(), roundId, submissionId, authorization.personId, body.recommendation, score,
      criteriaScores, body.comment, now, now,
    ).run();
    await context.env.DB.prepare(
      "UPDATE round_assignments SET status = 'complete', updated_at = ? WHERE round_id = ? AND submission_id = ? AND reviewer_person_id = ?",
    ).bind(now, roundId, submissionId, authorization.personId).run();
    const proposal = proposalFor(body.recommendation);
    return context.json({
      actor_id: authorization.personId,
      criteria_scores: criteriaScores === null ? null : body.criteria_scores,
      decision_proposal: proposal,
      lifecycle_status_changed: false,
      recommendation: body.recommendation,
      saved_at: now,
      score,
    }, 200);
  },
);

export const apiRoutes = [
  reviewerContextQueueRoute,
  reviewerQueueRoute,
  reviewerRecordRoute,
  reviewerFilesRoute,
  reviewerExportRoute,
  writeEvaluationRoute,
];
