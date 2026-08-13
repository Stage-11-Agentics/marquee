import { ApiError } from "../api/errors";
import { reviewerCanBeAssignedToSubmission } from "../lib/reviewer-scope";
import type { VendorAffiliation } from "../db/schema";

interface RoutingRuleRow {
  id: string;
  name: string;
  position: number;
  then_json: string;
  when_json: string;
}

interface RoutingCondition {
  field: string;
  op: string;
  value?: unknown;
}

interface RoutingTarget {
  committee_id?: string;
  plan_id?: string;
  round_id?: string;
}

interface TrackValue {
  id: string;
  name: string;
}

interface RoutingInput {
  formatId: string | null;
  trackIds: string[];
  vendorAffiliation: VendorAffiliation;
}

export interface SubmissionRouting {
  committeeId: string | null;
  planId: string | null;
  roundId: string | null;
  ruleId: string | null;
  ruleName: string | null;
}

const NO_ROUTING: SubmissionRouting = {
  committeeId: null,
  planId: null,
  roundId: null,
  ruleId: null,
  ruleName: null,
};

function routingFailure(): ApiError {
  return ApiError.unprocessable(
    "This conference could not place your submission in the right review pool. Review your categories, then try again.",
    "routing",
    { retryable: true },
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJson(value: string): unknown | null {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function parseConditions(value: string): RoutingCondition[] | null {
  const parsed = parseJson(value);
  if (!isRecord(parsed)) return null;
  if (typeof parsed.field === "string" && typeof parsed.op === "string") {
    return [{ field: parsed.field, op: parsed.op, value: parsed.value }];
  }
  if (!Array.isArray(parsed.all) || parsed.all.length === 0) return null;
  const conditions: RoutingCondition[] = [];
  for (const item of parsed.all) {
    if (!isRecord(item)) return null;
    const field = typeof item.field === "string" ? item.field : item.fieldKey;
    if (typeof field !== "string" || typeof item.op !== "string") return null;
    conditions.push({ field, op: item.op, value: item.value });
  }
  return conditions;
}

function parseTarget(value: string): RoutingTarget | null {
  const parsed = parseJson(value);
  if (!isRecord(parsed)) return null;
  const target: RoutingTarget = {};
  for (const key of ["committee_id", "plan_id", "round_id"] as const) {
    if (parsed[key] !== undefined) {
      if (typeof parsed[key] !== "string" || parsed[key].trim() === "") return null;
      target[key] = parsed[key];
    }
  }
  return target.committee_id || target.plan_id || target.round_id ? target : null;
}

function scalarEqual(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(actual)) return actual.some((item) => scalarEqual(item, expected));
  if (Array.isArray(expected)) return expected.some((item) => scalarEqual(actual, item));
  if (typeof actual === "string" && typeof expected === "string") {
    return actual.trim().toLocaleLowerCase() === expected.trim().toLocaleLowerCase();
  }
  return actual === expected || String(actual) === String(expected);
}

function conditionMatches(condition: RoutingCondition, input: RoutingInput, tracks: readonly TrackValue[], formatName: string | null): boolean {
  const field = condition.field.trim().toLocaleLowerCase().replaceAll("-", "_");
  const operator = condition.op.trim().toLocaleLowerCase();
  if (!["equals", "eq", "is"].includes(operator)) return false;

  if (field === "track" || field === "tracks" || field === "track_id") {
    return tracks.some((track) => scalarEqual(track.id, condition.value) || scalarEqual(track.name, condition.value));
  }
  if (field === "format" || field === "format_id") {
    return scalarEqual(input.formatId, condition.value) || scalarEqual(formatName, condition.value);
  }
  if (field === "vendor" || field === "vendor_flag" || field === "vendor_content" || field === "vendor_affiliation") {
    const isVendor = input.vendorAffiliation !== "none";
    if (typeof condition.value === "boolean") return isVendor === condition.value;
    if (typeof condition.value === "string") {
      const expected = condition.value.trim().toLocaleLowerCase();
      if (["yes", "true", "vendor", "vendor_content"].includes(expected)) return isVendor;
      if (["no", "false", "none", "not_vendor"].includes(expected)) return !isVendor;
    }
    return scalarEqual(input.vendorAffiliation, condition.value);
  }
  return false;
}

async function resolveTarget(db: D1Database, eventId: string, target: RoutingTarget): Promise<Omit<SubmissionRouting, "ruleId" | "ruleName">> {
  let planId = target.plan_id ?? null;
  let committeeId = target.committee_id ?? null;
  let roundId = target.round_id ?? null;

  if (planId) {
    const plan = await db.prepare(
      "SELECT id, status FROM evaluation_plans WHERE id = ? AND event_id = ?",
    ).bind(planId, eventId).first<{ id: string; status: string }>();
    if (!plan || plan.status !== "open") throw routingFailure();
  }

  if (committeeId) {
    const committee = await db.prepare(
      "SELECT id FROM committees WHERE id = ? AND event_id = ?",
    ).bind(committeeId, eventId).first<{ id: string }>();
    if (!committee) throw routingFailure();
  }

  if (roundId) {
    const round = await db.prepare(`
      SELECT round.id, round.plan_id, plan.status
      FROM evaluation_rounds round
      JOIN evaluation_plans plan ON plan.id = round.plan_id
      WHERE round.id = ? AND plan.event_id = ?
    `).bind(roundId, eventId).first<{ id: string; plan_id: string; status: string }>();
    if (!round || round.status !== "open" || (planId !== null && round.plan_id !== planId)) throw routingFailure();
    roundId = round.id;
    planId ??= round.plan_id;
  }

  if (committeeId && !roundId) {
    const round = await db.prepare(`
      SELECT round.id, round.plan_id
      FROM evaluation_rounds round
      JOIN evaluation_plans plan ON plan.id = round.plan_id
      WHERE plan.event_id = ?
        AND plan.status = 'open'
        AND (? IS NULL OR plan.id = ?)
      ORDER BY plan.updated_at DESC, round.position, round.id
      LIMIT 1
    `).bind(eventId, planId, planId).first<{ id: string; plan_id: string }>();
    if (!round) throw routingFailure();
    roundId = round.id;
    planId ??= round.plan_id;
  }

  return { committeeId, planId, roundId };
}

export async function selectSubmissionRouting(
  db: D1Database,
  eventId: string,
  input: RoutingInput,
): Promise<SubmissionRouting> {
  const tracks = input.trackIds.length === 0
    ? []
    : (await db.prepare(`
      SELECT id, name FROM tracks
      WHERE event_id = ? AND id IN (${input.trackIds.map(() => "?").join(", ")})
    `).bind(eventId, ...input.trackIds).all<TrackValue>()).results;
  const format = input.formatId === null
    ? null
    : await db.prepare("SELECT name FROM formats WHERE id = ? AND event_id = ?").bind(input.formatId, eventId).first<{ name: string }>();
  const rules = (await db.prepare(`
    SELECT id, name, position, when_json, then_json
    FROM routing_rules
    WHERE event_id = ? AND enabled = 1
    ORDER BY position, id
  `).bind(eventId).all<RoutingRuleRow>()).results;

  for (const rule of rules) {
    const conditions = parseConditions(rule.when_json);
    const target = parseTarget(rule.then_json);
    if (!conditions || !target) continue;
    if (!conditions.every((condition) => conditionMatches(condition, input, tracks, format?.name ?? null))) continue;
    const resolved = await resolveTarget(db, eventId, target);
    return { ...resolved, ruleId: rule.id, ruleName: rule.name };
  }
  return NO_ROUTING;
}

async function committeeReviewerIds(db: D1Database, committeeId: string): Promise<string[]> {
  const rows = await db.prepare(
    "SELECT person_id FROM committee_members WHERE committee_id = ? ORDER BY person_id",
  ).bind(committeeId).all<{ person_id: string }>();
  return rows.results.map((row) => row.person_id);
}

/**
 * Validate every member of a routed pool through the existing assignment
 * guard. This helper intentionally has no alternate SQL predicate: the
 * committee row is written only after all member checks pass.
 */
export async function assertRoutingPoolAllowed(
  db: D1Database,
  eventId: string,
  submissionId: string,
  routing: SubmissionRouting,
): Promise<void> {
  if (routing.committeeId === null || routing.roundId === null) return;
  const reviewerIds = await committeeReviewerIds(db, routing.committeeId);
  if (reviewerIds.length === 0) throw routingFailure();
  const checks = await Promise.all(
    reviewerIds.map((reviewerId) => reviewerCanBeAssignedToSubmission(db, eventId, reviewerId, submissionId)),
  );
  if (checks.some((allowed) => !allowed)) throw routingFailure();
}

/**
 * Routing hands the abstract to a pool by writing the pool's rows.
 *
 * An assignment is a (round, submission, reviewer) row everywhere in the
 * product, so a routed submission materializes one row per pool member rather
 * than a single blanket row nobody's queue, dashboard, or reminder could see.
 * `assertRoutingPoolAllowed` has already proved every member is in scope, so
 * this writes the whole pool or the route would not have been taken.
 */
export async function writeRoutingPoolAssignment(
  db: D1Database,
  submissionId: string,
  routing: SubmissionRouting,
  now: number,
): Promise<void> {
  if (routing.committeeId === null || routing.roundId === null) return;
  const reviewerIds = await committeeReviewerIds(db, routing.committeeId);
  if (reviewerIds.length === 0) return;
  await db.batch(reviewerIds.map((reviewerId) => db.prepare(
    `INSERT OR IGNORE INTO round_assignments
      (id, round_id, submission_id, reviewer_person_id, committee_id, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, NULL, 'assigned', ?, ?)`,
  ).bind(crypto.randomUUID(), routing.roundId, submissionId, reviewerId, now, now)));
}
