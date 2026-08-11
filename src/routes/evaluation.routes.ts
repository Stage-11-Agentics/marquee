import { z } from "@hono/zod-openapi";

import { ApiError } from "../api/errors";
import { defineApiRoute, errorResponses, jsonResponse, type ApiRouteEntry } from "../api/route";
import type { Principal } from "../api/runtime";
import { getAuth } from "../lib/auth/auth-middleware";
import { authHasRole } from "../lib/auth/scope-resolution";
import {
  authorizeReviewerScope,
  reviewerPersonIdForEvent,
} from "../lib/reviewer-scope";

const eventParams = z.object({ eventId: z.string().min(1) });
const planParams = eventParams.extend({ planId: z.string().min(1) });
const roundParams = eventParams.extend({ roundId: z.string().min(1) });
const criterionParams = roundParams.extend({ criterionId: z.string().min(1) });
const committeeParams = eventParams.extend({ committeeId: z.string().min(1) });
const reviewerScopeParams = committeeParams.extend({ personId: z.string().min(1) });
const reviewerSubmissionParams = roundParams.extend({ submissionId: z.string().min(1) });

const roundMode = z.enum(["scorecard", "comparison"]);
const assignmentMode = z.enum(["everyone", "n_per_submission"]);
const recommendation = z.enum(["approve", "maybe", "deny"]);

const criterionInput = z.object({
  id: z.string().min(1).optional(),
  name: z.string().trim().min(1).max(160),
  position: z.number().int().min(0),
  weight_pct: z.number().min(0).max(100),
});

const roundInput = z.object({
  anonymized: z.boolean().default(false),
  closes_at: z.number().int().nullable().optional(),
  criteria: z.array(criterionInput).optional(),
  mode: roundMode.default("scorecard"),
  name: z.string().trim().min(1).max(160),
  opens_at: z.number().int().nullable().optional(),
  position: z.number().int().min(0).max(1).optional(),
  target_reviews_per_submission: z.number().int().positive().default(3),
});

const planInput = z.object({
  instructions: z.string().max(50_000).default(""),
  name: z.string().trim().min(1).max(200),
  rounds: z.array(roundInput).max(2).optional(),
  scale_max: z.number().nullable().optional(),
  scale_min: z.number().nullable().optional(),
  status: z.enum(["draft", "open", "closed"]).default("draft"),
});

const planPatch = planInput.partial();
const criteriaInput = z.object({ criteria: z.array(criterionInput).min(1) });
const committeeInput = z.object({ name: z.string().trim().min(1).max(160) });
const memberInput = z.object({ person_id: z.string().min(1), role: z.string().trim().min(1).max(80).default("reviewer") });
const scopeInput = z.object({ track_ids: z.array(z.string().min(1)).min(1) });
const assignmentsInput = z.object({
  committee_id: z.string().min(1),
  mode: assignmentMode,
  reviewer_person_ids: z.array(z.string().min(1)).min(1).optional(),
  submission_ids: z.array(z.string().min(1)).min(1).optional(),
  reviewers_per_submission: z.number().int().positive().max(100).optional(),
});
const promoteInput = z.object({
  preview: z.boolean().default(true),
  submission_ids: z.array(z.string().min(1)).default([]),
});
const evaluationInput = z.object({
  comment: z.string().max(20_000).default(""),
  criteria_scores: z.record(z.string(), z.number().min(0)).nullable().optional(),
  recommendation,
  score: z.number().nullable().optional(),
});

const listQuery = z.object({
  page: z.coerce.number().int().positive().default(1),
  per_page: z.coerce.number().int().positive().max(100).default(50),
});

const ok = jsonResponse(z.unknown(), "Evaluation response");
const errors = errorResponses([400, 401, 403, 404, 409, 422, 500]);

interface PlanRow {
  event_id: string;
  id: string;
  instructions: string;
  name: string;
  scale_max: number | null;
  scale_min: number | null;
  status: string;
  updated_at: number;
}

interface RoundRow {
  anonymized: 0 | 1;
  closes_at: number | null;
  id: string;
  mode: "scorecard" | "comparison";
  name: string;
  opens_at: number | null;
  plan_id: string;
  position: number;
  target_reviews_per_submission: number;
}

interface CriterionRow {
  id: string;
  name: string;
  position: number;
  round_id: string;
  weight_pct: number;
}

interface CommitteeRow {
  id: string;
  name: string;
  event_id: string;
}

interface PersonRow {
  company: string | null;
  id: string;
  name: string;
}

function requireProgram(
  context: Parameters<NonNullable<ApiRouteEntry["handler"]>>[0],
  eventId: string,
  write: boolean,
): void {
  const auth = getAuth(context);
  if (!auth) throw ApiError.unauthenticated();
  if (auth.kind === "session") {
    if (!authHasRole(auth, write ? "program_lead" : "ops", eventId)) {
      throw ApiError.forbidden("evaluation management requires program access for this conference");
    }
    return;
  }
  const eventAllowed = auth.eventId === null
    ? (auth.eventIds.length === 0 || auth.eventIds.includes(eventId))
    : auth.eventId === eventId;
  const grant = write ? "program:write" : "program:read";
  if (!eventAllowed || (!auth.grants.includes(grant) && !auth.permissions.includes(grant))) {
    throw ApiError.forbidden(`evaluation management requires ${grant}`);
  }
}

async function planForEvent(db: D1Database, eventId: string, planId: string): Promise<PlanRow> {
  const plan = await db.prepare(
    "SELECT id, event_id, name, instructions, scale_min, scale_max, status, updated_at FROM evaluation_plans WHERE id = ? AND event_id = ?",
  ).bind(planId, eventId).first<PlanRow>();
  if (!plan) throw ApiError.notFound("evaluation plan not found");
  return plan;
}

async function roundForEvent(db: D1Database, eventId: string, roundId: string): Promise<RoundRow> {
  const round = await db.prepare(`
    SELECT round.id, round.plan_id, round.position, round.name, round.mode,
      round.anonymized, round.target_reviews_per_submission, round.opens_at, round.closes_at
    FROM evaluation_rounds round
    JOIN evaluation_plans plan ON plan.id = round.plan_id
    WHERE round.id = ? AND plan.event_id = ?
  `).bind(roundId, eventId).first<RoundRow>();
  if (!round) throw ApiError.notFound("evaluation round not found");
  return round;
}

function assertCriteriaTotal(criteria: ReadonlyArray<{ weight_pct: number }>): void {
  const total = criteria.reduce((sum, criterion) => sum + criterion.weight_pct, 0);
  if (Math.abs(total - 100) > 0.0001) {
    throw ApiError.unprocessable("scorecard criteria must total exactly 100%", "criteria", { total });
  }
}

function assertTwoRounds(rounds: ReadonlyArray<{ position?: number }>): void {
  if (rounds.length > 2) throw ApiError.unprocessable("a conference evaluation plan has at most two rounds", "rounds");
  const positions = rounds.map((round, index) => round.position ?? index);
  if (new Set(positions).size !== positions.length || positions.some((position) => position < 0 || position > 1)) {
    throw ApiError.unprocessable("evaluation rounds must have unique positions 0 and 1", "rounds");
  }
}

async function criteriaForRound(db: D1Database, roundId: string): Promise<CriterionRow[]> {
  const result = await db.prepare(
    "SELECT id, round_id, name, weight_pct, position FROM rubric_criteria WHERE round_id = ? ORDER BY position, id",
  ).bind(roundId).all<CriterionRow>();
  return result.results;
}

async function committeeForEvent(db: D1Database, eventId: string, committeeId: string): Promise<CommitteeRow> {
  const committee = await db.prepare(
    "SELECT id, event_id, name FROM committees WHERE id = ? AND event_id = ?",
  ).bind(committeeId, eventId).first<CommitteeRow>();
  if (!committee) throw ApiError.notFound("committee not found");
  return committee;
}

async function reviewersForCommittee(db: D1Database, committeeId: string): Promise<PersonRow[]> {
  const result = await db.prepare(`
    SELECT person.id, person.name, person.company
    FROM committee_members member
    JOIN people person ON person.id = member.person_id
    WHERE member.committee_id = ?
    ORDER BY person.name COLLATE NOCASE, person.id
  `).bind(committeeId).all<PersonRow>();
  return result.results;
}

async function planDetail(db: D1Database, eventId: string, planId: string): Promise<Record<string, unknown>> {
  const plan = await planForEvent(db, eventId, planId);
  const roundsResult = await db.prepare(
    "SELECT id, plan_id, position, name, mode, anonymized, target_reviews_per_submission, opens_at, closes_at FROM evaluation_rounds WHERE plan_id = ? ORDER BY position, id",
  ).bind(plan.id).all<RoundRow>();
  const rounds = [];
  for (const round of roundsResult.results) {
    const criteria = await criteriaForRound(db, round.id);
    const progress = await db.prepare(`
      SELECT
        COUNT(DISTINCT assignment.submission_id) AS assigned_submissions,
        COUNT(DISTINCT evaluation.submission_id) AS reviewed_submissions,
        COUNT(evaluation.id) AS evaluations,
        (SELECT COUNT(*) FROM submissions submission WHERE submission.event_id = ? AND submission.status IN ('submitted', 'in_review') AND submission.bypass_evaluation = 0) AS submission_count
      FROM round_assignments assignment
      LEFT JOIN evaluations evaluation
        ON evaluation.round_id = assignment.round_id AND evaluation.submission_id = assignment.submission_id
      WHERE assignment.round_id = ?
    `).bind(eventId, round.id).first<Record<string, number>>();
    rounds.push({
      ...round,
      anonymized: Boolean(round.anonymized),
      criteria,
      progress: {
        assigned_submissions: Number(progress?.assigned_submissions ?? 0),
        evaluations: Number(progress?.evaluations ?? 0),
        reviewed_submissions: Number(progress?.reviewed_submissions ?? 0),
        submission_count: Number(progress?.submission_count ?? 0),
      },
    });
  }

  const committeesResult = await db.prepare(
    "SELECT id, event_id, name FROM committees WHERE event_id = ? ORDER BY name, id",
  ).bind(eventId).all<CommitteeRow>();
  const committees = [];
  for (const committee of committeesResult.results) {
    const members = await reviewersForCommittee(db, committee.id);
    const memberRows = [];
    for (const person of members) {
      const trackScopes = await db.prepare(`
        SELECT track.id, track.name, track.color
        FROM reviewer_track_scopes scope
        JOIN tracks track ON track.id = scope.track_id
        WHERE scope.event_id = ? AND scope.person_id = ?
        ORDER BY track.position, track.id
      `).bind(eventId, person.id).all<Record<string, string>>();
      const reviewCount = await db.prepare(
        "SELECT COUNT(*) AS count FROM evaluations evaluation JOIN evaluation_rounds round ON round.id = evaluation.round_id WHERE round.plan_id = ? AND evaluation.reviewer_person_id = ?",
      ).bind(planId, person.id).first<{ count: number }>();
      memberRows.push({
        ...person,
        progress: Number(reviewCount?.count ?? 0),
        track_scopes: trackScopes.results,
      });
    }
    committees.push({ ...committee, members: memberRows });
  }

  const summary = await db.prepare(`
    SELECT COUNT(evaluation.id) AS evaluations,
      COUNT(DISTINCT evaluation.submission_id) AS submissions_with_reviews,
      MAX(evaluation.score) AS highest_score,
      COUNT(DISTINCT CASE WHEN evaluation.score IS NOT NULL AND evaluation.score != (
        SELECT AVG(other.score) FROM evaluations other WHERE other.round_id = evaluation.round_id AND other.score IS NOT NULL
      ) THEN evaluation.submission_id END) AS wide_spread
    FROM evaluations evaluation
    JOIN evaluation_rounds round ON round.id = evaluation.round_id
    WHERE round.plan_id = ?
  `).bind(planId).first<Record<string, number | null>>();

  return {
    ...plan,
    rounds,
    committees,
    summary: {
      evaluations: Number(summary?.evaluations ?? 0),
      highest_score: summary?.highest_score === null || summary?.highest_score === undefined ? null : Number(summary.highest_score),
      submissions_with_reviews: Number(summary?.submissions_with_reviews ?? 0),
      wide_spread: Number(summary?.wide_spread ?? 0),
    },
  };
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
    WHERE assignment.round_id = ?
      AND submission.event_id = ?
      AND assignment.status IN ('assigned', 'complete')
      AND (assignment.reviewer_person_id = ? OR member.person_id IS NOT NULL)
    ORDER BY submission.updated_at DESC, submission.id
  `).bind(personId, roundId, eventId, personId).all<{ submission_id: string }>();
  return result.results.map((row) => row.submission_id);
}

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
      // Queue membership is the intersection. A direct assignment without a
      // carried track is filtered out; it must not poison the rest of the queue.
      if (error instanceof ApiError && error.status === 403) continue;
      throw error;
    }
  }
  return allowed;
}

const listPlans = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/events/{eventId}/plans",
    operationId: "listEvaluationPlans",
    summary: "List evaluation plans for a conference",
    tags: ["Evaluation"],
    request: { params: eventParams, query: listQuery },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "read" }, concurrency: "none" },
    responses: { 200: ok, ...errors },
  },
  async (context) => {
    const { eventId } = context.req.valid("param");
    requireProgram(context, eventId, false);
    const rows = await context.env.DB.prepare(
      "SELECT id, event_id, name, instructions, scale_min, scale_max, status, updated_at FROM evaluation_plans WHERE event_id = ? ORDER BY updated_at DESC, id",
    ).bind(eventId).all<PlanRow>();
    return context.json({ data: rows.results }, 200);
  },
);

const createPlan = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/events/{eventId}/plans",
    operationId: "createEvaluationPlan",
    summary: "Create an evaluation plan",
    tags: ["Evaluation"],
    request: { params: eventParams, body: { content: { "application/json": { schema: planInput } } } },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 201: ok, ...errors },
  },
  async (context) => {
    const { eventId } = context.req.valid("param");
    requireProgram(context, eventId, true);
    const body = context.req.valid("json");
    if (body.scale_min !== undefined && body.scale_max !== undefined && body.scale_min !== null && body.scale_max !== null && body.scale_min > body.scale_max) {
      throw ApiError.unprocessable("the score scale minimum cannot exceed its maximum", "scale_min");
    }
    if (body.rounds) {
      assertTwoRounds(body.rounds);
      for (const round of body.rounds) if (round.criteria) assertCriteriaTotal(round.criteria);
    }
    const now = Date.now();
    const planId = crypto.randomUUID();
    const statements = [context.env.DB.prepare(
      "INSERT INTO evaluation_plans (id, event_id, name, instructions, scale_min, scale_max, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(planId, eventId, body.name, body.instructions, body.scale_min ?? null, body.scale_max ?? null, body.status, now, now)];
    for (const [index, round] of (body.rounds ?? []).entries()) {
      const roundId = crypto.randomUUID();
      const position = round.position ?? index;
      statements.push(context.env.DB.prepare(
        "INSERT INTO evaluation_rounds (id, plan_id, position, name, mode, anonymized, target_reviews_per_submission, opens_at, closes_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).bind(roundId, planId, position, round.name, round.mode, round.anonymized ? 1 : 0, round.target_reviews_per_submission, round.opens_at ?? null, round.closes_at ?? null, now, now));
      for (const criterion of round.criteria ?? []) {
        statements.push(context.env.DB.prepare(
          "INSERT INTO rubric_criteria (id, round_id, name, weight_pct, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        ).bind(criterion.id ?? crypto.randomUUID(), roundId, criterion.name, criterion.weight_pct, criterion.position, now, now));
      }
    }
    await context.env.DB.batch(statements);
    return context.json(await planDetail(context.env.DB, eventId, planId), 201);
  },
);

const getPlan = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/events/{eventId}/plans/{planId}",
    operationId: "getEvaluationPlan",
    summary: "Read an evaluation plan",
    tags: ["Evaluation"],
    request: { params: planParams },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "read" }, concurrency: "none" },
    responses: { 200: ok, ...errors },
  },
  async (context) => {
    const { eventId, planId } = context.req.valid("param");
    requireProgram(context, eventId, false);
    return context.json(await planDetail(context.env.DB, eventId, planId), 200);
  },
);

const updatePlan = defineApiRoute(
  {
    method: "patch",
    path: "/api/v1/events/{eventId}/plans/{planId}",
    operationId: "updateEvaluationPlan",
    summary: "Edit an evaluation plan",
    tags: ["Evaluation"],
    request: { params: planParams, body: { content: { "application/json": { schema: planPatch } } } },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 200: ok, ...errors },
  },
  async (context) => {
    const { eventId, planId } = context.req.valid("param");
    requireProgram(context, eventId, true);
    const current = await planForEvent(context.env.DB, eventId, planId);
    const body = context.req.valid("json");
    const scaleMin = body.scale_min === undefined ? current.scale_min : body.scale_min;
    const scaleMax = body.scale_max === undefined ? current.scale_max : body.scale_max;
    if (scaleMin !== null && scaleMax !== null && scaleMin !== undefined && scaleMax !== undefined && scaleMin > scaleMax) {
      throw ApiError.unprocessable("the score scale minimum cannot exceed its maximum", "scale_min");
    }
    await context.env.DB.prepare(
      "UPDATE evaluation_plans SET name = ?, instructions = ?, scale_min = ?, scale_max = ?, status = ?, updated_at = ? WHERE id = ? AND event_id = ?",
    ).bind(body.name ?? current.name, body.instructions ?? current.instructions, scaleMin ?? null, scaleMax ?? null, body.status ?? current.status, Date.now(), planId, eventId).run();
    return context.json(await planDetail(context.env.DB, eventId, planId), 200);
  },
);

const addRound = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/events/{eventId}/plans/{planId}/rounds",
    operationId: "createEvaluationRound",
    summary: "Add an ordered evaluation round",
    tags: ["Evaluation"],
    request: { params: planParams, body: { content: { "application/json": { schema: roundInput } } } },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 201: ok, ...errors },
  },
  async (context) => {
    const { eventId, planId } = context.req.valid("param");
    requireProgram(context, eventId, true);
    await planForEvent(context.env.DB, eventId, planId);
    const body = context.req.valid("json");
    if (body.criteria) assertCriteriaTotal(body.criteria);
    const count = await context.env.DB.prepare("SELECT COUNT(*) AS count FROM evaluation_rounds WHERE plan_id = ?").bind(planId).first<{ count: number }>();
    if (Number(count?.count ?? 0) >= 2) throw ApiError.unprocessable("an evaluation plan has exactly one or two rounds", "position");
    const last = await context.env.DB.prepare("SELECT MAX(position) AS position FROM evaluation_rounds WHERE plan_id = ?").bind(planId).first<{ position: number | null }>();
    const position = body.position ?? (last?.position === null || last?.position === undefined ? 0 : Number(last.position) + 1);
    if (position > 1) throw ApiError.unprocessable("evaluation rounds must be ordered as round 1 or round 2", "position");
    const now = Date.now();
    const roundId = crypto.randomUUID();
    const statements = [context.env.DB.prepare(
      "INSERT INTO evaluation_rounds (id, plan_id, position, name, mode, anonymized, target_reviews_per_submission, opens_at, closes_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(roundId, planId, position, body.name, body.mode, body.anonymized ? 1 : 0, body.target_reviews_per_submission, body.opens_at ?? null, body.closes_at ?? null, now, now)];
    for (const criterion of body.criteria ?? []) statements.push(context.env.DB.prepare(
      "INSERT INTO rubric_criteria (id, round_id, name, weight_pct, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).bind(criterion.id ?? crypto.randomUUID(), roundId, criterion.name, criterion.weight_pct, criterion.position, now, now));
    try { await context.env.DB.batch(statements); } catch { throw ApiError.conflict("that evaluation round position is already in use"); }
    return context.json(await planDetail(context.env.DB, eventId, planId), 201);
  },
);

const replaceCriteria = defineApiRoute(
  {
    method: "put",
    path: "/api/v1/events/{eventId}/rounds/{roundId}/criteria",
    operationId: "replaceEvaluationCriteria",
    summary: "Replace a round scorecard",
    tags: ["Evaluation"],
    request: { params: roundParams, body: { content: { "application/json": { schema: criteriaInput } } } },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 200: ok, ...errors },
  },
  async (context) => {
    const { eventId, roundId } = context.req.valid("param");
    requireProgram(context, eventId, true);
    const body = context.req.valid("json");
    assertCriteriaTotal(body.criteria);
    const round = await roundForEvent(context.env.DB, eventId, roundId);
    const now = Date.now();
    const statements = [context.env.DB.prepare("DELETE FROM rubric_criteria WHERE round_id = ?").bind(roundId)];
    for (const criterion of body.criteria) statements.push(context.env.DB.prepare(
      "INSERT INTO rubric_criteria (id, round_id, name, weight_pct, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).bind(criterion.id ?? crypto.randomUUID(), roundId, criterion.name, criterion.weight_pct, criterion.position, now, now));
    await context.env.DB.batch(statements);
    return context.json({ round, criteria: await criteriaForRound(context.env.DB, roundId) }, 200);
  },
);

const createCommittee = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/events/{eventId}/committees",
    operationId: "createEvaluationCommittee",
    summary: "Create a reviewer committee",
    tags: ["Evaluation"],
    request: { params: eventParams, body: { content: { "application/json": { schema: committeeInput } } } },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 201: ok, ...errors },
  },
  async (context) => {
    const { eventId } = context.req.valid("param");
    requireProgram(context, eventId, true);
    const body = context.req.valid("json");
    const id = crypto.randomUUID();
    const now = Date.now();
    try {
      await context.env.DB.prepare("INSERT INTO committees (id, event_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").bind(id, eventId, body.name, now, now).run();
    } catch { throw ApiError.conflict("a committee with that identity already exists"); }
    return context.json({ id, event_id: eventId, name: body.name, members: [] }, 201);
  },
);

const addCommitteeReviewer = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/events/{eventId}/committees/{committeeId}/reviewers",
    operationId: "addCommitteeReviewer",
    summary: "Add a reviewer to a committee",
    tags: ["Evaluation"],
    request: { params: committeeParams, body: { content: { "application/json": { schema: memberInput } } } },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 201: ok, ...errors },
  },
  async (context) => {
    const { eventId, committeeId } = context.req.valid("param");
    requireProgram(context, eventId, true);
    await committeeForEvent(context.env.DB, eventId, committeeId);
    const body = context.req.valid("json");
    const person = await context.env.DB.prepare(`
      SELECT person.id
      FROM people person
      JOIN memberships membership
        ON membership.person_id = person.id
       AND membership.event_id = ?
       AND membership.role = 'reviewer'
      WHERE person.id = ?
    `).bind(eventId, body.person_id).first<{ id: string }>();
    if (!person) throw ApiError.notFound("reviewer not found");
    const now = Date.now();
    try {
      await context.env.DB.prepare("INSERT INTO committee_members (id, committee_id, person_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), committeeId, body.person_id, body.role, now, now).run();
    } catch { throw ApiError.conflict("reviewer is already on this committee"); }
    return context.json({ committee_id: committeeId, person_id: body.person_id, role: body.role }, 201);
  },
);

const getReviewerScopes = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/events/{eventId}/committees/{committeeId}/reviewers/{personId}/tracks",
    operationId: "getReviewerTrackScopes",
    summary: "Read one reviewer’s conference track responsibilities",
    tags: ["Evaluation"],
    request: { params: reviewerScopeParams },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "read" }, concurrency: "none" },
    responses: { 200: ok, ...errors },
  },
  async (context) => {
    const { eventId, committeeId, personId } = context.req.valid("param");
    requireProgram(context, eventId, false);
    await committeeForEvent(context.env.DB, eventId, committeeId);
    const result = await context.env.DB.prepare(`
      SELECT track.id, track.name, track.color
      FROM reviewer_track_scopes scope
      JOIN tracks track ON track.id = scope.track_id
      WHERE scope.event_id = ? AND scope.person_id = ?
      ORDER BY track.position, track.id
    `).bind(eventId, personId).all<Record<string, string>>();
    return context.json({ data: result.results }, 200);
  },
);

const replaceReviewerScopes = defineApiRoute(
  {
    method: "put",
    path: "/api/v1/events/{eventId}/committees/{committeeId}/reviewers/{personId}/tracks",
    operationId: "replaceReviewerTrackScopes",
    summary: "Edit one reviewer’s conference track responsibilities",
    tags: ["Evaluation"],
    request: { params: reviewerScopeParams, body: { content: { "application/json": { schema: scopeInput } } } },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 200: ok, ...errors },
  },
  async (context) => {
    const { eventId, committeeId, personId } = context.req.valid("param");
    requireProgram(context, eventId, true);
    await committeeForEvent(context.env.DB, eventId, committeeId);
    const body = context.req.valid("json");
    const membership = await context.env.DB.prepare("SELECT 1 AS present FROM committee_members WHERE committee_id = ? AND person_id = ?").bind(committeeId, personId).first<{ present: number }>();
    if (!membership) throw ApiError.notFound("reviewer is not on this committee");
    const trackIds = [...new Set(body.track_ids)];
    if (trackIds.length !== body.track_ids.length) throw ApiError.unprocessable("reviewer responsibilities must be unique", "track_ids");
    const placeholders = trackIds.map(() => "?").join(", ");
    const tracks = await context.env.DB.prepare(`SELECT id FROM tracks WHERE event_id = ? AND id IN (${placeholders})`).bind(eventId, ...trackIds).all<{ id: string }>();
    if (tracks.results.length !== trackIds.length) throw ApiError.unprocessable("every reviewer responsibility must belong to this conference", "track_ids");
    const now = Date.now();
    const statements = [context.env.DB.prepare("DELETE FROM reviewer_track_scopes WHERE event_id = ? AND person_id = ?").bind(eventId, personId)];
    for (const trackId of trackIds) statements.push(context.env.DB.prepare("INSERT INTO reviewer_track_scopes (id, event_id, person_id, track_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), eventId, personId, trackId, now, now));
    await context.env.DB.batch(statements);
    return context.json({ event_id: eventId, person_id: personId, track_ids: trackIds, completed_reviews_preserved: true }, 200);
  },
);

const distributeAssignments = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/events/{eventId}/rounds/{roundId}/assignments",
    operationId: "distributeEvaluationAssignments",
    summary: "Distribute a round to a committee",
    tags: ["Evaluation"],
    request: { params: roundParams, body: { content: { "application/json": { schema: assignmentsInput } } } },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 200: ok, ...errors },
  },
  async (context) => {
    const { eventId, roundId } = context.req.valid("param");
    requireProgram(context, eventId, true);
    const round = await roundForEvent(context.env.DB, eventId, roundId);
    const plan = await planForEvent(context.env.DB, eventId, round.plan_id);
    if (plan.status !== "open") throw ApiError.conflict("reviewers can only be assigned to an open evaluation plan");
    const body = context.req.valid("json");
    await committeeForEvent(context.env.DB, eventId, body.committee_id);
    const committeeReviewers = await reviewersForCommittee(context.env.DB, body.committee_id);
    const reviewers = body.reviewer_person_ids
      ? committeeReviewers.filter((reviewer) => body.reviewer_person_ids?.includes(reviewer.id))
      : committeeReviewers;
    if (!reviewers.length) throw ApiError.unprocessable("the committee needs at least one reviewer", "reviewer_person_ids");
    const submissions = body.submission_ids
      ? (await context.env.DB.prepare(`SELECT id FROM submissions WHERE event_id = ? AND id IN (${body.submission_ids.map(() => "?").join(", ")})`).bind(eventId, ...body.submission_ids).all<{ id: string }>()).results
      : (await context.env.DB.prepare("SELECT id FROM submissions WHERE event_id = ? AND status IN ('submitted', 'in_review') AND bypass_evaluation = 0 ORDER BY updated_at, id").bind(eventId).all<{ id: string }>()).results;
    if (submissions.length !== (body.submission_ids?.length ?? submissions.length)) throw ApiError.notFound("one or more submissions are not in this conference");
    const target = body.reviewers_per_submission ?? round.target_reviews_per_submission;
    if (body.mode === "n_per_submission" && target > reviewers.length) throw ApiError.unprocessable("the requested reviewer target exceeds the committee size", "reviewers_per_submission");
    const pairs: Array<[string, string]> = [];
    for (const [submissionIndex, submission] of submissions.entries()) {
      const chosen = body.mode === "everyone"
        ? reviewers
        : Array.from({ length: target }, (_, offset) => reviewers[(submissionIndex + offset) % reviewers.length]!);
      for (const reviewer of chosen) pairs.push([submission.id, reviewer.id]);
    }
    const now = Date.now();
    const statements = pairs.map(([submissionId, reviewerId]) => context.env.DB.prepare(
      "INSERT OR IGNORE INTO round_assignments (id, round_id, submission_id, reviewer_person_id, committee_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, 'assigned', ?, ?)",
    ).bind(crypto.randomUUID(), roundId, submissionId, reviewerId, now, now));
    if (statements.length) await context.env.DB.batch(statements);
    return context.json({ mode: body.mode, requested: pairs.length, assignments: pairs.length, reviewers: reviewers.map((reviewer) => reviewer.id), submissions: submissions.length }, 200);
  },
);

const promoteRound = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/events/{eventId}/rounds/{roundId}/promote",
    operationId: "promoteEvaluationSubmissions",
    summary: "Preview or promote submissions into the next evaluation round",
    tags: ["Evaluation"],
    request: { params: roundParams, body: { content: { "application/json": { schema: promoteInput } } } },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 200: ok, ...errors },
  },
  async (context) => {
    const { eventId, roundId } = context.req.valid("param");
    requireProgram(context, eventId, true);
    const sourceRound = await roundForEvent(context.env.DB, eventId, roundId);
    const nextRound = await context.env.DB.prepare(`
      SELECT next_round.id
      FROM evaluation_rounds next_round
      WHERE next_round.plan_id = ? AND next_round.position = ?
    `).bind(sourceRound.plan_id, sourceRound.position + 1).first<{ id: string }>();
    if (!nextRound) throw ApiError.conflict("the first round must exist before promotion can be planned");
    const body = context.req.valid("json");
    const rows = body.submission_ids.length === 0
      ? await context.env.DB.prepare("SELECT id FROM submissions WHERE event_id = ? AND status = 'in_review' ORDER BY updated_at, id").bind(eventId).all<{ id: string }>()
      : await context.env.DB.prepare(`SELECT id FROM submissions WHERE event_id = ? AND id IN (${body.submission_ids.map(() => "?").join(", ")})`).bind(eventId, ...body.submission_ids).all<{ id: string }>();
    if (body.submission_ids.length > 0 && rows.results.length !== new Set(body.submission_ids).size) throw ApiError.notFound("one or more promotion records are not in this conference");
    if (!body.preview && rows.results.length === 0) throw ApiError.unprocessable("promotion requires at least one filtered submission", "submission_ids");
    if (body.preview) return context.json({ preview: true, promoted: rows.results.length, assignments: rows.results.length * sourceRound.target_reviews_per_submission, from_round_id: roundId, to_round_id: nextRound.id }, 200);
    const principal = context.get("principal");
    const promotedBy = principal.kind === "session" ? principal.personId : "system";
    if (promotedBy === "system") throw ApiError.forbidden("a session is required to apply promotions");
    const now = Date.now();
    const statements = rows.results.map((row) => context.env.DB.prepare(
      "INSERT OR IGNORE INTO round_promotions (id, from_round_id, to_round_id, submission_id, promoted_at, promoted_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(crypto.randomUUID(), roundId, nextRound.id, row.id, now, promotedBy, now, now));
    await context.env.DB.batch(statements);
    return context.json({ preview: false, promoted: rows.results.length, from_round_id: roundId, to_round_id: nextRound.id }, 200);
  },
);

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
    await roundForEvent(context.env.DB, eventId, roundId);
    const principal = context.get("principal");
    const ids = await reviewerQueue(context.env.DB, principal, eventId, roundId);
    const data = [];
    for (const submissionId of ids) {
      await authorizeReviewerScope({ db: context.env.DB, principal, eventId, roundId, submissionId, operation: "queue" });
      const row = await context.env.DB.prepare(`
        SELECT submission.id, submission.title, submission.abstract,
          COALESCE((SELECT json_group_array(json_object('id', track.id, 'name', track.name, 'color', track.color)) FROM submission_tracks carried JOIN tracks track ON track.id = carried.track_id WHERE carried.submission_id = submission.id), '[]') AS tracks
        FROM submissions submission
        WHERE submission.id = ? AND submission.event_id = ?
      `).bind(submissionId, eventId).first<{ id: string; title: string; abstract: string | null; tracks: string }>();
      if (row) data.push({ ...row, tracks: JSON.parse(row.tracks) as unknown[] });
    }
    return context.json({ data, remaining: data.length, total: data.length }, 200);
  },
);

const reviewerRecordRoute = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/events/{eventId}/rounds/{roundId}/submissions/{submissionId}",
    operationId: "getReviewerSubmission",
    summary: "Read an evaluator-visible submission without identity fields",
    tags: ["Reviewer"],
    request: { params: reviewerSubmissionParams },
    policy: { auth: { kind: "grants", grants: ["review:write"] }, rateLimit: { bucket: "read" }, concurrency: "none" },
    responses: { 200: ok, ...errors },
  },
  async (context) => {
    const { eventId, roundId, submissionId } = context.req.valid("param");
    const principal = context.get("principal");
    await authorizeReviewerScope({ db: context.env.DB, principal, eventId, roundId, submissionId, operation: "record" });
    const row = await context.env.DB.prepare(`
      SELECT submission.id, submission.kind, submission.title, submission.abstract,
        COALESCE((SELECT json_group_array(json_object('id', track.id, 'name', track.name, 'color', track.color)) FROM submission_tracks carried JOIN tracks track ON track.id = carried.track_id WHERE carried.submission_id = submission.id), '[]') AS tracks,
        COALESCE((SELECT json_group_array(json_object('field_id', answer.field_id, 'value_text', answer.value_text, 'value_json', answer.value_json)) FROM submission_answers answer WHERE answer.submission_id = submission.id), '[]') AS answers
      FROM submissions submission
      WHERE submission.id = ? AND submission.event_id = ?
    `).bind(submissionId, eventId).first<{ id: string; kind: string; title: string; abstract: string | null; tracks: string; answers: string }>();
    if (!row) throw ApiError.forbidden("reviewer resource is outside your authorized tracks");
    return context.json({ ...row, tracks: JSON.parse(row.tracks) as unknown[], answers: JSON.parse(row.answers) as unknown[] }, 200);
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
    summary: "Export the authorized reviewer queue",
    tags: ["Reviewer"],
    request: { params: roundParams },
    policy: { auth: { kind: "grants", grants: ["review:write"] }, rateLimit: { bucket: "read" }, concurrency: "none" },
    responses: { 200: { content: { "text/csv": { schema: z.string() } }, description: "Authorized reviewer CSV" }, ...errors },
  },
  async (context) => {
    const { eventId, roundId } = context.req.valid("param");
    const principal = context.get("principal");
    const ids = await reviewerQueue(context.env.DB, principal, eventId, roundId);
    const lines = ["submission_id,title,abstract"];
    for (const submissionId of ids) {
      await authorizeReviewerScope({ db: context.env.DB, principal, eventId, roundId, submissionId, operation: "export" });
      const row = await context.env.DB.prepare("SELECT id, title, abstract FROM submissions WHERE id = ? AND event_id = ?").bind(submissionId, eventId).first<{ id: string; title: string; abstract: string | null }>();
      if (row) lines.push([row.id, row.title, row.abstract ?? ""].map(csv).join(","));
    }
    return new Response(`${lines.join("\n")}\n`, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=review-queue.csv" } });
  },
);

function csv(value: string): string {
  return `"${value.replaceAll('"', '""').replaceAll("\n", " ")}"`;
}

const writeEvaluationRoute = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/events/{eventId}/rounds/{roundId}/submissions/{submissionId}/evaluations",
    operationId: "writeReviewerEvaluation",
    summary: "Save an authorized reviewer recommendation",
    tags: ["Reviewer"],
    request: { params: roundParams.extend({ submissionId: z.string().min(1) }), body: { content: { "application/json": { schema: evaluationInput } } } },
    policy: { auth: { kind: "grants", grants: ["review:write"] }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 200: ok, ...errors },
  },
  async (context) => {
    const { eventId, roundId, submissionId } = context.req.valid("param");
    const principal = context.get("principal");
    const authorization = await authorizeReviewerScope({ db: context.env.DB, principal, eventId, roundId, submissionId, operation: "evaluation-write" });
    const body = context.req.valid("json");
    const now = Date.now();
    await context.env.DB.prepare(`
      INSERT INTO evaluations (id, round_id, submission_id, reviewer_person_id, recommendation, score, criteria_scores, comment, abstained, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
      ON CONFLICT(round_id, submission_id, reviewer_person_id) DO UPDATE SET
        recommendation = excluded.recommendation,
        score = excluded.score,
        criteria_scores = excluded.criteria_scores,
        comment = excluded.comment,
        updated_at = excluded.updated_at
    `).bind(
      crypto.randomUUID(), roundId, submissionId, authorization.personId, body.recommendation, body.score ?? null,
      body.criteria_scores === undefined || body.criteria_scores === null ? null : JSON.stringify(body.criteria_scores), body.comment, now, now,
    ).run();
    await context.env.DB.prepare("UPDATE round_assignments SET status = 'complete', updated_at = ? WHERE round_id = ? AND submission_id = ? AND reviewer_person_id = ?").bind(now, roundId, submissionId, authorization.personId).run();
    return context.json({ recommendation: body.recommendation, score: body.score ?? null, lifecycle_status_changed: false, saved_at: now }, 200);
  },
);

export const apiRoutes = [
  listPlans,
  createPlan,
  getPlan,
  updatePlan,
  addRound,
  replaceCriteria,
  createCommittee,
  addCommitteeReviewer,
  getReviewerScopes,
  replaceReviewerScopes,
  distributeAssignments,
  promoteRound,
  reviewerQueueRoute,
  reviewerRecordRoute,
  reviewerFilesRoute,
  reviewerExportRoute,
  writeEvaluationRoute,
];
