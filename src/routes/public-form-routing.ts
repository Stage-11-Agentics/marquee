import { ApiError } from "../api/errors";
import type { D1PreparedStatement } from "@cloudflare/workers-types";
import { reviewerCanBeAssignedToSubmission } from "../lib/reviewer-scope";
import {
  canonicalRoutingFieldKey,
  evaluateRoutingConditions,
  type FormAnswerValue,
  type FormConditionClause,
} from "../lib/form-conditions";
import { taxonomyNameKey } from "../lib/taxonomy";
import type { VendorAffiliation } from "../db/schema";

interface RoutingRuleRow {
  id: string;
  name: string;
  position: number;
  then_json: string;
  when_json: string;
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

export interface RoutingAction {
  addTagIds: string[];
  levelId: string | null;
  trackId: string | null;
}

export interface RoutingInput {
  answers?: Record<string, unknown>;
  eventFieldKeys?: readonly string[];
  formatId: string | null;
  formFieldKeys?: readonly string[];
  levelId?: string | null;
  trackIds: string[];
  vendorAffiliation: VendorAffiliation;
}

export interface SubmissionRouting {
  action: RoutingAction | null;
  committeeId: string | null;
  levelId: string | null;
  planId: string | null;
  roundId: string | null;
  ruleId: string | null;
  ruleName: string | null;
  trackIds: string[];
}

const NO_ROUTING: SubmissionRouting = {
  action: null,
  committeeId: null,
  levelId: null,
  planId: null,
  roundId: null,
  ruleId: null,
  ruleName: null,
  trackIds: [],
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

export function parseRoutingConditions(value: string): FormConditionClause[] | null {
  const parsed = parseJson(value);
  if (!isRecord(parsed)) return null;
  if (typeof parsed.field === "string" && typeof parsed.op === "string") {
    return [{ fieldKey: canonicalRoutingFieldKey(parsed.field), op: parsed.op, value: parsed.value as FormAnswerValue }];
  }
  if (!Array.isArray(parsed.all) || parsed.all.length === 0) return null;
  const conditions: FormConditionClause[] = [];
  for (const item of parsed.all) {
    if (!isRecord(item)) return null;
    const rawField = typeof item.fieldKey === "string" ? item.fieldKey : item.field;
    if (typeof rawField !== "string" || typeof item.op !== "string") return null;
    conditions.push({ fieldKey: canonicalRoutingFieldKey(rawField), op: item.op, value: item.value as FormAnswerValue });
  }
  return conditions;
}

function parseTarget(value: unknown): RoutingTarget {
  if (!isRecord(value)) return {};
  const target: RoutingTarget = {};
  for (const key of ["committee_id", "plan_id", "round_id"] as const) {
    if (value[key] !== undefined) {
      if (typeof value[key] !== "string" || value[key].trim() === "") return {};
      target[key] = value[key];
    }
  }
  return target;
}

export function parseRoutingAction(value: string): { action: RoutingAction; target: RoutingTarget } | null {
  const parsed = parseJson(value);
  if (!isRecord(parsed)) return null;
  const trackId = typeof parsed.track_id === "string"
    ? parsed.track_id
    : typeof parsed.trackId === "string" ? parsed.trackId : null;
  const levelId = typeof parsed.level_id === "string"
    ? parsed.level_id
    : typeof parsed.levelId === "string" ? parsed.levelId : null;
  const rawTagIds = parsed.add_tag_ids ?? parsed.addTagIds ?? [];
  if (!Array.isArray(rawTagIds) || rawTagIds.some((id) => typeof id !== "string" || id.trim() === "")) return null;
  const addTagIds = [...new Set(rawTagIds as string[])];
  const target = parseTarget(parsed);
  if (!trackId && !levelId && addTagIds.length === 0 && !target.committee_id && !target.plan_id && !target.round_id) return null;
  return { action: { addTagIds, levelId, trackId }, target };
}

async function resolveTarget(db: D1Database, eventId: string, target: RoutingTarget): Promise<Omit<SubmissionRouting, "action" | "levelId" | "ruleId" | "ruleName" | "trackIds">> {
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

async function activeTaxonomyAction(
  db: D1Database,
  eventId: string,
  action: RoutingAction,
): Promise<RoutingAction | null> {
  if (action.trackId) {
    const track = await db.prepare("SELECT id FROM tracks WHERE id = ? AND event_id = ? AND deleted_at IS NULL").bind(action.trackId, eventId).first<{ id: string }>();
    if (!track) return null;
  }
  if (action.levelId) {
    const level = await db.prepare("SELECT id FROM levels WHERE id = ? AND event_id = ? AND deleted_at IS NULL").bind(action.levelId, eventId).first<{ id: string }>();
    if (!level) return null;
  }
  if (action.addTagIds.length > 0) {
    const rows = await db.prepare(`
      SELECT id FROM tags
      WHERE event_id = ? AND deleted_at IS NULL AND id IN (${action.addTagIds.map(() => "?").join(", ")})
    `).bind(eventId, ...action.addTagIds).all<{ id: string }>();
    if (rows.results.length !== action.addTagIds.length) return null;
  }
  return action;
}

function routingAnswers(input: RoutingInput, format: { id: string; name: string } | null, tracks: readonly TrackValue[]): Record<string, unknown> {
  const answers = { ...(input.answers ?? {}) };
  const formatValues = format ? [format.id, format.name] : [];
  const trackValues = tracks.flatMap((track) => [track.id, track.name]);
  answers.format = formatValues;
  answers.tracks = trackValues;
  answers.vendor_content = input.vendorAffiliation === "none" ? "No" : "Yes";
  answers.vendor_affiliation = input.vendorAffiliation;
  answers.vendor = input.vendorAffiliation !== "none";
  if (input.levelId) answers.audience_level = input.levelId;
  return answers;
}

function routingSchema(input: RoutingInput, answers: Record<string, unknown>): { eventFieldKeys: Set<string>; formFieldKeys: Set<string> } {
  const derived = ["format", "tracks", "vendor", "vendor_content", "vendor_affiliation"];
  const eventFieldKeys = new Set((input.eventFieldKeys ?? Object.keys(answers)).map(canonicalRoutingFieldKey));
  const formFieldKeys = new Set((input.formFieldKeys ?? Object.keys(answers)).map(canonicalRoutingFieldKey));
  for (const key of derived) {
    eventFieldKeys.add(key);
    formFieldKeys.add(key);
  }
  if ((input.eventFieldKeys ?? []).includes("audience_level") || (input.formFieldKeys ?? []).includes("audience_level")) {
    eventFieldKeys.add("audience_level");
    formFieldKeys.add("audience_level");
  }
  return { eventFieldKeys, formFieldKeys };
}

export async function routingConditionReferencesActive(
  db: D1Database,
  eventId: string,
  conditions: readonly FormConditionClause[],
): Promise<boolean> {
  for (const condition of conditions) {
    if (typeof condition.value !== "string" || condition.value.trim() === "") continue;
    const fieldKey = canonicalRoutingFieldKey(condition.fieldKey);
    const table = fieldKey === "format" ? "formats" : fieldKey === "tracks" ? "tracks" : fieldKey === "audience_level" ? "levels" : null;
    if (!table) continue;
    if (table === "formats") {
      const row = await db.prepare("SELECT id FROM formats WHERE id = ? AND event_id = ?").bind(condition.value, eventId).first();
      if (row) continue;
      const named = await db.prepare("SELECT id FROM formats WHERE event_id = ? AND lower(trim(name)) = lower(trim(?))").bind(eventId, condition.value).first();
      if (!named) return false;
      continue;
    }
    const byId = await db.prepare(`SELECT id, deleted_at FROM ${table} WHERE id = ? AND event_id = ?`).bind(condition.value, eventId).first<{ id: string; deleted_at: number | null }>();
    if (byId) {
      if (byId.deleted_at !== null) return false;
      continue;
    }
    const named = await db.prepare(`SELECT id, name FROM ${table} WHERE event_id = ? AND deleted_at IS NULL`).bind(eventId).all<{ id: string; name: string }>();
    if (!named.results.some((row) => taxonomyNameKey(row.name) === taxonomyNameKey(condition.value as string))) return false;
  }
  return true;
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
      WHERE event_id = ? AND deleted_at IS NULL AND id IN (${input.trackIds.map(() => "?").join(", ")})
    `).bind(eventId, ...input.trackIds).all<TrackValue>()).results;
  const format = input.formatId === null
    ? null
    : await db.prepare("SELECT id, name FROM formats WHERE id = ? AND event_id = ?").bind(input.formatId, eventId).first<{ id: string; name: string }>();
  const answers = routingAnswers(input, format, tracks);
  const schema = routingSchema(input, answers);
  const rules = (await db.prepare(`
    SELECT id, name, position, when_json, then_json
    FROM routing_rules
    WHERE event_id = ? AND enabled = 1 AND deleted_at IS NULL
    ORDER BY position, id
  `).bind(eventId).all<RoutingRuleRow>()).results;

  for (const rule of rules) {
    const conditions = parseRoutingConditions(rule.when_json);
    const parsedAction = parseRoutingAction(rule.then_json);
    if (!conditions || !parsedAction) continue;
    if (!await routingConditionReferencesActive(db, eventId, conditions)) continue;
    const evaluation = evaluateRoutingConditions(conditions, { ...schema, answers });
    if (evaluation.state !== "matched") continue;
    const action = await activeTaxonomyAction(db, eventId, parsedAction.action);
    if (!action) continue;
    const resolved = await resolveTarget(db, eventId, parsedAction.target);
    const trackIds = action.trackId ? [action.trackId] : [...new Set(input.trackIds)];
    return {
      ...resolved,
      action,
      levelId: action.levelId ?? input.levelId ?? null,
      ruleId: rule.id,
      ruleName: rule.name,
      trackIds,
    };
  }
  return { ...NO_ROUTING, levelId: input.levelId ?? null, trackIds: [...new Set(input.trackIds)] };
}

async function committeeReviewerIds(db: D1Database, committeeId: string): Promise<string[]> {
  const rows = await db.prepare(
    "SELECT person_id FROM committee_members WHERE committee_id = ? ORDER BY person_id",
  ).bind(committeeId).all<{ person_id: string }>();
  return rows.results.map((row) => row.person_id);
}

async function reviewerCanBeAssignedToTracks(
  db: D1Database,
  eventId: string,
  reviewerId: string,
  trackIds: readonly string[],
): Promise<boolean> {
  if (trackIds.length === 0) return false;
  // Keep the reviewer-scope read below D1's binding ceiling even when a
  // public form carries a large, organizer-defined track list.
  for (let offset = 0; offset < trackIds.length; offset += 80) {
    const chunk = trackIds.slice(offset, offset + 80);
    const row = await db.prepare(`
      SELECT EXISTS (
        SELECT 1
        FROM memberships membership
        JOIN reviewer_track_scopes scope
          ON scope.event_id = membership.event_id
         AND scope.person_id = membership.person_id
         AND scope.track_id IN (${chunk.map(() => "?").join(", ")})
        WHERE membership.event_id = ?
          AND membership.person_id = ?
          AND membership.role = 'reviewer'
      ) AS allowed
    `).bind(...chunk, eventId, reviewerId).first<{ allowed: number }>();
    if (row?.allowed === 1) return true;
  }
  return false;
}

/** Validate every member of a routed pool through the existing assignment guard. */
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

/** Validate a routed pool against the track projection about to be written. */
export async function assertRoutingPoolAllowedForTracks(
  db: D1Database,
  eventId: string,
  trackIds: readonly string[],
  routing: SubmissionRouting,
): Promise<void> {
  if (routing.committeeId === null || routing.roundId === null) return;
  const reviewerIds = await committeeReviewerIds(db, routing.committeeId);
  if (reviewerIds.length === 0) throw routingFailure();
  const checks = await Promise.all(
    reviewerIds.map((reviewerId) => reviewerCanBeAssignedToTracks(db, eventId, reviewerId, trackIds)),
  );
  if (checks.some((allowed) => !allowed)) throw routingFailure();
}

/** Compose reviewer assignment rows into the public-arrival transaction. */
export async function routingPoolAssignmentStatements(
  db: D1Database,
  submissionId: string,
  routing: SubmissionRouting,
  now: number,
): Promise<D1PreparedStatement[]> {
  if (routing.committeeId === null || routing.roundId === null) return [];
  const reviewerIds = await committeeReviewerIds(db, routing.committeeId);
  return reviewerIds.map((reviewerId) => db.prepare(
    `INSERT OR IGNORE INTO round_assignments
      (id, round_id, submission_id, reviewer_person_id, committee_id, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, NULL, 'assigned', ?, ?)`,
  ).bind(crypto.randomUUID(), routing.roundId, submissionId, reviewerId, now, now));
}

/** Materialize a routed pool into its reviewer-visible assignment rows. */
export async function writeRoutingPoolAssignment(
  db: D1Database,
  submissionId: string,
  routing: SubmissionRouting,
  now: number,
): Promise<void> {
  const statements = await routingPoolAssignmentStatements(db, submissionId, routing, now);
  if (statements.length > 0) await db.batch(statements);
}
