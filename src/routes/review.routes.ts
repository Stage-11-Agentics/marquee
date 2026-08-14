import { z } from "@hono/zod-openapi";

import { ApiError } from "../api/errors";
import { defineApiRoute, errorResponses, jsonResponse } from "../api/route";
import type { Principal } from "../api/runtime";
import { validateComparisonRanking } from "../lib/evaluation-comparisons";
import { participantListSql } from "../lib/participants";
import { parseCriterionOptions } from "../lib/rubric-criteria";
import {
  authorizeReviewerScope,
  authorizeReviewerQueueScope,
  reviewerPersonIdForEvent,
  reviewerTrackIntersectionSql,
} from "../lib/reviewer-scope";
import { parseSocialLinks } from "../lib/person-profile";

const eventParams = z.object({ eventId: z.string().min(1) });
const roundParams = eventParams.extend({ roundId: z.string().min(1) });
const reviewerSubmissionParams = roundParams.extend({ submissionId: z.string().min(1) });
const recommendation = z.enum(["approve", "maybe", "deny"]);
const exportQuery = z.object({ format: z.literal("csv").default("csv") });

const evaluationInput = z.object({
  abstained: z.union([z.literal(0), z.literal(1)]).default(0),
  comment: z.string().max(20_000).default(""),
  criteria_scores: z.record(z.string(), z.union([z.number(), z.string().max(20_000)]))
    .refine((scores: Record<string, number | string>) => Object.keys(scores).length <= 40, "a scorecard carries at most 40 criteria")
    .nullable().optional(),
  recommendation: recommendation.nullable().optional(),
  score: z.number().nullable().optional(),
}).superRefine((value: { abstained: 0 | 1; recommendation?: "approve" | "maybe" | "deny" | null }, context: z.RefinementCtx) => {
  if (value.abstained === 0 && !value.recommendation) {
    context.addIssue({ code: "custom", path: ["recommendation"], message: "recommendation is required unless declaring a conflict" });
  }
  if (value.abstained === 1 && value.recommendation) {
    context.addIssue({ code: "custom", path: ["recommendation"], message: "a conflicted review cannot include a recommendation" });
  }
});

const comparisonInput = z.object({
  ranking: z.array(z.union([z.string().min(1), z.array(z.string().min(1)).min(1)])).min(1),
  submission_ids: z.array(z.string().min(1)).length(3),
});

const ok = jsonResponse(z.unknown(), "Reviewer response");
const errors = errorResponses([400, 401, 403, 404, 409, 422, 500]);

interface RoundRow {
  anonymized: 0 | 1;
  committee_id: string | null;
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

interface CriterionRow {
  id: string;
  kind: "numeric" | "select" | "text";
  name: string;
  options: string | null;
  position: number;
  scale_max: number | null;
  scale_min: number | null;
  weight_pct: number;
}

interface CompletedRow extends ReviewRow {
  submission_id: string;
}

interface ReviewRow {
  abstained: 0 | 1;
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

interface ReviewerProfileRow {
  bio: string | null;
  company: string | null;
  email: string;
  headshot_attachment_id: string | null;
  id: string;
  name: string;
  social_links: string | null;
  title: string | null;
  updated_at: number;
}

interface CommitteeRow {
  id: string;
  name: string;
  role: string;
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
      round.anonymized, round.committee_id, round.target_reviews_per_submission, round.opens_at, round.closes_at
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
    WHERE assignment.round_id = ?
      AND submission.event_id = ?
      AND assignment.status IN ('assigned', 'complete')
      AND assignment.reviewer_person_id = ?
      AND NOT EXISTS (
        SELECT 1
        FROM evaluations evaluation
        WHERE evaluation.round_id = assignment.round_id
          AND evaluation.submission_id = assignment.submission_id
          AND evaluation.reviewer_person_id = ?
      )
    ORDER BY submission.updated_at DESC, submission.id
  `).bind(roundId, eventId, personId, personId).all<{ submission_id: string }>();
  return result.results.map((row) => row.submission_id);
}

async function comparisonCandidateIds(
  db: D1Database,
  eventId: string,
  roundId: string,
  personId: string,
): Promise<string[]> {
  const result = await db.prepare(`
    SELECT DISTINCT assignment.submission_id
    FROM round_assignments assignment
    JOIN submissions submission ON submission.id = assignment.submission_id
    WHERE assignment.round_id = ?
      AND submission.event_id = ?
      AND assignment.status IN ('assigned', 'complete')
      AND assignment.reviewer_person_id = ?
      AND NOT EXISTS (
        SELECT 1
        FROM comparisons comparison
        WHERE comparison.round_id = ?
          AND comparison.reviewer_person_id = ?
          AND EXISTS (
            SELECT 1 FROM json_each(comparison.submission_ids) candidate
            WHERE CAST(candidate.value AS TEXT) = assignment.submission_id
          )
      )
    ORDER BY submission.updated_at DESC, submission.id
  `).bind(roundId, eventId, personId, roundId, personId).all<{ submission_id: string }>();
  return result.results.map((row) => row.submission_id);
}

/**
 * The queue is a materialized view of the shared authorization helper. The
 * candidate query is only an efficient pre-filter; every returned ID still
 * passes the shared batch authorization seam before any evaluator-visible
 * fields load.
 */
async function reviewerQueue(
  db: D1Database,
  principal: Principal,
  eventId: string,
  round: RoundRow,
): Promise<string[]> {
  const personId = reviewerPersonIdForEvent(principal, eventId);
  if (personId === null) {
    return [];
  }
  const candidates = await assignedSubmissionIds(db, eventId, round.id, personId);
  const authorizations = await authorizeReviewerQueueScope({
    db,
    principal,
    eventId,
    roundEventId: eventId,
    roundId: round.id,
    submissionIds: candidates,
    operation: "queue",
  });
  const authorized = new Set(authorizations.map((authorization) => authorization.submissionId));
  return candidates.filter((submissionId) => authorized.has(submissionId));
}

/**
 * The mirror of `assignedSubmissionIds`: what this reviewer has already
 * submitted. A finished review used to vanish from the queue, which left a
 * reviewer no way to check what they recorded — and left an organizer's claim
 * that the values were stored unverifiable from the reviewer's own surface.
 */
const COMPLETED_PAGE = 50;

async function completedSubmissionIds(
  db: D1Database,
  eventId: string,
  roundId: string,
  personId: string,
): Promise<string[]> {
  const result = await db.prepare(`
    SELECT DISTINCT assignment.submission_id
    FROM round_assignments assignment
    JOIN submissions submission ON submission.id = assignment.submission_id
    JOIN evaluations evaluation
      ON evaluation.round_id = assignment.round_id
      AND evaluation.submission_id = assignment.submission_id
      AND evaluation.reviewer_person_id = ?
    WHERE assignment.round_id = ?
      AND submission.event_id = ?
      AND assignment.reviewer_person_id = ?
    ORDER BY evaluation.updated_at DESC, assignment.submission_id
    LIMIT ?
  `).bind(personId, roundId, eventId, personId, COMPLETED_PAGE + 1).all<{ submission_id: string }>();
  return result.results.map((row) => row.submission_id);
}

/** One query for every stored review in the completed set — never one per item. */
async function reviewsForSubmissions(
  db: D1Database,
  roundId: string,
  reviewerPersonId: string,
  submissionIds: readonly string[],
): Promise<Map<string, ReviewRow>> {
  const reviews = new Map<string, ReviewRow>();
  const uniqueIds = [...new Set(submissionIds)];
  for (let offset = 0; offset < uniqueIds.length; offset += 80) {
    const chunk = uniqueIds.slice(offset, offset + 80);
    const result = await db.prepare(`
      SELECT submission_id, recommendation, score, criteria_scores, comment, abstained, reviewer_person_id, created_at, updated_at
      FROM evaluations
      WHERE round_id = ? AND reviewer_person_id = ? AND submission_id IN (${chunk.map(() => "?").join(",")})
    `).bind(roundId, reviewerPersonId, ...chunk).all<CompletedRow>();
    for (const row of result.results) reviews.set(row.submission_id, row);
  }
  return reviews;
}

/** The round's scorecard, as the reviewer surface must render it. */
async function criteriaForRound(db: D1Database, roundId: string): Promise<Array<Record<string, unknown>>> {
  const result = await db.prepare(
    "SELECT id, name, kind, options, scale_min, scale_max, weight_pct, position FROM rubric_criteria WHERE round_id = ? ORDER BY position, id",
  ).bind(roundId).all<CriterionRow>();
  return result.results.map((criterion) => ({
    ...criterion,
    options: criterion.options === null ? null : parseCriterionOptions(criterion.options),
  }));
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

async function reviewerProfile(db: D1Database, eventId: string, personId: string): Promise<Record<string, unknown> | null> {
  const row = await db.prepare(`
    SELECT person.id, person.name, person.email, person.title, person.company, person.bio,
      person.social_links, person.headshot_attachment_id, person.updated_at
    FROM people person
    JOIN memberships membership
      ON membership.person_id = person.id
     AND membership.event_id = ?
     AND membership.role = 'reviewer'
    WHERE person.id = ?
  `).bind(eventId, personId).first<ReviewerProfileRow>();
  if (!row) return null;
  return {
    bio: row.bio,
    company: row.company,
    email: row.email,
    headshot_attachment_id: row.headshot_attachment_id,
    id: row.id,
    name: row.name,
    social_links: parseSocialLinks(row.social_links),
    title: row.title,
    updated_at: row.updated_at,
  };
}

async function reviewerCommittees(db: D1Database, eventId: string, personId: string): Promise<CommitteeRow[]> {
  const result = await db.prepare(`
    SELECT committee.id, committee.name, member.role
    FROM committee_members member
    JOIN committees committee
      ON committee.id = member.committee_id
     AND committee.event_id = ?
    WHERE member.person_id = ?
    ORDER BY committee.name COLLATE NOCASE, committee.id
  `).bind(eventId, personId).all<CommitteeRow>();
  return result.results;
}

/** Count only assigned records that this reviewer can still truthfully see. */
async function reviewerReviewedCount(db: D1Database, eventId: string, roundId: string, personId: string): Promise<number> {
  const row = await db.prepare(`
    SELECT COUNT(DISTINCT evaluation.submission_id) AS reviewed
    FROM evaluations evaluation
    JOIN round_assignments assignment
      ON assignment.round_id = evaluation.round_id
     AND assignment.submission_id = evaluation.submission_id
     AND assignment.reviewer_person_id = evaluation.reviewer_person_id
     AND assignment.status IN ('assigned', 'complete')
    JOIN submissions submission
      ON submission.id = assignment.submission_id
     AND submission.event_id = ?
    WHERE evaluation.round_id = ?
      AND evaluation.reviewer_person_id = ?
      AND ${reviewerTrackIntersectionSql()}
  `).bind(eventId, roundId, personId, personId).first<{ reviewed: number }>();
  return Number(row?.reviewed ?? 0);
}

async function activeRoundForEvent(db: D1Database, eventId: string, principal: Principal): Promise<RoundRow> {
  const rounds = await db.prepare(`
    SELECT round.id, round.plan_id, plan.name AS plan_name, round.position, round.name, round.mode,
      round.anonymized, round.committee_id, round.target_reviews_per_submission, round.opens_at, round.closes_at
    FROM evaluation_rounds round
    JOIN evaluation_plans plan ON plan.id = round.plan_id
    WHERE plan.event_id = ? AND plan.status = 'open'
    ORDER BY plan.updated_at DESC, round.position, round.id
  `).bind(eventId).all<RoundRow>();
  const personId = reviewerPersonIdForEvent(principal, eventId);
  if (personId !== null) {
    for (const round of rounds.results) {
      const candidates = round.mode === "comparison"
        ? await comparisonCandidateIds(db, eventId, round.id, personId)
        : await assignedSubmissionIds(db, eventId, round.id, personId);
      const authorizations = await authorizeReviewerQueueScope({
        db,
        principal,
        eventId,
        roundEventId: eventId,
        roundId: round.id,
        submissionIds: candidates,
        operation: "queue",
      });
      if (authorizations.length > 0) return round;
    }
  }
  const round = rounds.results[0];
  if (!round) throw ApiError.notFound("review round not found");
  return round;
}

async function queueRows(db: D1Database, eventId: string, submissionIds: readonly string[]): Promise<Map<string, QueueRow>> {
  const rows = new Map<string, QueueRow>();
  const uniqueIds = [...new Set(submissionIds)];
  for (let offset = 0; offset < uniqueIds.length; offset += 80) {
    const chunk = uniqueIds.slice(offset, offset + 80);
    const result = await db.prepare(`
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
      WHERE submission.event_id = ? AND submission.id IN (${chunk.map(() => "?").join(",")})
    `).bind(eventId, ...chunk).all<QueueRow>();
    for (const row of result.results) rows.set(row.id, row);
  }
  return rows;
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
    SELECT recommendation, score, criteria_scores, comment, abstained, reviewer_person_id, created_at, updated_at
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
      ${participantListSql({
        submissionId: "submission.id",
        audience: "program",
        fields: {
          id: "speaker.id",
          name: "speaker.name",
          email: "speaker.email",
          company: "speaker.company",
          bio: "speaker.bio",
          headshot_attachment_id: "speaker.headshot_attachment_id",
        },
      })} AS speakers
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
    abstained: review.abstained === 1,
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
  const ids = await reviewerQueue(db, principal, eventId, round);
  const rows = await queueRows(db, eventId, ids);
  const personId = reviewerPersonIdForEvent(principal, eventId);
  const data: Array<Record<string, unknown>> = [];
  for (const [index, submissionId] of ids.entries()) {
    const row = rows.get(submissionId) ?? null;
    if (row) data.push({ ...row, tracks: parseJsonArray(row.tracks), queue_id: row.id, position: index + 1 });
  }
  const [completed, profile, committees, reviewed] = personId === null
    ? [[], null, [], 0] as const
    : await Promise.all([
      completedQueue(db, principal, eventId, round, personId),
      reviewerProfile(db, eventId, personId),
      reviewerCommittees(db, eventId, personId),
      reviewerReviewedCount(db, eventId, round.id, personId),
    ]);
  const counts = { reviewed, total: data.length + reviewed, waiting: data.length };
  return {
    committees,
    completed,
    completed_truncated: completed.length >= COMPLETED_PAGE,
    counts,
    current_id: data[0]?.id ?? null,
    current_index: data.length ? 0 : null,
    data,
    plan: { id: round.plan_id, name: round.plan_name },
    position: data.length ? 1 : 0,
    remaining: data.length,
    round: {
      anonymized: Boolean(round.anonymized),
      closes_at: round.closes_at,
      criteria: await criteriaForRound(db, round.id),
      id: round.id,
      mode: round.mode,
      name: round.name,
      position: round.position,
    },
    person: profile,
    scopes: personId ? await reviewerTrackScopes(db, eventId, personId) : [],
    total: data.length,
  };
}

/**
 * Completed items pass the same authorization seam as the open queue — a review
 * a reviewer wrote before losing track scope is no longer theirs to reopen.
 */
async function completedQueue(
  db: D1Database,
  principal: Principal,
  eventId: string,
  round: RoundRow,
  personId: string,
): Promise<Array<Record<string, unknown>>> {
  const found = await completedSubmissionIds(db, eventId, round.id, personId);
  const candidates = found.slice(0, COMPLETED_PAGE);
  if (candidates.length === 0) return [];
  const authorizations = await authorizeReviewerQueueScope({
    db, principal, eventId, roundEventId: eventId, roundId: round.id, submissionIds: candidates, operation: "queue",
  });
  const authorized = new Set(authorizations.map((authorization) => authorization.submissionId));
  const ids = candidates.filter((submissionId) => authorized.has(submissionId));
  const [rows, reviews] = await Promise.all([
    queueRows(db, eventId, ids),
    reviewsForSubmissions(db, round.id, personId, ids),
  ]);
  const completed: Array<Record<string, unknown>> = [];
  for (const submissionId of ids) {
    const row = rows.get(submissionId);
    if (row) {
      completed.push({
        ...row,
        position: completed.length + 1,
        queue_id: row.id,
        review: reviewPayload(reviews.get(submissionId) ?? null),
        tracks: parseJsonArray(row.tracks),
      });
    }
  }
  return completed;
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
    const round = await activeRoundForEvent(context.env.DB, eventId, principal);
    return context.json(await reviewerQueuePayload(context.env.DB, principal, eventId, round), 200);
  },
);

async function comparisonQueuePayload(
  db: D1Database,
  principal: Principal,
  eventId: string,
  round: RoundRow,
): Promise<Record<string, unknown>> {
  const personId = reviewerPersonIdForEvent(principal, eventId);
  if (personId === null) throw ApiError.forbidden("reviewer resource is outside your authorized tracks");
  const candidates = await comparisonCandidateIds(db, eventId, round.id, personId);
  const authorizations = await authorizeReviewerQueueScope({
    db,
    principal,
    eventId,
    roundEventId: eventId,
    roundId: round.id,
    submissionIds: candidates,
    operation: "queue",
  });
  const eligibleIds = authorizations.map((authorization) => authorization.submissionId);
  const rows = await queueRows(db, eventId, eligibleIds.slice(0, 3));
  const data: Array<Record<string, unknown>> = [];
  for (const submissionId of eligibleIds.slice(0, 3)) {
    const row = rows.get(submissionId);
    if (row) data.push({ ...row, tracks: parseJsonArray(row.tracks), queue_id: row.id, position: data.length + 1 });
  }
  const [profile, committees, reviewed] = await Promise.all([
    reviewerProfile(db, eventId, personId),
    reviewerCommittees(db, eventId, personId),
    reviewerReviewedCount(db, eventId, round.id, personId),
  ]);
  return {
    committees,
    data,
    eligible_count: eligibleIds.length,
    counts: { reviewed, total: eligibleIds.length + reviewed, waiting: eligibleIds.length },
    plan: { id: round.plan_id, name: round.plan_name },
    round: { anonymized: Boolean(round.anonymized), closes_at: round.closes_at, id: round.id, mode: round.mode, name: round.name, position: round.position },
    person: profile,
    scopes: await reviewerTrackScopes(db, eventId, personId),
  };
}

const reviewerComparisonQueueRoute = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/events/{eventId}/rounds/{roundId}/comparisons/next",
    operationId: "getReviewerComparisonQueue",
    summary: "Read the next authorized three-card comparison",
    tags: ["Reviewer"],
    request: { params: roundParams },
    policy: { auth: { kind: "grants", grants: ["review:write"] }, rateLimit: { bucket: "read" }, concurrency: "none" },
    responses: { 200: ok, ...errors },
  },
  async (context) => {
    const { eventId, roundId } = context.req.valid("param");
    const round = await roundForEvent(context.env.DB, eventId, roundId);
    if (round.mode !== "comparison") throw ApiError.conflict("this round is configured for scorecard review");
    return context.json(await comparisonQueuePayload(context.env.DB, context.get("principal"), eventId, round), 200);
  },
);

const writeComparisonRoute = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/events/{eventId}/rounds/{roundId}/comparisons",
    operationId: "writeReviewerComparison",
    summary: "Save an authorized three-submission comparison",
    tags: ["Reviewer"],
    request: { params: roundParams, body: { content: { "application/json": { schema: comparisonInput } } } },
    policy: { auth: { kind: "grants", grants: ["review:write"] }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 201: ok, ...errors },
  },
  async (context) => {
    const { eventId, roundId } = context.req.valid("param");
    const round = await roundForEvent(context.env.DB, eventId, roundId);
    if (round.mode !== "comparison") throw ApiError.conflict("this round is configured for scorecard review");
    const body = context.req.valid("json");
    if (new Set(body.submission_ids).size !== 3) throw ApiError.unprocessable("a comparison needs three distinct submissions", "submission_ids");
    const ranking = validateComparisonRanking(body.submission_ids, body.ranking);
    if (!ranking) throw ApiError.unprocessable("ranking must cover the three submissions exactly; ties are allowed", "ranking");
    const principal = context.get("principal");
    const authorizations = [];
    for (const submissionId of body.submission_ids) {
      // This is intentionally before the insert: a scope failure cannot leave
      // a partial comparison or reveal which card was outside the reviewer set.
      authorizations.push(await authorizeReviewerScope({ db: context.env.DB, principal, eventId, roundId, submissionId, operation: "comparison-write" }));
    }
    const reviewerPersonId = authorizations[0]!.personId;
    const now = Date.now();
    const id = crypto.randomUUID();
    // Each saved comparison is independent evidence. Reviewers may compare
    // the same three cards again after another assignment batch; the chair
    // aggregate intentionally counts every recorded comparison.
    await context.env.DB.prepare(`
      INSERT INTO comparisons
        (id, round_id, reviewer_person_id, submission_ids, ranking, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(id, roundId, reviewerPersonId, JSON.stringify(body.submission_ids), JSON.stringify(ranking), now, now).run();
    await context.env.DB.prepare(`
      UPDATE round_assignments
      SET status = 'complete', updated_at = ?
      WHERE round_id = ?
        AND submission_id IN (SELECT CAST(value AS TEXT) FROM json_each(?))
        AND reviewer_person_id = ?
    `).bind(now, roundId, JSON.stringify(body.submission_ids), reviewerPersonId).run();
    return context.json({
      id,
      ranking,
      reviewer_person_id: reviewerPersonId,
      round_id: roundId,
      submission_ids: body.submission_ids,
      saved_at: now,
    }, 201);
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
    const round = await roundForEvent(context.env.DB, eventId, roundId);
    const ids = await reviewerQueue(context.env.DB, principal, eventId, round);
    const rows = await queueRows(context.env.DB, eventId, ids);
    const lines = ["submission_id,title,abstract,format,tracks"];
    for (const submissionId of ids) {
      const row = rows.get(submissionId) ?? null;
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
    const abstained = body.abstained === 1;
    const recommendationValue = abstained ? null : body.recommendation;
    const score = abstained ? null : body.score ?? null;
    const criteriaScores = abstained || body.criteria_scores === undefined || body.criteria_scores === null
      ? null
      : JSON.stringify(body.criteria_scores);
    await context.env.DB.prepare(`
      INSERT INTO evaluations (id, round_id, submission_id, reviewer_person_id, recommendation, score, criteria_scores, comment, abstained, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      -- The four override_* columns are deliberately absent from this update: a
      -- chair's override survives the reviewer revising their own score. The
      -- chair judged the abstract, not one scoring run, and a reviewer must not
      -- be able to lift an override by re-submitting. Clearing it stays the
      -- chair's own gesture. MRQ-149's suite pins this both ways.
      ON CONFLICT(round_id, submission_id, reviewer_person_id) DO UPDATE SET
        recommendation = excluded.recommendation,
        score = excluded.score,
        criteria_scores = excluded.criteria_scores,
        comment = excluded.comment,
        abstained = excluded.abstained,
        updated_at = excluded.updated_at
    `).bind(
      crypto.randomUUID(), roundId, submissionId, authorization.personId, recommendationValue, score,
      criteriaScores, body.comment, abstained ? 1 : 0, now, now,
    ).run();
    await context.env.DB.prepare(
      "UPDATE round_assignments SET status = 'complete', updated_at = ? WHERE round_id = ? AND submission_id = ? AND reviewer_person_id = ?",
    ).bind(now, roundId, submissionId, authorization.personId).run();
    const proposal = recommendationValue ? proposalFor(recommendationValue) : null;
    return context.json({
      abstained,
      actor_id: authorization.personId,
      criteria_scores: criteriaScores === null ? null : body.criteria_scores,
      decision_proposal: proposal,
      lifecycle_status_changed: false,
      recommendation: recommendationValue,
      saved_at: now,
      score,
    }, 200);
  },
);

export const apiRoutes = [
  reviewerContextQueueRoute,
  reviewerQueueRoute,
  reviewerComparisonQueueRoute,
  writeComparisonRoute,
  reviewerRecordRoute,
  reviewerFilesRoute,
  reviewerExportRoute,
  writeEvaluationRoute,
];
