import { z } from "@hono/zod-openapi";

import { BULK_ID_LIMIT, bulkSelectorWireSchema, normalizeBulkSelector, runBulkByIds } from "../api/bulk";
import { ApiError } from "../api/errors";
import { newUlid } from "../api/ids";
import { defineApiRoute, errorResponses, jsonResponse, type ApiRouteEntry } from "../api/route";
import { demoMailWouldBeSuppressed, enqueueMailMessage } from "../jobs/mail/consumer";
import { auditStatement } from "../lib/audit";
import { enqueueAuthMail, renderMagicLinkLoginMail } from "../lib/auth/auth-mail";
import { getAuth } from "../lib/auth/auth-middleware";
import { mintMagicLink } from "../lib/auth/magic-links";
import { authHasRole, tokenHasGrant } from "../lib/auth/scope-resolution";
import { mintToken, sha256Hex } from "../lib/auth/random-token";
import { comparisonWinCounts, validateComparisonRanking } from "../lib/evaluation-comparisons";
import { enqueueOutbox } from "../jobs/mail/outbox";
import { IDEMPOTENCY_REGISTRY } from "../jobs/mail/idempotency";
import { mergeDataForReviewerReminder } from "../jobs/mail/merge-data";
import { allocateAssignments, type AllocationSubmission } from "../lib/assignment-allocation";
import { errorFields } from "../lib/observability/log";
import { reviewerCanBeAssignedToSubmission } from "../lib/reviewer-scope";
import { parseCriterionOptions } from "../lib/rubric-criteria";
import { selectSubmissionIds, submissionFilterSchema } from "./submissions.queries";

const eventParams = z.object({ eventId: z.string().min(1) });
const planParams = eventParams.extend({ planId: z.string().min(1) });
const roundParams = eventParams.extend({ roundId: z.string().min(1) });
const criterionParams = roundParams.extend({ criterionId: z.string().min(1) });
const committeeParams = eventParams.extend({ committeeId: z.string().min(1) });
const reviewerScopeParams = committeeParams.extend({ personId: z.string().min(1) });

const roundMode = z.enum(["scorecard", "comparison"]);
const assignmentMode = z.enum(["everyone", "n_per_submission"]);

const criterionKind = z.enum(["numeric", "select", "text"]);

/**
 * A criterion is a scorecard field, not just a weighted number. Numeric criteria
 * carry a scale and a weight; select criteria carry their choices; text criteria
 * carry neither. Weights stay a numeric-only concept — see `normalizeCriteria`,
 * which zeroes the others rather than rejecting them, so an organizer never has
 * to learn a rule the product invented.
 */
const criterionInput = z.object({
  id: z.string().min(1).optional(),
  kind: criterionKind.default("numeric"),
  name: z.string().trim().min(1).max(160),
  options: z.array(z.string().trim().min(1).max(160)).max(20).optional(),
  position: z.number().int().min(0),
  scale_max: z.number().nullable().optional(),
  scale_min: z.number().nullable().optional(),
  weight_pct: z.number().min(0).max(100),
});

type CriterionInput = z.infer<typeof criterionInput>;

interface NormalizedCriterion {
  id?: string;
  kind: "numeric" | "select" | "text";
  name: string;
  options: string | null;
  position: number;
  scale_max: number | null;
  scale_min: number | null;
  weight_pct: number;
}

/**
 * Non-numeric criteria hold no weight, so the total-100 rule stays about ratings,
 * and the shape each kind may carry is enforced here rather than left to the
 * caller: a dropdown without choices renders as an empty control on the reviewer
 * side, which looks like the product losing the organizer's work.
 */
function normalizeCriteria(criteria: ReadonlyArray<CriterionInput>): NormalizedCriterion[] {
  const positions = criteria.map((criterion) => criterion.position);
  if (new Set(positions).size !== positions.length) {
    // The round/position pair is unique, so duplicates fail inside batch() as an
    // opaque conflict. Name the problem instead.
    throw ApiError.unprocessable("each criterion needs its own position", "position");
  }
  return criteria.map((criterion) => {
    const options = criterion.options ?? [];
    if (criterion.kind === "select" && options.length === 0) {
      throw ApiError.unprocessable("a dropdown criterion needs at least one option", "options", { criterion: criterion.name });
    }
    if (criterion.kind !== "select" && options.length > 0) {
      throw ApiError.unprocessable("only a dropdown criterion carries options", "options", { criterion: criterion.name });
    }
    const min = criterion.scale_min ?? null;
    const max = criterion.scale_max ?? null;
    if (criterion.kind === "numeric" && min !== null && max !== null && min >= max) {
      throw ApiError.unprocessable("a rating scale must end above where it starts", "scale_max", { criterion: criterion.name });
    }
    return {
      id: criterion.id,
      kind: criterion.kind,
      name: criterion.name,
      options: criterion.kind === "select" ? JSON.stringify(options) : null,
      position: criterion.position,
      scale_max: criterion.kind === "numeric" ? max : null,
      scale_min: criterion.kind === "numeric" ? min : null,
      weight_pct: criterion.kind === "numeric" ? criterion.weight_pct : 0,
    };
  });
}

const roundInput = z.object({
  anonymized: z.boolean().default(false),
  committee_id: z.string().min(1).nullable().optional(),
  closes_at: z.number().int().nullable().optional(),
  criteria: z.array(criterionInput).optional(),
  mode: roundMode.default("scorecard"),
  name: z.string().trim().min(1).max(160),
  opens_at: z.number().int().nullable().optional(),
  position: z.number().int().min(0).max(1).optional(),
  target_reviews_per_submission: z.number().int().positive().default(3),
});

/** Round PATCH deliberately omits position and criteria: evidence survives settings edits. */
const roundPatch = z.object({
  anonymized: z.boolean().optional(),
  committee_id: z.string().min(1).nullable().optional(),
  closes_at: z.number().int().nullable().optional(),
  mode: roundMode.optional(),
  name: z.string().trim().min(1).max(160).optional(),
  opens_at: z.number().int().nullable().optional(),
  target_reviews_per_submission: z.number().int().positive().optional(),
}).strict();

const planInput = z.object({
  instructions: z.string().max(50_000).default(""),
  name: z.string().trim().min(1).max(200),
  rounds: z.array(roundInput).max(2).optional(),
  scale_max: z.number().nullable().optional(),
  scale_min: z.number().nullable().optional(),
  status: z.enum(["draft", "open", "closed"]).default("draft"),
});

const planPatch = planInput.partial();
const criteriaInput = z.object({ criteria: z.array(criterionInput).max(40) });
const committeeInput = z.object({ name: z.string().trim().min(1).max(160) });
const memberInput = z.object({ person_id: z.string().min(1), role: z.string().trim().min(1).max(80).default("reviewer") });
const scopeInput = z.object({ track_ids: z.array(z.string().min(1)).min(1) });
/**
 * An invited reviewer arrives with responsibilities or not at all: a reviewer
 * with no track scope passes every membership check and is still silently
 * unassignable (`reviewer-scope.ts` requires track intersection AND assignment).
 */
const inviteInput = z.object({
  name: z.string().trim().min(1).max(160),
  email: z.string().trim().min(3).max(320),
  title: z.string().trim().max(160).optional(),
  company: z.string().trim().max(160).optional(),
  track_ids: z.array(z.string().min(1)).min(1).max(50),
});
const agentSeatInput = z.object({
  name: z.string().trim().min(1).max(160),
  track_ids: z.array(z.string().min(1)).min(1).max(50),
});
const distributionAssignmentsInput = z.object({
  committee_id: z.string().min(1).optional(),
  mode: assignmentMode,
  reviewer_person_ids: z.array(z.string().min(1)).min(1).optional(),
  submission_ids: z.array(z.string().min(1)).min(1).optional(),
  reviewers_per_submission: z.number().int().positive().max(100).optional(),
  /** A ceiling on what any one reviewer ends up holding in this round. */
  max_per_reviewer: z.number().int().positive().max(10_000).optional(),
});
const directAssignmentInput = z.object({
  submission_id: z.string().min(1),
  reviewer_person_id: z.string().min(1),
});
const assignmentsInput = z.union([distributionAssignmentsInput, directAssignmentInput]);
const assignmentListQuery = z.object({ submission_id: z.string().min(1).optional(), summary: z.enum(["0", "1"]).default("0") });
const promotionSelector = bulkSelectorWireSchema(submissionFilterSchema, z.string().min(1));
const promoteInput = z.object({
  preview: z.boolean().default(true),
  selector: promotionSelector.optional(),
  /** Legacy input is retained only to return a safe no-op for `{}`/`[]`. */
  submission_ids: z.array(z.string().min(1)).max(BULK_ID_LIMIT).optional(),
}).strict();

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
  committee_id: string | null;
  closes_at: number | null;
  id: string;
  mode: "scorecard" | "comparison";
  name: string;
  opens_at: number | null;
  plan_id: string;
  position: number;
  target_reviews_per_submission: number;
  timezone: string;
}

interface CriterionRow {
  id: string;
  kind: "numeric" | "select" | "text";
  name: string;
  options: string | null;
  position: number;
  round_id: string;
  scale_max: number | null;
  scale_min: number | null;
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
  kind: "human" | "agent";
  name: string;
}

export function requireProgram(
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
  const grant = write ? "program:write" : "program:read";
  if (!tokenHasGrant(auth, grant, eventId)) {
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
      round.anonymized, round.committee_id, round.target_reviews_per_submission, round.opens_at, round.closes_at,
      event.timezone
    FROM evaluation_rounds round
    JOIN evaluation_plans plan ON plan.id = round.plan_id
    JOIN events event ON event.id = plan.event_id
    WHERE round.id = ? AND plan.event_id = ?
  `).bind(roundId, eventId).first<RoundRow>();
  if (!round) throw ApiError.notFound("evaluation round not found");
  return round;
}

function localDayKey(timestamp: number, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { day: "2-digit", month: "2-digit", timeZone: timezone, year: "numeric" }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function publicRound(round: RoundRow): Omit<RoundRow, "timezone"> {
  const { timezone: _timezone, ...publicFields } = round;
  return publicFields;
}
/**
 * Weighting is a claim about ratings, so only rating criteria are counted. A
 * scorecard of one dropdown and one comment box is a real scorecard and saves
 * without a weight anywhere in it.
 */
function assertCriteriaTotal(criteria: ReadonlyArray<{ kind?: string; weight_pct: number }>): void {
  const numeric = criteria.filter((criterion) => (criterion.kind ?? "numeric") === "numeric");
  if (numeric.length === 0) return;
  const total = numeric.reduce((sum, criterion) => sum + criterion.weight_pct, 0);
  if (Math.abs(total - 100) > 0.0001) {
    throw ApiError.unprocessable("rating criteria must total exactly 100%", "criteria", { total });
  }
}

function assertTwoRounds(rounds: ReadonlyArray<{ position?: number }>): void {
  if (rounds.length > 2) throw ApiError.unprocessable("a conference evaluation plan has at most two rounds", "rounds");
  const positions = rounds.map((round, index) => round.position ?? index);
  if (new Set(positions).size !== positions.length || positions.some((position) => position < 0 || position > 1)) {
    throw ApiError.unprocessable("evaluation rounds must have unique positions 0 and 1", "rounds");
  }
}

async function criteriaForRound(db: D1Database, roundId: string): Promise<Array<Record<string, unknown>>> {
  const result = await db.prepare(
    "SELECT id, round_id, name, kind, options, scale_min, scale_max, weight_pct, position FROM rubric_criteria WHERE round_id = ? ORDER BY position, id",
  ).bind(roundId).all<CriterionRow>();
  return result.results.map((criterion) => ({ ...criterion, options: parseCriterionOptions(criterion.options) }));
}

interface EventIdentityRow {
  demo_mode: number;
  id: string;
  org_id: string;
}

async function eventIdentity(db: D1Database, eventId: string): Promise<EventIdentityRow> {
  const event = await db.prepare("SELECT id, org_id, demo_mode FROM events WHERE id = ?")
    .bind(eventId).first<EventIdentityRow>();
  if (!event) throw ApiError.notFound("conference not found");
  return event;
}

async function evaluationActor(
  context: Parameters<NonNullable<ApiRouteEntry["handler"]>>[0],
): Promise<{ kind: "user" | "api_token"; personId: string | null; requestId: string | null }> {
  const auth = getAuth(context);
  if (!auth) throw ApiError.unauthenticated();
  const requestId = context.get("requestId") ?? null;
  if (auth.kind === "session") return { kind: "user", personId: auth.personId, requestId };
  const token = await context.env.DB.prepare("SELECT created_by FROM api_tokens WHERE id = ?")
    .bind(auth.tokenId).first<{ created_by: string }>();
  return { kind: "api_token", personId: token?.created_by ?? null, requestId };
}

/** Track responsibilities are proven to belong to this conference before any write. */
async function ownedTrackIds(
  db: D1Database,
  eventId: string,
  requested: readonly string[],
): Promise<string[]> {
  const trackIds = [...new Set(requested)];
  if (trackIds.length !== requested.length) {
    throw ApiError.unprocessable("reviewer responsibilities must be unique", "track_ids");
  }
  const placeholders = trackIds.map(() => "?").join(", ");
  const tracks = await db.prepare(`SELECT id FROM tracks WHERE event_id = ? AND id IN (${placeholders})`)
    .bind(eventId, ...trackIds).all<{ id: string }>();
  if (tracks.results.length !== trackIds.length) {
    throw ApiError.unprocessable("every reviewer responsibility must belong to this conference", "track_ids");
  }
  return trackIds;
}

/** Responsibilities are replaced, never unioned: the stated scope must be the true one. */
function trackScopeStatements(
  db: D1Database,
  eventId: string,
  personId: string,
  trackIds: readonly string[],
  now: number,
): D1PreparedStatement[] {
  return [
    db.prepare("DELETE FROM reviewer_track_scopes WHERE event_id = ? AND person_id = ?").bind(eventId, personId),
    ...trackIds.map((trackId) => db.prepare(
      "INSERT INTO reviewer_track_scopes (id, event_id, person_id, track_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).bind(crypto.randomUUID(), eventId, personId, trackId, now, now)),
  ];
}

/**
 * Both idempotent inserts are guarded in SQL rather than by a preceding SELECT:
 * `uq_memberships_event` and `uq_committee_members_committee_person` would abort
 * the whole provisioning batch if a concurrent invite won the race.
 */
function reviewerMembershipStatement(
  db: D1Database,
  orgId: string,
  eventId: string,
  personId: string,
  now: number,
): D1PreparedStatement {
  return db.prepare(`
    INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at)
    SELECT ?, ?, ?, ?, 'reviewer', ?, ?
    WHERE NOT EXISTS (
      SELECT 1 FROM memberships WHERE event_id = ? AND person_id = ? AND role = 'reviewer'
    )
  `).bind(newUlid(now), orgId, eventId, personId, now, now, eventId, personId);
}

function committeeMemberStatement(
  db: D1Database,
  committeeId: string,
  personId: string,
  role: string,
  now: number,
): D1PreparedStatement {
  return db.prepare(`
    INSERT INTO committee_members (id, committee_id, person_id, role, created_at, updated_at)
    SELECT ?, ?, ?, ?, ?, ?
    WHERE NOT EXISTS (
      SELECT 1 FROM committee_members WHERE committee_id = ? AND person_id = ?
    )
  `).bind(newUlid(now), committeeId, personId, role, now, now, committeeId, personId);
}

async function committeeForEvent(db: D1Database, eventId: string, committeeId: string, field?: string): Promise<CommitteeRow> {
  const committee = await db.prepare(
    "SELECT id, event_id, name FROM committees WHERE id = ? AND event_id = ?",
  ).bind(committeeId, eventId).first<CommitteeRow>();
  if (!committee) throw field ? ApiError.unprocessable("committee is not in this conference", field) : ApiError.notFound("committee not found");
  return committee;
}

async function reviewersForCommittee(db: D1Database, committeeId: string): Promise<PersonRow[]> {
  const result = await db.prepare(`
    SELECT person.id, person.name, person.company, person.kind
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
    "SELECT id, plan_id, position, name, mode, anonymized, committee_id, target_reviews_per_submission, opens_at, closes_at FROM evaluation_rounds WHERE plan_id = ? ORDER BY position, id",
  ).bind(plan.id).all<RoundRow>();
  const rounds = [];
  for (const round of roundsResult.results) {
    const [criteria, progress, comparisonCount, promotions] = await Promise.all([
      criteriaForRound(db, round.id),
      db.prepare(`
      SELECT
        COUNT(DISTINCT assignment.submission_id) AS assigned_submissions,
        COUNT(DISTINCT CASE WHEN evaluation.abstained = 0 THEN evaluation.submission_id END) AS reviewed_submissions,
        COUNT(DISTINCT CASE WHEN evaluation.abstained = 0 THEN evaluation.id END) AS evaluations,
        COUNT(DISTINCT CASE WHEN evaluation.abstained = 1 THEN evaluation.id END) AS recusals,
        (SELECT COUNT(*) FROM submissions submission WHERE submission.event_id = ? AND submission.status IN ('submitted', 'in_review') AND submission.bypass_evaluation = 0) AS submission_count
      FROM round_assignments assignment
      LEFT JOIN evaluations evaluation
        ON evaluation.round_id = assignment.round_id AND evaluation.submission_id = assignment.submission_id
      WHERE assignment.round_id = ?
      `).bind(eventId, round.id).first<Record<string, number>>(),
      db.prepare("SELECT COUNT(*) AS count FROM comparisons WHERE round_id = ?").bind(round.id).first<{ count: number }>(),
      db.prepare(`
        SELECT promotion.submission_id, submission.title
        FROM round_promotions promotion
        JOIN submissions submission ON submission.id = promotion.submission_id AND submission.event_id = ?
        WHERE promotion.to_round_id = ?
        ORDER BY submission.updated_at DESC, submission.id
      `).bind(eventId, round.id).all<{ submission_id: string; title: string }>(),
    ]);
    rounds.push({
      ...round,
      anonymized: Boolean(round.anonymized),
      criteria,
      progress: {
        assigned_submissions: Number(progress?.assigned_submissions ?? 0),
        evaluations: Number(progress?.evaluations ?? 0),
        reviewed_submissions: Number(progress?.reviewed_submissions ?? 0),
        submission_count: Number(progress?.submission_count ?? 0),
        comparisons: Number(comparisonCount?.count ?? 0),
        recusals: Number(progress?.recusals ?? 0),
      },
      promotions: promotions.results,
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
        "SELECT COUNT(*) AS count FROM evaluations evaluation JOIN evaluation_rounds round ON round.id = evaluation.round_id WHERE round.plan_id = ? AND evaluation.reviewer_person_id = ? AND evaluation.abstained = 0",
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
    SELECT COUNT(CASE WHEN evaluation.abstained = 0 THEN evaluation.id END) AS evaluations,
      COUNT(CASE WHEN evaluation.abstained = 1 THEN evaluation.id END) AS recusals,
      COUNT(DISTINCT CASE WHEN evaluation.abstained = 0 THEN evaluation.submission_id END) AS submissions_with_reviews,
      -- A chair's override governs the score everywhere it is read, this
      -- summary included. Reading the raw column here would headline a number
      -- the register, the results table, the export and the record have all
      -- already superseded.
      MAX(CASE WHEN evaluation.abstained = 0 THEN COALESCE(evaluation.override_score, evaluation.score) END) AS highest_score,
      COUNT(DISTINCT CASE WHEN evaluation.abstained = 0 AND COALESCE(evaluation.override_score, evaluation.score) IS NOT NULL AND COALESCE(evaluation.override_score, evaluation.score) != (
        SELECT AVG(COALESCE(other.override_score, other.score))
        FROM evaluations other
        JOIN people other_reviewer ON other_reviewer.id = other.reviewer_person_id AND other_reviewer.kind = 'human'
        WHERE other.round_id = evaluation.round_id AND other.abstained = 0 AND COALESCE(other.override_score, other.score) IS NOT NULL
      ) THEN evaluation.submission_id END) AS wide_spread
    FROM evaluations evaluation
    JOIN evaluation_rounds round ON round.id = evaluation.round_id
    JOIN people reviewer ON reviewer.id = evaluation.reviewer_person_id AND reviewer.kind = 'human'
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
      recusals: Number(summary?.recusals ?? 0),
    },
  };
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
      if (round.committee_id) await committeeForEvent(context.env.DB, eventId, round.committee_id, "committee_id");
      const roundId = crypto.randomUUID();
      const position = round.position ?? index;
      statements.push(context.env.DB.prepare(
        "INSERT INTO evaluation_rounds (id, plan_id, position, name, mode, anonymized, committee_id, target_reviews_per_submission, opens_at, closes_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).bind(roundId, planId, position, round.name, round.mode, round.anonymized ? 1 : 0, round.committee_id ?? null, round.target_reviews_per_submission, round.opens_at ?? null, round.closes_at ?? null, now, now));
      for (const criterion of normalizeCriteria(round.criteria ?? [])) {
        statements.push(context.env.DB.prepare(
          "INSERT INTO rubric_criteria (id, round_id, name, kind, options, scale_min, scale_max, weight_pct, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ).bind(criterion.id ?? crypto.randomUUID(), roundId, criterion.name, criterion.kind, criterion.options, criterion.scale_min, criterion.scale_max, criterion.weight_pct, criterion.position, now, now));
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
    if (body.committee_id) await committeeForEvent(context.env.DB, eventId, body.committee_id, "committee_id");
    if (body.criteria) assertCriteriaTotal(body.criteria);
    const count = await context.env.DB.prepare("SELECT COUNT(*) AS count FROM evaluation_rounds WHERE plan_id = ?").bind(planId).first<{ count: number }>();
    if (Number(count?.count ?? 0) >= 2) throw ApiError.unprocessable("an evaluation plan has exactly one or two rounds", "position");
    const last = await context.env.DB.prepare("SELECT MAX(position) AS position FROM evaluation_rounds WHERE plan_id = ?").bind(planId).first<{ position: number | null }>();
    const position = body.position ?? (last?.position === null || last?.position === undefined ? 0 : Number(last.position) + 1);
    if (position > 1) throw ApiError.unprocessable("evaluation rounds must be ordered as round 1 or round 2", "position");
    const now = Date.now();
    const roundId = crypto.randomUUID();
    const statements = [context.env.DB.prepare(
      "INSERT INTO evaluation_rounds (id, plan_id, position, name, mode, anonymized, committee_id, target_reviews_per_submission, opens_at, closes_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(roundId, planId, position, body.name, body.mode, body.anonymized ? 1 : 0, body.committee_id ?? null, body.target_reviews_per_submission, body.opens_at ?? null, body.closes_at ?? null, now, now)];
    for (const criterion of normalizeCriteria(body.criteria ?? [])) statements.push(context.env.DB.prepare(
      "INSERT INTO rubric_criteria (id, round_id, name, kind, options, scale_min, scale_max, weight_pct, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(criterion.id ?? crypto.randomUUID(), roundId, criterion.name, criterion.kind, criterion.options, criterion.scale_min, criterion.scale_max, criterion.weight_pct, criterion.position, now, now));
    try { await context.env.DB.batch(statements); } catch { throw ApiError.conflict("that evaluation round position is already in use"); }
    return context.json(await planDetail(context.env.DB, eventId, planId), 201);
  },
);

const updateRound = defineApiRoute(
  {
    method: "patch",
    path: "/api/v1/events/{eventId}/rounds/{roundId}",
    operationId: "updateEvaluationRound",
    summary: "Edit an evaluation round's settings",
    description: "Update mode and other round settings without changing its ordered position or recorded evidence.",
    tags: ["Evaluation"],
    request: { params: roundParams, body: { content: { "application/json": { schema: roundPatch } } } },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 200: ok, ...errors },
  },
  async (context) => {
    const { eventId, roundId } = context.req.valid("param");
    requireProgram(context, eventId, true);
    const current = await roundForEvent(context.env.DB, eventId, roundId);
    const body = context.req.valid("json");
    if (body.committee_id) await committeeForEvent(context.env.DB, eventId, body.committee_id, "committee_id");
    const opensAt = body.opens_at === undefined ? current.opens_at : body.opens_at;
    const closesAt = body.closes_at === undefined ? current.closes_at : body.closes_at;
    if (opensAt !== null && closesAt !== null && opensAt !== undefined && closesAt !== undefined && opensAt > closesAt) {
      throw ApiError.unprocessable("a round cannot close before it opens", "closes_at");
    }
    const updates: string[] = [];
    const values: Array<string | number | null> = [];
    if (body.name !== undefined) { updates.push("name = ?"); values.push(body.name); }
    if (body.mode !== undefined) { updates.push("mode = ?"); values.push(body.mode); }
    if (body.anonymized !== undefined) { updates.push("anonymized = ?"); values.push(body.anonymized ? 1 : 0); }
    if (body.target_reviews_per_submission !== undefined) {
      updates.push("target_reviews_per_submission = ?");
      values.push(body.target_reviews_per_submission);
    }
    if (body.opens_at !== undefined) { updates.push("opens_at = ?"); values.push(body.opens_at); }
    if (body.closes_at !== undefined) { updates.push("closes_at = ?"); values.push(body.closes_at); }
    if (body.committee_id !== undefined) { updates.push("committee_id = ?"); values.push(body.committee_id); }
    updates.push("updated_at = ?");
    values.push(Date.now(), roundId, eventId);
    await context.env.DB.prepare(`
      UPDATE evaluation_rounds
      SET ${updates.join(", ")}
      WHERE id = ? AND plan_id = (
        SELECT plan.id FROM evaluation_plans plan WHERE plan.id = evaluation_rounds.plan_id AND plan.event_id = ?
      )
    `).bind(...values).run();
    return context.json({ round: publicRound(await roundForEvent(context.env.DB, eventId, roundId)), evidence_preserved: true }, 200);
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
    for (const criterion of normalizeCriteria(body.criteria)) statements.push(context.env.DB.prepare(
      "INSERT INTO rubric_criteria (id, round_id, name, kind, options, scale_min, scale_max, weight_pct, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(criterion.id ?? crypto.randomUUID(), roundId, criterion.name, criterion.kind, criterion.options, criterion.scale_min, criterion.scale_max, criterion.weight_pct, criterion.position, now, now));
    await context.env.DB.batch(statements);
    return context.json({ round: publicRound(round), criteria: await criteriaForRound(context.env.DB, roundId) }, 200);
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
      await context.env.DB.batch([
        context.env.DB.prepare("INSERT INTO committees (id, event_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").bind(id, eventId, body.name, now, now),
        context.env.DB.prepare(`
          UPDATE evaluation_rounds
          SET committee_id = ?, updated_at = ?
          WHERE committee_id IS NULL
            AND plan_id IN (SELECT id FROM evaluation_plans WHERE event_id = ?)
        `).bind(id, now, eventId),
      ]);
    } catch { throw ApiError.conflict("a committee with that identity already exists"); }
    const attachedRounds = await context.env.DB.prepare(`
      SELECT round.id, round.name, round.position
      FROM evaluation_rounds round
      JOIN evaluation_plans plan ON plan.id = round.plan_id
      WHERE plan.event_id = ? AND round.committee_id = ?
      ORDER BY round.position, round.id
    `).bind(eventId, id).all<{ id: string; name: string; position: number }>();
    return context.json({ id, event_id: eventId, name: body.name, members: [], attached_rounds: attachedRounds.results }, 201);
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
    const event = await eventIdentity(context.env.DB, eventId);
    await committeeForEvent(context.env.DB, eventId, committeeId);
    const body = context.req.valid("json");
    /**
     * Membership is granted here rather than demanded. Requiring a reviewer
     * membership the product had no runtime writer for made this route refuse
     * every person an organizer could actually pick.
     */
    const person = await context.env.DB.prepare(
      "SELECT person.id, person.kind FROM people person WHERE person.id = ? AND person.org_id = ?",
    ).bind(body.person_id, event.org_id).first<{ id: string; kind: "human" | "agent" }>();
    if (!person) throw ApiError.notFound("person not found");
    if (person.kind === "agent" && body.role !== "reviewer") {
      throw ApiError.unprocessable("an Agent evaluator seat may only hold a reviewer committee role", "role");
    }
    const alreadyOnCommittee = await context.env.DB.prepare(
      "SELECT 1 AS present FROM committee_members WHERE committee_id = ? AND person_id = ?",
    ).bind(committeeId, body.person_id).first<{ present: number }>();
    if (alreadyOnCommittee) throw ApiError.conflict("reviewer is already on this committee");
    const now = Date.now();
    const actor = await evaluationActor(context);
    await context.env.DB.batch([
      reviewerMembershipStatement(context.env.DB, event.org_id, eventId, body.person_id, now),
      committeeMemberStatement(context.env.DB, committeeId, body.person_id, body.role, now),
      auditStatement(context.env.DB, {
        eventId,
        actorKind: actor.kind,
        actorPersonId: actor.personId,
        action: "reviewer_added_to_committee",
        entityType: "person",
        entityId: body.person_id,
        after: { committee_id: committeeId, role: body.role },
        now,
        requestId: actor.requestId,
      }),
    ]);
    return context.json({ committee_id: committeeId, person_id: body.person_id, role: body.role }, 201);
  },
);

/**
 * Reviewer provisioning in one transaction (MRQ-107, eval §T-A).
 *
 * Four rows have to exist before a reviewer can see a single abstract: the
 * person, an event-scoped `reviewer` membership, a committee seat, and at least
 * one track responsibility. Three of those had no runtime writer at all, so an
 * organizer literally could not add a committee member without a database
 * client. They are written together because any subset is a lie: a person with
 * no scope holds a reviewer badge and an empty queue forever.
 */
const inviteCommitteeReviewer = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/events/{eventId}/committees/{committeeId}/invites",
    operationId: "inviteCommitteeReviewer",
    summary: "Invite a reviewer onto a committee with track responsibilities",
    description:
      "Creates the person, the reviewer membership, the committee seat, and the track responsibilities together, then sends a sign-in link. The responsibilities named here replace the reviewer's existing ones for this conference. Demo conferences also return that link on screen.",
    tags: ["Evaluation"],
    request: { params: committeeParams, body: { content: { "application/json": { schema: inviteInput } } } },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 201: ok, ...errors },
  },
  async (context) => {
    const { eventId, committeeId } = context.req.valid("param");
    requireProgram(context, eventId, true);
    const event = await eventIdentity(context.env.DB, eventId);
    await committeeForEvent(context.env.DB, eventId, committeeId);
    const body = context.req.valid("json");
    const email = body.email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      throw ApiError.unprocessable("a reviewer invitation needs an email address to send it to", "email");
    }
    const trackIds = await ownedTrackIds(context.env.DB, eventId, body.track_ids);
    const actor = await evaluationActor(context);
    const now = Date.now();

    // Matched case-insensitively: `uq_people_org_email` is case-sensitive, so a
    // case-sensitive match would invent a second identity for `Nora@` beside
    // `nora@` and mint the sign-in link for the wrong one.
    const existing = await context.env.DB.prepare(`
      SELECT id, name FROM people
      WHERE org_id = ? AND lower(email) = ?
      ORDER BY CASE WHEN email = ? THEN 0 ELSE 1 END, created_at ASC, id ASC
      LIMIT 1
    `).bind(event.org_id, email, email).first<{ id: string; name: string }>();
    /**
     * A magic link is person-scoped: exchanging one opens a session carrying
     * every membership its person holds, org-wide. So an invitation must never
     * resolve to a program-team member — otherwise "invite a reviewer" is a
     * program lead typing the owner's address and reading back an owner session.
     * The guard spans the organization for the same reason the credential does:
     * a staff role on a sibling event still opens that event through this link.
     */
    if (existing) {
      const staff = await context.env.DB.prepare(`
        SELECT 1 AS present FROM memberships
        WHERE person_id = ? AND role IN ('owner', 'program_lead', 'ops')
      `).bind(existing.id).first<{ present: number }>();
      if (staff) {
        throw ApiError.unprocessable(
          "that address belongs to a program-team member, so it cannot be given a reviewer invitation",
          "email",
        );
      }
    }
    const personId = existing?.id ?? newUlid(now);

    // `is_demo = 0` like every other runtime person writer: the flag marks the
    // shipped synthetic sample, not everyone who exists on a demo conference.
    // Flagging invitees would also let the newest invitation capture the demo
    // reviewer door, which is meant to open a seeded persona with real work.
    const statements = existing ? [] : [context.env.DB.prepare(`
      INSERT INTO people
        (id, org_id, email, name, title, company, bio, headshot_attachment_id, social_links, is_demo, last_write_source, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, '[]', 0, 'marquee', ?, ?)
    `).bind(personId, event.org_id, email, body.name, body.title ?? null, body.company ?? null, now, now)];
    statements.push(
      reviewerMembershipStatement(context.env.DB, event.org_id, eventId, personId, now),
      committeeMemberStatement(context.env.DB, committeeId, personId, "reviewer", now),
      ...trackScopeStatements(context.env.DB, eventId, personId, trackIds, now),
      auditStatement(context.env.DB, {
        eventId,
        actorKind: actor.kind,
        actorPersonId: actor.personId,
        action: "reviewer_invited",
        entityType: "person",
        entityId: personId,
        after: { committee_id: committeeId, email, name: existing?.name ?? body.name, role: "reviewer", track_ids: trackIds },
        now,
        requestId: actor.requestId,
      }),
    );
    await context.env.DB.batch(statements);

    // The credential is minted after the provisioning transaction on purpose: a
    // link that cannot be sent leaves a correctly provisioned reviewer, never a
    // half-built person. `invite_sent` reports what actually happened.
    const link = await mintMagicLink(context.env.DB, { eventId, personId, purpose: "login", redirectTo: "/reviewer", now });
    const absoluteLink = `${new URL(context.req.url).origin}/api/v1/auth/exchange?token=${link.token}`;
    // A demo conference logs mail to unlisted addresses instead of sending it,
    // so "invitation sent" has to mean sent, not enqueued.
    const inviteSuppressed = await demoMailWouldBeSuppressed(context.env.DB, eventId, email);
    let inviteQueued = true;
    try {
      const mail = renderMagicLinkLoginMail(absoluteLink);
      const outboxId = await enqueueAuthMail(context.env.DB, {
        eventId,
        personId,
        entityId: IDEMPOTENCY_REGISTRY.authLink(link.id),
        toEmail: email,
        templateKey: "magic_link_login",
        now,
        ...mail,
      });
      await enqueueMailMessage(context.env.MAIL_QUEUE, outboxId);
    } catch (error) {
      inviteQueued = false;
      context.get("logger")?.emit("worker_error", "error", {
        source: "inviteCommitteeReviewer",
        ...errorFields(error),
      });
    }

    return context.json({
      committee_id: committeeId,
      /** Sent means sent: queued, and not swallowed by demo-mail suppression. */
      invite_sent: inviteQueued && !inviteSuppressed,
      /** Distinguishes "this conference does not email that address" from a failed enqueue. */
      invite_suppressed: inviteSuppressed,
      person: { id: personId, name: existing?.name ?? body.name, email },
      person_created: !existing,
      track_ids: trackIds,
      ...(event.demo_mode === 1 ? { magic_link: absoluteLink } : {}),
    }, 201);
  },
);

const createAgentEvaluatorSeat = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/events/{eventId}/committees/{committeeId}/agent-seats",
    operationId: "createAgentEvaluatorSeat",
    summary: "Create an Agent evaluator seat",
    description:
      "Creates an Agent person, reviewer membership, committee seat, track responsibilities, and a bound review credential in one transaction. The secret is shown once.",
    tags: ["Evaluation"],
    request: { params: committeeParams, body: { content: { "application/json": { schema: agentSeatInput } } } },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 201: ok, ...errors },
  },
  async (context) => {
    const { eventId, committeeId } = context.req.valid("param");
    requireProgram(context, eventId, true);
    const event = await eventIdentity(context.env.DB, eventId);
    await committeeForEvent(context.env.DB, eventId, committeeId);
    const body = context.req.valid("json");
    const trackIds = await ownedTrackIds(context.env.DB, eventId, body.track_ids);
    const actor = await evaluationActor(context);
    const now = Date.now();
    const personId = newUlid(now);
    const tokenId = newUlid(now);
    const secret = `mq_${mintToken()}`;
    const tokenName = `Evaluator seat · ${body.name}`;
    const scopes = JSON.stringify({ permissions: ["review:write"], event_ids: [eventId] });
    const internalEmail = `agent.${personId.toLowerCase().replaceAll("_", "-")}@example.com`;
    await context.env.DB.batch([
      context.env.DB.prepare(`
        INSERT INTO people
          (id, org_id, email, name, kind, title, company, bio, headshot_attachment_id, social_links, is_demo, last_write_source, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'agent', NULL, NULL, NULL, NULL, '[]', 0, 'marquee', ?, ?)
      `).bind(personId, event.org_id, internalEmail, body.name, now, now),
      reviewerMembershipStatement(context.env.DB, event.org_id, eventId, personId, now),
      committeeMemberStatement(context.env.DB, committeeId, personId, "reviewer", now),
      ...trackScopeStatements(context.env.DB, eventId, personId, trackIds, now),
      context.env.DB.prepare(`
        INSERT INTO api_tokens
          (id, org_id, event_id, name, token_hash, prefix, scopes, created_by, acts_as_person_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(tokenId, event.org_id, eventId, tokenName, await sha256Hex(secret), secret.slice(0, 7), scopes, actor.personId, personId, now, now),
      auditStatement(context.env.DB, {
        eventId,
        actorKind: actor.kind,
        actorPersonId: actor.personId,
        action: "agent_evaluator_seat_created",
        entityType: "person",
        entityId: personId,
        after: { committee_id: committeeId, kind: "agent", name: body.name, track_ids: trackIds, token_id: tokenId },
        now,
        requestId: actor.requestId,
      }),
    ]);
    return context.json({
      committee_id: committeeId,
      person: { id: personId, kind: "agent", name: body.name },
      track_ids: trackIds,
      token: { id: tokenId, name: tokenName, secret },
    }, 201);
  },
);

/**
 * Taking a reviewer off a pool is a change to who gets *new* work.
 *
 * Their recorded evaluations and the assignments they already hold are
 * deliberately left alone: a pool is the source of future distribution, not a
 * retroactive claim about evidence. The copy on the button says exactly this,
 * so nobody removes a member expecting their reviews to vanish — or fearing
 * that they will.
 */
const removeCommitteeReviewer = defineApiRoute(
  {
    method: "delete",
    path: "/api/v1/events/{eventId}/committees/{committeeId}/reviewers/{personId}",
    operationId: "removeCommitteeReviewer",
    summary: "Remove a reviewer from a committee",
    description:
      "Removes the committee seat only. Recorded evaluations and assignments the reviewer already holds are preserved.",
    tags: ["Evaluation"],
    request: { params: reviewerScopeParams },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 200: ok, ...errors },
  },
  async (context) => {
    const { eventId, committeeId, personId } = context.req.valid("param");
    requireProgram(context, eventId, true);
    await committeeForEvent(context.env.DB, eventId, committeeId);
    const seat = await context.env.DB.prepare(
      "SELECT id FROM committee_members WHERE committee_id = ? AND person_id = ?",
    ).bind(committeeId, personId).first<{ id: string }>();
    if (!seat) throw ApiError.notFound("reviewer is not on this committee");
    const now = Date.now();
    const actor = await evaluationActor(context);
    const retained = await context.env.DB.prepare(`
      SELECT COUNT(*) AS count
      FROM round_assignments assignment
      JOIN evaluation_rounds round ON round.id = assignment.round_id
      JOIN evaluation_plans plan ON plan.id = round.plan_id AND plan.event_id = ?
      WHERE assignment.reviewer_person_id = ?
    `).bind(eventId, personId).first<{ count: number }>();
    await context.env.DB.batch([
      context.env.DB.prepare("DELETE FROM committee_members WHERE id = ?").bind(seat.id),
      auditStatement(context.env.DB, {
        eventId,
        actorKind: actor.kind,
        actorPersonId: actor.personId,
        action: "reviewer_removed_from_committee",
        entityType: "person",
        entityId: personId,
        before: { committee_id: committeeId },
        now,
        requestId: actor.requestId,
      }),
    ]);
    return context.json({
      assignments_retained: Number(retained?.count ?? 0),
      committee_id: committeeId,
      evaluations_preserved: true,
      person_id: personId,
      removed: true,
    }, 200);
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
    const trackIds = await ownedTrackIds(context.env.DB, eventId, body.track_ids);
    const now = Date.now();
    await context.env.DB.batch(trackScopeStatements(context.env.DB, eventId, personId, trackIds, now));
    return context.json({ event_id: eventId, person_id: personId, track_ids: trackIds, completed_reviews_preserved: true }, 200);
  },
);

interface TargetRow {
  id: string;
  track_names: string;
}

/**
 * What a round is actually reviewing.
 *
 * Round one screens everything the call for proposals received; a later round
 * reviews exactly what was promoted into it. Targeting every submitted
 * abstract in round two is how "distribute" silently assigned the wrong work —
 * or, on an unpromoted round, appeared to succeed while doing nothing at all.
 */
async function distributionTargets(
  db: D1Database,
  eventId: string,
  round: RoundRow,
  submissionIds: readonly string[] | undefined,
): Promise<AllocationSubmission[]> {
  const trackNames = `
    COALESCE((
      SELECT json_group_array(track.name)
      FROM submission_tracks carried
      JOIN tracks track ON track.id = carried.track_id
      WHERE carried.submission_id = submission.id
    ), '[]') AS track_names
  `;
  const rows = submissionIds
    ? await db.prepare(`
        SELECT submission.id, ${trackNames}
        FROM submissions submission
        WHERE submission.event_id = ?
          AND submission.id IN (SELECT CAST(value AS TEXT) FROM json_each(?))
        ORDER BY submission.updated_at, submission.id
      `).bind(eventId, JSON.stringify([...new Set(submissionIds)])).all<TargetRow>()
    : round.position === 0
      ? await db.prepare(`
          SELECT submission.id, ${trackNames}
          FROM submissions submission
          WHERE submission.event_id = ?
            AND submission.status IN ('submitted', 'in_review')
            AND submission.bypass_evaluation = 0
          ORDER BY submission.updated_at, submission.id
        `).bind(eventId).all<TargetRow>()
      : await db.prepare(`
          SELECT submission.id, ${trackNames}
          FROM round_promotions promotion
          JOIN submissions submission
            ON submission.id = promotion.submission_id AND submission.event_id = ?
          WHERE promotion.to_round_id = ?
          ORDER BY submission.updated_at, submission.id
        `).bind(eventId, round.id).all<TargetRow>();
  if (submissionIds && rows.results.length !== new Set(submissionIds).size) {
    throw ApiError.notFound("one or more submissions are not in this conference");
  }
  return rows.results.map((row) => ({
    id: row.id,
    trackNames: (JSON.parse(row.track_names) as string[]).filter((name) => typeof name === "string"),
  }));
}

/** "Evals and Infra" — the organizer's own list, not a JSON array. */
function nameList(names: readonly string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0]!;
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

/**
 * A refusal that names the rule and the fix.
 *
 * "reviewer is outside the submission's track scope" is true and useless: the
 * organizer cannot see either side of the intersection that failed, so the
 * only way forward is guessing. This says which responsibilities the reviewer
 * holds, which tracks the abstract carries, and the two ways out.
 */
async function trackScopeRefusal(
  db: D1Database,
  eventId: string,
  reviewerPersonId: string,
  submissionId: string,
): Promise<string> {
  const [reviewer, submission] = await Promise.all([
    db.prepare(`
      SELECT person.name,
        COALESCE((
          SELECT json_group_array(track.name)
          FROM reviewer_track_scopes scope
          JOIN tracks track ON track.id = scope.track_id
          WHERE scope.event_id = ? AND scope.person_id = person.id
          ORDER BY track.position, track.id
        ), '[]') AS track_names
      FROM people person WHERE person.id = ?
    `).bind(eventId, reviewerPersonId).first<{ name: string; track_names: string }>(),
    db.prepare(`
      SELECT COALESCE((
        SELECT json_group_array(track.name)
        FROM submission_tracks carried
        JOIN tracks track ON track.id = carried.track_id
        WHERE carried.submission_id = submission.id
      ), '[]') AS track_names
      FROM submissions submission WHERE submission.id = ?
    `).bind(submissionId).first<{ track_names: string }>(),
  ]);
  const reviewerName = reviewer?.name ?? "That reviewer";
  const reviewerTracks = JSON.parse(reviewer?.track_names ?? "[]") as string[];
  const submissionTracks = JSON.parse(submission?.track_names ?? "[]") as string[];
  if (reviewerTracks.length === 0) {
    return `${reviewerName} has no track responsibilities yet, so no abstract is theirs to review. Give them at least one responsibility first.`;
  }
  if (submissionTracks.length === 0) {
    return `This abstract carries no track, so no reviewer's responsibilities can reach it. Add a track to the abstract, then assign ${reviewerName}.`;
  }
  return `${reviewerName} reviews ${nameList(reviewerTracks)}; this abstract carries ${nameList(submissionTracks)}. Widen their responsibilities or pick another reviewer.`;
}

const distributeAssignments = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/events/{eventId}/rounds/{roundId}/assignments",
    operationId: "distributeEvaluationAssignments",
    summary: "Distribute a round to a committee",
    tags: ["Evaluation"],
    request: { params: roundParams, body: { content: { "application/json": { schema: assignmentsInput } } } },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 200: ok, 201: ok, ...errors },
  },
  async (context) => {
    const { eventId, roundId } = context.req.valid("param");
    requireProgram(context, eventId, true);
    const round = await roundForEvent(context.env.DB, eventId, roundId);
    const plan = await planForEvent(context.env.DB, eventId, round.plan_id);
    if (plan.status !== "open") throw ApiError.conflict("reviewers can only be assigned to an open evaluation plan");
    const body = context.req.valid("json");
    if ("reviewer_person_id" in body) {
      const submission = await context.env.DB.prepare(
        "SELECT id FROM submissions WHERE id = ? AND event_id = ?",
      ).bind(body.submission_id, eventId).first<{ id: string }>();
      if (!submission) throw ApiError.notFound("submission not found");
      const reviewer = await context.env.DB.prepare(`
        SELECT person.id
        FROM people person
        JOIN memberships membership ON membership.person_id = person.id
        WHERE person.id = ? AND membership.event_id = ? AND membership.role = 'reviewer'
      `).bind(body.reviewer_person_id, eventId).first<{ id: string }>();
      if (!reviewer) throw ApiError.unprocessable("reviewer is not a member of this conference", "reviewer_person_id");
      if (!await reviewerCanBeAssignedToSubmission(context.env.DB, eventId, body.reviewer_person_id, body.submission_id)) {
        throw ApiError.unprocessable(
          await trackScopeRefusal(context.env.DB, eventId, body.reviewer_person_id, body.submission_id),
          "reviewer_person_id",
        );
      }
      const existing = await context.env.DB.prepare(
        "SELECT id FROM round_assignments WHERE round_id = ? AND submission_id = ? AND reviewer_person_id = ?",
      ).bind(roundId, body.submission_id, body.reviewer_person_id).first<{ id: string }>();
      if (existing) return context.json({ id: existing.id, round_id: roundId, submission_id: body.submission_id, reviewer_person_id: body.reviewer_person_id, status: "assigned", created: false }, 200);
      const now = Date.now();
      const id = crypto.randomUUID();
      await context.env.DB.prepare(
        `INSERT INTO round_assignments
          (id, round_id, submission_id, reviewer_person_id, committee_id, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, NULL, 'assigned', ?, ?)`,
      ).bind(id, roundId, body.submission_id, body.reviewer_person_id, now, now).run();
      return context.json({ id, round_id: roundId, submission_id: body.submission_id, reviewer_person_id: body.reviewer_person_id, status: "assigned", created: true }, 201);
    }
    const committeeId = body.committee_id ?? round.committee_id;
    if (!committeeId) throw ApiError.unprocessable("select a reviewer pool for this round", "committee_id");
    const committee = await committeeForEvent(context.env.DB, eventId, committeeId);
    /**
     * The pool is the reviewers who could actually hold a row: a committee
     * seat AND this conference's reviewer membership. A seat without the
     * membership passes every list and fails every assignment, which is the
     * kind of disagreement this rebuild exists to remove.
     */
    const poolRows = await context.env.DB.prepare(`
      SELECT person.id, person.name
      FROM committee_members member
      JOIN people person ON person.id = member.person_id
      JOIN memberships membership
        ON membership.person_id = person.id
       AND membership.event_id = ?
       AND membership.role = 'reviewer'
      WHERE member.committee_id = ?
      ORDER BY person.name COLLATE NOCASE, person.id
    `).bind(eventId, committeeId).all<{ id: string; name: string }>();
    const requested = body.reviewer_person_ids ? new Set(body.reviewer_person_ids) : null;
    const reviewers = requested
      ? poolRows.results.filter((reviewer) => requested.has(reviewer.id))
      : poolRows.results;
    if (!reviewers.length) {
      throw ApiError.unprocessable(
        `${committee.name} has no reviewer who can take work yet. Invite a reviewer to this pool, then distribute.`,
        "reviewer_person_ids",
      );
    }

    const submissions = await distributionTargets(context.env.DB, eventId, round, body.submission_ids);
    if (!submissions.length) {
      throw ApiError.unprocessable(
        round.position === 0
          ? `No abstracts are waiting for review in ${round.name} yet. They appear here as soon as the call for proposals receives them.`
          : `No abstracts have been promoted into ${round.name} yet — promote them from the previous round first.`,
        "submission_ids",
      );
    }

    // Eligibility for the whole distribution in ONE query: the pool crossed
    // with the target set through the tracks each side carries. The old
    // per-pair check ran ~2,000 D1 round trips and refused everything on the
    // first miss; a 1,000-abstract conference cannot be distributed that way.
    const submissionIdsJson = JSON.stringify(submissions.map((submission) => submission.id));
    const reviewerIdsJson = JSON.stringify(reviewers.map((reviewer) => reviewer.id));
    const [eligibleRows, existingRows, loadRows] = await Promise.all([
      context.env.DB.prepare(`
        SELECT carried.submission_id AS submission_id, scope.person_id AS reviewer_person_id
        FROM submission_tracks carried
        JOIN reviewer_track_scopes scope
          ON scope.track_id = carried.track_id AND scope.event_id = ?
        WHERE carried.submission_id IN (SELECT CAST(value AS TEXT) FROM json_each(?))
          AND scope.person_id IN (SELECT CAST(value AS TEXT) FROM json_each(?))
        GROUP BY carried.submission_id, scope.person_id
      `).bind(eventId, submissionIdsJson, reviewerIdsJson).all<{ reviewer_person_id: string; submission_id: string }>(),
      context.env.DB.prepare(`
        SELECT submission_id, reviewer_person_id
        FROM round_assignments
        WHERE round_id = ?
          AND reviewer_person_id IS NOT NULL
          AND submission_id IN (SELECT CAST(value AS TEXT) FROM json_each(?))
      `).bind(roundId, submissionIdsJson).all<{ reviewer_person_id: string; submission_id: string }>(),
      context.env.DB.prepare(`
        SELECT reviewer_person_id, COUNT(*) AS assigned_count
        FROM round_assignments
        WHERE round_id = ? AND reviewer_person_id IS NOT NULL
        GROUP BY reviewer_person_id
      `).bind(roundId).all<{ assigned_count: number; reviewer_person_id: string }>(),
    ]);

    const poolOrder = new Map(reviewers.map((reviewer, index) => [reviewer.id, index]));
    const eligible = new Map<string, string[]>();
    for (const row of eligibleRows.results) {
      const list = eligible.get(row.submission_id) ?? [];
      list.push(row.reviewer_person_id);
      eligible.set(row.submission_id, list);
    }
    for (const list of eligible.values()) {
      list.sort((left, right) => (poolOrder.get(left) ?? 0) - (poolOrder.get(right) ?? 0));
    }
    const existing = new Map<string, Set<string>>();
    for (const row of existingRows.results) {
      const held = existing.get(row.submission_id) ?? new Set<string>();
      held.add(row.reviewer_person_id);
      existing.set(row.submission_id, held);
    }
    const load = new Map<string, number>(reviewers.map((reviewer) => [reviewer.id, 0]));
    for (const row of loadRows.results) load.set(row.reviewer_person_id, Number(row.assigned_count));

    const report = allocateAssignments({
      submissions,
      eligible,
      existing,
      load,
      reviewersPerSubmission: body.mode === "everyone"
        ? null
        : body.reviewers_per_submission ?? round.target_reviews_per_submission,
      maxPerReviewer: body.max_per_reviewer ?? null,
    });

    // Written in bounded batches through one prepared statement each: the pair
    // set travels as JSON rather than as placeholders, so a thousand abstracts
    // times three reviewers is a handful of statements, not thousands.
    const now = Date.now();
    const BATCH = 500;
    const statements: D1PreparedStatement[] = [];
    for (let offset = 0; offset < report.pairs.length; offset += BATCH) {
      const chunk = report.pairs.slice(offset, offset + BATCH);
      statements.push(context.env.DB.prepare(`
        INSERT OR IGNORE INTO round_assignments
          (id, round_id, submission_id, reviewer_person_id, committee_id, status, created_at, updated_at)
        SELECT lower(hex(randomblob(16))), ?,
          json_extract(pair.value, '$[0]'), json_extract(pair.value, '$[1]'),
          NULL, 'assigned', ?, ?
        FROM json_each(?) pair
      `).bind(roundId, now, now, JSON.stringify(chunk)));
    }
    if (statements.length) await context.env.DB.batch(statements);

    return context.json({
      already_assigned: report.already_assigned,
      assigned_new: report.assigned_new,
      cap_reached: report.cap_reached,
      committee_id: committeeId,
      fully_covered: report.fully_covered,
      mode: body.mode,
      partially_covered: report.partially_covered,
      reviewers: reviewers.map((reviewer) => ({
        assigned_count: report.per_reviewer.get(reviewer.id) ?? 0,
        name: reviewer.name,
        person_id: reviewer.id,
      })),
      round_id: roundId,
      submissions_total: report.submissions_total,
      uncovered: report.uncovered,
      uncovered_tracks: report.uncovered_tracks,
    }, 200);
  },
);

const listRoundAssignments = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/events/{eventId}/rounds/{roundId}/assignments",
    operationId: "listRoundAssignments",
    summary: "List current reviewers for a round",
    tags: ["Evaluation"],
    request: { params: roundParams, query: assignmentListQuery },
    policy: { auth: { kind: "grants", grants: ["program:read"] }, rateLimit: { bucket: "read" }, concurrency: "none" },
    responses: { 200: ok, ...errors },
  },
  async (context) => {
    const { eventId, roundId } = context.req.valid("param");
    requireProgram(context, eventId, false);
    await roundForEvent(context.env.DB, eventId, roundId);
    const { submission_id: submissionId, summary } = context.req.valid("query");
    if (summary === "1" && !submissionId) {
      const rows = await context.env.DB.prepare(`
        SELECT assignment.reviewer_person_id,
          person.name AS reviewer_name, person.company AS reviewer_company,
          COUNT(*) AS assigned_count,
          COUNT(CASE WHEN evaluation.abstained = 0 THEN evaluation.id END) AS reviewed_count,
          COUNT(CASE WHEN evaluation.abstained = 1 THEN evaluation.id END) AS recusal_count
        FROM round_assignments assignment
        LEFT JOIN people person ON person.id = assignment.reviewer_person_id
        LEFT JOIN evaluations evaluation
          ON evaluation.round_id = assignment.round_id
         AND evaluation.submission_id = assignment.submission_id
         AND evaluation.reviewer_person_id = assignment.reviewer_person_id
        WHERE assignment.round_id = ?
          AND assignment.reviewer_person_id IS NOT NULL
        GROUP BY assignment.reviewer_person_id, person.name, person.company
        ORDER BY person.name COLLATE NOCASE, assignment.reviewer_person_id
      `).bind(roundId).all<Record<string, string | number | null>>();
      return context.json({ data: rows.results.map((row) => {
        const assigned = Number(row.assigned_count ?? 0);
        const reviewed = Number(row.reviewed_count ?? 0);
        const recusals = Number(row.recusal_count ?? 0);
        return {
          ...row,
          assigned_count: assigned,
          reviewed_count: reviewed,
          recusal_count: recusals,
          outstanding_count: Math.max(0, assigned - reviewed - recusals),
        };
      }) }, 200);
    }
    const clauses = ["assignment.round_id = ?"];
    const bindings: unknown[] = [roundId];
    if (submissionId) {
      clauses.push("assignment.submission_id = ?");
      bindings.push(submissionId);
    }
    const rows = await context.env.DB.prepare(`
      SELECT assignment.id, assignment.round_id, assignment.submission_id,
        assignment.reviewer_person_id, assignment.committee_id, assignment.status,
        person.name AS reviewer_name, person.company AS reviewer_company,
        (SELECT COUNT(*) FROM round_assignments covered
         WHERE covered.round_id = assignment.round_id
           AND covered.reviewer_person_id = assignment.reviewer_person_id) AS assigned_count,
        (SELECT COUNT(*) FROM evaluations evaluation
         WHERE evaluation.round_id = assignment.round_id
           AND evaluation.reviewer_person_id = assignment.reviewer_person_id
           AND evaluation.abstained = 0) AS reviewed_count,
        (SELECT COUNT(*) FROM evaluations evaluation
         WHERE evaluation.round_id = assignment.round_id
           AND evaluation.reviewer_person_id = assignment.reviewer_person_id
           AND evaluation.abstained = 1) AS recusal_count
      FROM round_assignments assignment
      LEFT JOIN people person ON person.id = assignment.reviewer_person_id
      WHERE ${clauses.join(" AND ")}
      ORDER BY assignment.submission_id, reviewer_name COLLATE NOCASE, assignment.id
    `).bind(...bindings).all<Record<string, string | number | null>>();
    return context.json({ data: rows.results.map((row) => ({
      ...row,
      assigned_count: Number(row.assigned_count ?? 0),
      reviewed_count: Number(row.reviewed_count ?? 0),
      recusal_count: Number(row.recusal_count ?? 0),
      outstanding_count: Math.max(0, Number(row.assigned_count ?? 0) - Number(row.reviewed_count ?? 0) - Number(row.recusal_count ?? 0)),
    })) }, 200);
  },
);

const remindRoundReviewer = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/events/{eventId}/rounds/{roundId}/reviewers/{personId}/remind",
    operationId: "remindRoundReviewer",
    summary: "Queue a reviewer reminder for outstanding assignments",
    tags: ["Evaluation"],
    request: { params: roundParams.extend({ personId: z.string().min(1) }) },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 202: ok, ...errors },
  },
  async (context) => {
    const { eventId, roundId, personId } = context.req.valid("param");
    requireProgram(context, eventId, true);
    const round = await roundForEvent(context.env.DB, eventId, roundId);
    const reviewer = await context.env.DB.prepare(`
      SELECT person.id, person.name, person.email,
        (SELECT COUNT(*) FROM round_assignments assignment
         WHERE assignment.round_id = ? AND assignment.reviewer_person_id = person.id) AS assigned_count,
        (SELECT COUNT(*) FROM evaluations evaluation
         WHERE evaluation.round_id = ? AND evaluation.reviewer_person_id = person.id AND evaluation.abstained = 0) AS reviewed_count,
        (SELECT COUNT(*) FROM evaluations evaluation
         WHERE evaluation.round_id = ? AND evaluation.reviewer_person_id = person.id AND evaluation.abstained = 1) AS recusal_count
      FROM people person
      JOIN memberships membership
        ON membership.person_id = person.id
       AND membership.event_id = ?
       AND membership.role = 'reviewer'
      WHERE person.id = ?
    `).bind(roundId, roundId, roundId, eventId, personId).first<{
      assigned_count: number;
      email: string;
      id: string;
      name: string;
      recusal_count: number;
      reviewed_count: number;
    }>();
    if (!reviewer) throw ApiError.notFound("reviewer not found");
    const outstanding = Math.max(0, Number(reviewer.assigned_count) - Number(reviewer.reviewed_count) - Number(reviewer.recusal_count));
    if (outstanding === 0) throw ApiError.conflict("reviewer has no outstanding assignments");
    const reminderDay = localDayKey(Date.now(), round.timezone);
    const outbox = await enqueueOutbox({
      db: context.env.DB,
      entityId: IDEMPOTENCY_REGISTRY.reviewerReminder(roundId, personId, reminderDay),
      eventId,
      personId: reviewer.id,
      templateKey: "reviewer_reminder",
      toEmail: reviewer.email,
      data: mergeDataForReviewerReminder({
        email: reviewer.email,
        name: reviewer.name,
        outstanding,
        roundName: round.name,
      }),
    });
    if (outbox.inserted) await enqueueMailMessage(context.env.MAIL_QUEUE, outbox.id);
    return context.json({
      outbox_id: outbox.id,
      outstanding,
      queued: outbox.inserted,
      reviewer_id: reviewer.id,
      round_id: round.id,
    }, 202);
  },
);

const removeRoundAssignment = defineApiRoute(
  {
    method: "delete",
    path: "/api/v1/events/{eventId}/rounds/{roundId}/assignments/{assignmentId}",
    operationId: "removeRoundAssignment",
    summary: "Remove a reviewer from a round",
    tags: ["Evaluation"],
    request: { params: roundParams.extend({ assignmentId: z.string().min(1) }) },
    policy: { auth: { kind: "grants", grants: ["program:write"] }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 200: ok, ...errors },
  },
  async (context) => {
    const { eventId, roundId, assignmentId } = context.req.valid("param");
    requireProgram(context, eventId, true);
    await roundForEvent(context.env.DB, eventId, roundId);
    const assignment = await context.env.DB.prepare(
      "SELECT id, submission_id, reviewer_person_id FROM round_assignments WHERE id = ? AND round_id = ?",
    ).bind(assignmentId, roundId).first<{ id: string; submission_id: string; reviewer_person_id: string | null }>();
    if (!assignment) throw ApiError.notFound("round assignment not found");
    await context.env.DB.prepare("DELETE FROM round_assignments WHERE id = ?").bind(assignmentId).run();
    return context.json({ removed: true, id: assignment.id, submission_id: assignment.submission_id, reviewer_person_id: assignment.reviewer_person_id }, 200);
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
    if (body.selector !== undefined && body.submission_ids !== undefined) {
      throw ApiError.badRequest("promotion accepts one typed selector", "selector");
    }

    // `{ submission_ids: [] }` was the pre-selector UI payload. Keep its
    // preview harmless and make apply explicit, never reinterpret it as
    // "select all". Every actual promotion now travels through the shared
    // ids-or-filter selector contract.
    if (body.submission_ids !== undefined) {
      if (!body.submission_ids.length) {
        if (!body.preview) throw ApiError.unprocessable("promotion requires a typed filtered submission selector", "selector");
        return context.json({
          already_promoted: 0,
          assignments: 0,
          from_round_id: roundId,
          preview: true,
          promoted: 0,
          selected: 0,
          to_round_id: nextRound.id,
        }, 200);
      }
      throw ApiError.badRequest("promotion requires a typed selector", "selector");
    }

    if (body.selector === undefined) {
      if (!body.preview) throw ApiError.unprocessable("promotion requires a typed filtered submission selector", "selector");
      return context.json({
        already_promoted: 0,
        assignments: 0,
        from_round_id: roundId,
        preview: true,
        promoted: 0,
        selected: 0,
        to_round_id: nextRound.id,
      }, 200);
    }

    const selector = normalizeBulkSelector(body.selector, (id) => id.length > 0);
    const selectedIds = selector.kind === "filter"
      ? await selectSubmissionIds(context.env.DB, { eventId, ...(selector.filter as z.infer<typeof submissionFilterSchema>) })
      : [...new Set(selector.ids)];
    const rows = selectedIds.length === 0
      ? []
      : (await context.env.DB.prepare(`
        SELECT id
        FROM submissions
        WHERE event_id = ?
          AND id IN (SELECT CAST(value AS TEXT) FROM json_each(?))
      `).bind(eventId, JSON.stringify(selectedIds)).all<{ id: string }>()).results;
    if (rows.length !== selectedIds.length) throw ApiError.notFound("one or more promotion records are not in this conference");

    const existing = rows.length === 0
      ? []
      : (await context.env.DB.prepare(`
        SELECT submission_id
        FROM round_promotions
        WHERE from_round_id = ? AND to_round_id = ?
          AND submission_id IN (SELECT CAST(value AS TEXT) FROM json_each(?))
      `).bind(roundId, nextRound.id, JSON.stringify(selectedIds)).all<{ submission_id: string }>()).results.map((row) => row.submission_id);
    const existingIds = new Set(existing);
    const promotableIds = rows.map((row) => row.id).filter((id) => !existingIds.has(id));
    if (!body.preview && promotableIds.length === 0) throw ApiError.unprocessable("promotion requires at least one new filtered submission", "selector");
    if (body.preview) return context.json({
      already_promoted: existing.length,
      assignments: promotableIds.length * sourceRound.target_reviews_per_submission,
      from_round_id: roundId,
      preview: true,
      promoted: promotableIds.length,
      selected: rows.length,
      to_round_id: nextRound.id,
    }, 200);

    const principal = context.get("principal");
    const promotedBy = principal.kind === "session" ? principal.personId : "system";
    if (promotedBy === "system") throw ApiError.forbidden("a session is required to apply promotions");
    const now = Date.now();
    const result = await runBulkByIds(promotableIds, (idsJson) => context.env.DB.prepare(`
      INSERT OR IGNORE INTO round_promotions
        (id, from_round_id, to_round_id, submission_id, promoted_at, promoted_by, created_at, updated_at)
      SELECT lower(hex(randomblob(16))), ?, ?, submission.id, ?, ?, ?, ?
      FROM submissions submission
      WHERE submission.event_id = ?
        AND submission.id IN (SELECT CAST(value AS TEXT) FROM json_each(?))
    `).bind(roundId, nextRound.id, now, promotedBy, now, now, eventId, idsJson));
    const promoted = Number(result?.meta.changes ?? 0);
    return context.json({
      already_promoted: existing.length,
      assignments: promoted * sourceRound.target_reviews_per_submission,
      from_round_id: roundId,
      preview: false,
      promoted,
      selected: selectedIds.length,
      to_round_id: nextRound.id,
    }, 200);
  },
);

const listRoundComparisons = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/events/{eventId}/rounds/{roundId}/comparisons",
    operationId: "listRoundComparisonAggregate",
    summary: "Read comparison evidence and its chair aggregate",
    tags: ["Evaluation"],
    request: { params: roundParams },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "read" }, concurrency: "none" },
    responses: { 200: ok, ...errors },
  },
  async (context) => {
    const { eventId, roundId } = context.req.valid("param");
    requireProgram(context, eventId, false);
    const round = await roundForEvent(context.env.DB, eventId, roundId);
    const rows = await context.env.DB.prepare(`
      SELECT comparison.id, comparison.reviewer_person_id, comparison.submission_ids,
        comparison.ranking, comparison.created_at, comparison.updated_at
      FROM comparisons comparison
      JOIN evaluation_rounds round ON round.id = comparison.round_id
      JOIN evaluation_plans plan ON plan.id = round.plan_id
      WHERE comparison.round_id = ? AND plan.event_id = ?
      ORDER BY comparison.created_at, comparison.id
    `).bind(roundId, eventId).all<{
      created_at: number;
      id: string;
      ranking: string;
      reviewer_person_id: string;
      submission_ids: string;
      updated_at: number;
    }>();
    const evidence = rows.results.flatMap((row) => {
      try {
        const submissionIds = JSON.parse(row.submission_ids) as unknown;
        const ranking = JSON.parse(row.ranking) as unknown;
        const validRanking = validateComparisonRanking(Array.isArray(submissionIds) ? submissionIds as string[] : [], ranking);
        return validRanking
          ? [{ id: row.id, reviewer_person_id: row.reviewer_person_id, submissionIds: submissionIds as string[], submission_ids: submissionIds as string[], ranking: validRanking, created_at: row.created_at, updated_at: row.updated_at }]
          : [];
      } catch {
        return [];
      }
    });
    const submissionIds = [...new Set(evidence.flatMap((comparison) => comparison.submissionIds))];
    const titles = submissionIds.length === 0
      ? new Map<string, string>()
      : new Map((await context.env.DB.prepare(`
        SELECT id, title FROM submissions
        WHERE event_id = ? AND id IN (SELECT CAST(value AS TEXT) FROM json_each(?))
    `).bind(eventId, JSON.stringify(submissionIds)).all<{ id: string; title: string }>()).results.map((row) => [row.id, row.title]));
    const wins = comparisonWinCounts(evidence);
    const comparisons = evidence.map(({ submissionIds: internalSubmissionIds, ...comparison }) => ({
      ...comparison,
      submission_ids: internalSubmissionIds,
    }));
    let previousWins: number | null = null;
    let previousRank = 0;
    const aggregate = submissionIds
      .map((id) => ({ id, title: titles.get(id) ?? "", wins: wins.get(id) ?? 0 }))
      .sort((left, right) => right.wins - left.wins || left.title.localeCompare(right.title) || left.id.localeCompare(right.id))
      .map((item, index) => {
        if (previousWins !== item.wins) previousRank = index + 1;
        previousWins = item.wins;
        return { ...item, rank: previousRank, win_count: item.wins };
      });
    return context.json({
      aggregate,
      comparisons,
      round: { id: round.id, mode: round.mode, name: round.name, position: round.position },
    }, 200);
  },
);

const evaluationOverrideParams = roundParams.extend({
  submissionId: z.string().min(1),
  evaluationId: z.string().min(1),
});

const evaluationOverrideInput = z.object({
  score: z.number(),
  comment: z.string().max(4000).optional(),
});

interface OverriddenEvaluationRow {
  id: string;
  reviewer_person_id: string;
  reviewer_kind: string;
  reviewer_name: string;
  score: number | null;
}

/**
 * The evaluation a chair is about to override, proven to belong to this event's
 * round and submission before anything is written. Looked up through the round
 * and submission rather than by id alone, so an id from another conference
 * cannot be steered into this one.
 */
async function overridableEvaluation(
  db: D1Database,
  eventId: string,
  roundId: string,
  submissionId: string,
  evaluationId: string,
): Promise<OverriddenEvaluationRow> {
  const row = await db.prepare(`
    SELECT evaluation.id, evaluation.reviewer_person_id, evaluation.score,
      reviewer.kind AS reviewer_kind, reviewer.name AS reviewer_name
    FROM evaluations evaluation
    JOIN submissions submission
      ON submission.id = evaluation.submission_id AND submission.event_id = ?
    JOIN people reviewer ON reviewer.id = evaluation.reviewer_person_id
    WHERE evaluation.id = ? AND evaluation.round_id = ? AND evaluation.submission_id = ?
  `).bind(eventId, evaluationId, roundId, submissionId).first<OverriddenEvaluationRow>();
  if (!row) throw ApiError.notFound("evaluation not found");
  return row;
}

/**
 * A chair's override of a recorded score.
 *
 * It is written onto the evaluation it overrides rather than as a second peer
 * review, so the reviewer's own judgment survives beside it and the record can
 * say plainly what the reviewer scored and what the chair decided instead. The
 * same control governs a human reviewer and an Agent seat: the product's claim
 * is that a chair can override any of them, not that agents get a side door.
 */
const overrideEvaluation = defineApiRoute(
  {
    method: "put",
    path: "/api/v1/events/{eventId}/rounds/{roundId}/submissions/{submissionId}/evaluations/{evaluationId}/override",
    operationId: "overrideEvaluationScore",
    summary: "Override a recorded evaluation score",
    description:
      "Records a chair's score in place of the reviewer's own. The reviewer's original score and reasoning are preserved and stay visible beside the override.",
    tags: ["Evaluation"],
    request: {
      params: evaluationOverrideParams,
      body: { content: { "application/json": { schema: evaluationOverrideInput } } },
    },
    policy: { auth: { kind: "grants", grants: ["program:write"] }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 200: ok, ...errors },
  },
  async (context) => {
    const { eventId, roundId, submissionId, evaluationId } = context.req.valid("param");
    requireProgram(context, eventId, true);
    const round = await roundForEvent(context.env.DB, eventId, roundId);
    const plan = await planForEvent(context.env.DB, eventId, round.plan_id);
    const evaluation = await overridableEvaluation(context.env.DB, eventId, roundId, submissionId, evaluationId);
    const body = context.req.valid("json");
    // A plan may leave its scale open, and an override on an unbounded plan is
    // not a validation failure — it is simply unbounded.
    const scaleMin = plan.scale_min ?? null;
    const scaleMax = plan.scale_max ?? null;
    if ((scaleMin !== null && body.score < scaleMin) || (scaleMax !== null && body.score > scaleMax)) {
      throw ApiError.unprocessable(`the override must sit on the plan's ${scaleMin ?? "—"}–${scaleMax ?? "—"} scale`, "score");
    }
    const actor = await evaluationActor(context);
    const now = Date.now();
    const comment = body.comment?.trim() ? body.comment.trim() : null;
    await context.env.DB.batch([
      context.env.DB.prepare(`
        UPDATE evaluations
        SET override_score = ?, override_comment = ?, override_person_id = ?, override_at = ?, updated_at = ?
        WHERE id = ?
      `).bind(body.score, comment, actor.personId, now, now, evaluationId),
      auditStatement(context.env.DB, {
        eventId,
        actorKind: actor.kind,
        actorPersonId: actor.personId,
        action: "evaluation_score_overridden",
        entityType: "evaluation",
        entityId: evaluationId,
        before: { score: evaluation.score },
        after: {
          override_score: body.score,
          reviewer_kind: evaluation.reviewer_kind,
          reviewer_person_id: evaluation.reviewer_person_id,
          submission_id: submissionId,
        },
        now,
        requestId: actor.requestId,
      }),
    ]);
    return context.json({
      evaluation_id: evaluationId,
      override: {
        at: now,
        comment,
        person_id: actor.personId,
        score: body.score,
      },
      overridden_score: evaluation.score,
      reviewer: {
        kind: evaluation.reviewer_kind,
        name: evaluation.reviewer_name,
        person_id: evaluation.reviewer_person_id,
      },
    }, 200);
  },
);

/** Clearing an override restores the reviewer's own recorded value. */
const clearEvaluationOverride = defineApiRoute(
  {
    method: "delete",
    path: "/api/v1/events/{eventId}/rounds/{roundId}/submissions/{submissionId}/evaluations/{evaluationId}/override",
    operationId: "clearEvaluationScoreOverride",
    summary: "Clear a chair's score override",
    tags: ["Evaluation"],
    request: { params: evaluationOverrideParams },
    policy: { auth: { kind: "grants", grants: ["program:write"] }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 200: ok, ...errors },
  },
  async (context) => {
    const { eventId, roundId, submissionId, evaluationId } = context.req.valid("param");
    requireProgram(context, eventId, true);
    await roundForEvent(context.env.DB, eventId, roundId);
    const evaluation = await overridableEvaluation(context.env.DB, eventId, roundId, submissionId, evaluationId);
    const actor = await evaluationActor(context);
    const now = Date.now();
    await context.env.DB.batch([
      context.env.DB.prepare(`
        UPDATE evaluations
        SET override_score = NULL, override_comment = NULL, override_person_id = NULL, override_at = NULL, updated_at = ?
        WHERE id = ?
      `).bind(now, evaluationId),
      auditStatement(context.env.DB, {
        eventId,
        actorKind: actor.kind,
        actorPersonId: actor.personId,
        action: "evaluation_score_override_cleared",
        entityType: "evaluation",
        entityId: evaluationId,
        after: { restored_score: evaluation.score, submission_id: submissionId },
        now,
        requestId: actor.requestId,
      }),
    ]);
    return context.json({ cleared: true, evaluation_id: evaluationId, score: evaluation.score }, 200);
  },
);

export const apiRoutes = [
  listPlans,
  createPlan,
  getPlan,
  updatePlan,
  addRound,
  updateRound,
  replaceCriteria,
  createCommittee,
  addCommitteeReviewer,
  inviteCommitteeReviewer,
  createAgentEvaluatorSeat,
  removeCommitteeReviewer,
  getReviewerScopes,
  replaceReviewerScopes,
  distributeAssignments,
  listRoundAssignments,
  remindRoundReviewer,
  removeRoundAssignment,
  promoteRound,
  listRoundComparisons,
  overrideEvaluation,
  clearEvaluationOverride,
];
