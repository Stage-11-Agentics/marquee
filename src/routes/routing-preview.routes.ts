import { z } from "@hono/zod-openapi";

import { ApiError } from "../api/errors";
import { defineApiRoute, errorResponses, jsonResponse } from "../api/route";
import { evaluateRoutingConditions } from "../lib/form-conditions";
import { boundSourceOf } from "../lib/bound-options";
import { parseRoutingAction, parseRoutingConditions, routingConditionReferencesActive } from "./public-form-routing";

const params = z.object({ eventId: z.string().min(1), formId: z.string().min(1) });
const previewRule = z.object({
  rule_id: z.string(),
  state: z.enum(["matchable", "skipped", "dangling", "invalid"]),
  would_have_matched: z.number().int().nonnegative().nullable(),
  rules_above: z.number().int().nonnegative(),
  landing: z.object({
    track_id: z.string().nullable(),
    tag_ids: z.array(z.string()),
    level_id: z.string().nullable(),
    plan_id: z.string().nullable(),
    committee_id: z.string().nullable(),
    round_id: z.string().nullable(),
  }).nullable(),
  reason: z.string().nullable(),
});
const previewResponse = z.object({
  data: z.object({
    form_id: z.string(),
    sample_size: z.number().int().nonnegative(),
    last_arrival_at: z.number().int().nullable(),
    max_sample_size: z.literal(100),
    rules: z.array(previewRule),
  }),
});

type FieldRow = { key: string; type: string; config: string | null };
type SubmissionRow = { id: string; format_id: string | null; vendor_affiliation: string; submitted_at: number | null };
type RuleRow = { id: string; name: string; position: number; when_json: string; then_json: string };

function parseValue(valueJson: string | null, valueText: string | null): unknown {
  if (valueJson === null) return valueText;
  try { return JSON.parse(valueJson) as unknown; } catch { return valueText; }
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

async function activeTaxonomyIds(db: D1Database, table: "tracks" | "tags" | "levels", eventId: string): Promise<Set<string>> {
  const rows = await db.prepare(`SELECT id FROM ${table} WHERE event_id = ? AND deleted_at IS NULL`).bind(eventId).all<{ id: string }>();
  return new Set(rows.results.map((row) => row.id));
}

async function historicalAnswers(
  db: D1Database,
  eventId: string,
  submission: SubmissionRow,
  fields: readonly FieldRow[],
): Promise<Record<string, unknown>> {
  const rows = await db.prepare(`
    SELECT field.key, field.type, field.config, answer.value_text, answer.value_json
    FROM submission_answers answer
    JOIN form_fields field ON field.id = answer.field_id AND field.deleted_at IS NULL
    WHERE answer.submission_id = ?
  `).bind(submission.id).all<{ key: string; type: string; config: string | null; value_text: string | null; value_json: string | null }>();
  const answers: Record<string, unknown> = {};
  let levelId: string | null = null;
  for (const row of rows.results) {
    const value = parseValue(row.value_json, row.value_text);
    const config = objectValue(typeof row.config === "string" ? (() => { try { return JSON.parse(row.config) as unknown; } catch { return {}; } })() : row.config) ?? {};
    if (config.source === "levels") {
      const source = objectValue(value);
      levelId = typeof source?.id === "string" ? source.id : typeof value === "string" ? value : null;
      if (typeof source?.label === "string") answers[row.key] = source.label;
      else answers[row.key] = value;
    } else {
      answers[row.key] = value;
    }
  }
  const [format, tracks] = await Promise.all([
    submission.format_id
      ? db.prepare("SELECT id, name FROM formats WHERE id = ? AND event_id = ?").bind(submission.format_id, eventId).first<{ id: string; name: string }>()
      : Promise.resolve(null),
    db.prepare(`
      SELECT track.id, track.name
      FROM submission_tracks link JOIN tracks track ON track.id = link.track_id AND track.event_id = ?
      WHERE link.submission_id = ? ORDER BY link.is_primary DESC, track.position, track.id
    `).bind(eventId, submission.id).all<{ id: string; name: string }>(),
  ]);
  answers.format = format ? [format.id, format.name] : [];
  answers.tracks = tracks.results.flatMap((track) => [track.id, track.name]);
  answers.vendor = submission.vendor_affiliation !== "none";
  answers.vendor_content = submission.vendor_affiliation === "none" ? "No" : "Yes";
  answers.vendor_affiliation = submission.vendor_affiliation;
  if (levelId !== null) answers.audience_level = levelId;
  void fields;
  return answers;
}

const getRoutingPreview = defineApiRoute({
  method: "get",
  path: "/api/v1/events/{eventId}/forms/{formId}/routing-preview",
  operationId: "getRoutingPreview",
  summary: "Preview routing rules against recent public arrivals",
  description: "Returns aggregate-only counts over the last 100 public arrivals.",
  tags: ["Routing rules"],
  request: { params },
  policy: { auth: { kind: "grants", grants: ["program:read"] }, rateLimit: { bucket: "read" }, concurrency: "none" },
  responses: { 200: jsonResponse(previewResponse, "Routing preview"), ...errorResponses([401, 403, 404, 429, 500]) },
}, async (context) => {
  const { eventId, formId } = context.req.valid("param");
  const form = await context.env.DB.prepare("SELECT id, event_id FROM forms WHERE id = ? AND event_id = ?").bind(formId, eventId).first<{ id: string; event_id: string }>();
  if (!form) throw ApiError.notFound("form not found");
  const fields = (await context.env.DB.prepare("SELECT key, type, config FROM form_fields WHERE form_id = ? AND deleted_at IS NULL ORDER BY position, id").bind(formId).all<FieldRow>()).results;
  const eventFields = (await context.env.DB.prepare(`
    SELECT DISTINCT field.key
    FROM form_fields field JOIN forms form ON form.id = field.form_id
    WHERE form.event_id = ? AND field.deleted_at IS NULL
  `).bind(eventId).all<{ key: string }>()).results.map((row) => row.key);
  const derived = ["format", "tracks", "vendor", "vendor_content", "vendor_affiliation"];
  const eventFieldKeys = new Set([...eventFields, ...derived]);
  const formFieldKeys = new Set([...fields.map((field) => field.key), ...derived]);
  if (fields.some((field) => boundSourceOf({ type: field.type as never, config: (() => { try { return JSON.parse(field.config ?? "{}"); } catch { return {}; } })() }) === "levels")) {
    eventFieldKeys.add("audience_level");
    formFieldKeys.add("audience_level");
  }
  const submissions = (await context.env.DB.prepare(`
    SELECT id, format_id, vendor_affiliation, submitted_at
    FROM submissions
    WHERE event_id = ? AND form_id = ? AND origin = 'public' AND status <> 'draft' AND submitted_at IS NOT NULL
    ORDER BY submitted_at DESC, id DESC LIMIT 100
  `).bind(eventId, formId).all<SubmissionRow>()).results;
  const rules = (await context.env.DB.prepare(`
    SELECT id, name, position, when_json, then_json
    FROM routing_rules WHERE event_id = ? AND enabled = 1 AND deleted_at IS NULL ORDER BY position, id
  `).bind(eventId).all<RuleRow>()).results;
  const [activeTracks, activeTags, activeLevels] = await Promise.all([
    activeTaxonomyIds(context.env.DB, "tracks", eventId),
    activeTaxonomyIds(context.env.DB, "tags", eventId),
    activeTaxonomyIds(context.env.DB, "levels", eventId),
  ]);
  const answers = await Promise.all(submissions.map((submission) => historicalAnswers(context.env.DB, eventId, submission, fields)));
  const results = await Promise.all(rules.map(async (rule, index) => {
    const conditions = parseRoutingConditions(rule.when_json);
    const action = parseRoutingAction(rule.then_json);
    if (!conditions || !action) return { rule_id: rule.id, state: "invalid" as const, would_have_matched: null, rules_above: index, landing: null, reason: "Routing rule is malformed." };
    if (!await routingConditionReferencesActive(context.env.DB, eventId, conditions)) {
      return { rule_id: rule.id, state: "dangling" as const, would_have_matched: null, rules_above: index, landing: null, reason: "Fix the deleted routing condition before previewing this rule." };
    }
    const actionDangling = Boolean(
      (action.action.trackId && !activeTracks.has(action.action.trackId))
      || (action.action.levelId && !activeLevels.has(action.action.levelId))
      || action.action.addTagIds.some((id) => !activeTags.has(id)),
    );
    if (actionDangling) return { rule_id: rule.id, state: "dangling" as const, would_have_matched: null, rules_above: index, landing: null, reason: "Fix the deleted routing destination before previewing this rule." };
    let state: "matchable" | "skipped" | "dangling" | "invalid" = "matchable";
    let reason: string | null = null;
    let matched = 0;
    for (const answer of answers) {
      const evaluation = evaluateRoutingConditions(conditions, { eventFieldKeys, formFieldKeys, answers: answer });
      if (evaluation.state === "matched") matched += 1;
      else if (evaluation.state === "skipped") { state = "skipped"; reason = evaluation.reason; }
      else if (evaluation.state === "dangling") { state = "dangling"; reason = evaluation.reason; }
      else if (evaluation.reason !== null) { state = "invalid"; reason = evaluation.reason; }
    }
    return {
      rule_id: rule.id,
      state,
      would_have_matched: state === "matchable" ? matched : null,
      rules_above: index,
      landing: state === "matchable" ? {
        track_id: action.action.trackId,
        tag_ids: action.action.addTagIds,
        level_id: action.action.levelId,
        plan_id: action.target.plan_id ?? null,
        committee_id: action.target.committee_id ?? null,
        round_id: action.target.round_id ?? null,
      } : null,
      reason,
    };
  }));
  return context.json({ data: { form_id: formId, sample_size: submissions.length, last_arrival_at: submissions[0]?.submitted_at ?? null, max_sample_size: 100 as const, rules: results } }, 200);
});

export const apiRoutes = [getRoutingPreview];
