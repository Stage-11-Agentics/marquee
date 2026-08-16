import { z } from "@hono/zod-openapi";

import { ApiError } from "../api/errors";
import { defineApiRoute, errorResponses, jsonResponse } from "../api/route";
import { canonicalRoutingFieldKey, validateRoutingConditions, type FormAnswerValue, type FormConditionClause } from "../lib/form-conditions";
import { taxonomyNameKey, normalizeTaxonomyName } from "../lib/taxonomy";

const eventParams = z.object({ eventId: z.string().min(1) });
const ruleParams = eventParams.extend({ ruleId: z.string().min(1) });
const tagParams = eventParams.extend({ tagId: z.string().min(1) });
const levelParams = eventParams.extend({ levelId: z.string().min(1) });

const operator = z.enum(["equals", "not_equals", "contains", "not_contains", "answered", "not_answered"]);
const condition = z.object({
  fieldKey: z.string().trim().min(1),
  op: operator,
  value: z.unknown().optional(),
});
const conditionSet = z.object({ all: z.array(condition).min(1).max(5) });
const action = z.object({
  track_id: z.string().min(1).nullable().optional(),
  add_tag_ids: z.array(z.string().min(1)).max(50).optional(),
  level_id: z.string().min(1).nullable().optional(),
  plan_id: z.string().min(1).nullable().optional(),
  committee_id: z.string().min(1).nullable().optional(),
  round_id: z.string().min(1).nullable().optional(),
});
const ruleInput = z.object({
  name: z.string().trim().min(1).max(200),
  when_json: conditionSet.optional(),
  then_json: action.optional(),
  when: conditionSet.optional(),
  then: action.optional(),
  enabled: z.boolean().optional(),
  position: z.number().int().nonnegative().optional(),
});
const rulePatch = ruleInput.partial();
const reorderInput = z.object({ rule_id: z.string().min(1), position: z.number().int().nonnegative() });
const taxonomyReorderInput = z.object({ tag_id: z.string().min(1).optional(), level_id: z.string().min(1).optional(), position: z.number().int().nonnegative() });

const taxonomyInput = z.object({
  name: z.string().trim().min(1).max(160),
  position: z.number().int().nonnegative().optional(),
});
const taxonomyPatch = taxonomyInput.partial();
const tagSchema = z.object({ id: z.string(), event_id: z.string(), name: z.string(), name_key: z.string(), position: z.number().int(), deleted_at: z.number().int().nullable(), updated_at: z.number().int() });
const levelSchema = tagSchema;
const ruleSchema = z.object({
  id: z.string(), event_id: z.string(), name: z.string(), when_json: z.record(z.string(), z.unknown()), then_json: z.record(z.string(), z.unknown()),
  position: z.number().int(), enabled: z.boolean(), deleted_at: z.number().int().nullable(), dangling_references: z.array(z.string()), dangling_reason: z.string().nullable(), summary: z.string(), updated_at: z.number().int(),
});

type Condition = FormConditionClause;
type Action = { track_id?: string | null; add_tag_ids?: string[]; level_id?: string | null; plan_id?: string | null; committee_id?: string | null; round_id?: string | null };

function jsonObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function payloadOf(body: z.infer<typeof ruleInput>): { conditions: Condition[]; action: Action } {
  const when = body.when_json ?? body.when;
  const then = body.then_json ?? body.then;
  if (!when || !then) throw ApiError.unprocessable("A routing rule needs conditions and an action.", "routing");
  return { conditions: when.all, action: jsonObject(then) as Action };
}

function eventDerivedKeys(): string[] {
  return ["format", "tracks", "vendor", "vendor_content", "vendor_affiliation"];
}

async function activeFieldKeys(db: D1Database, eventId: string): Promise<string[]> {
  const rows = await db.prepare(`
    SELECT DISTINCT field.key
    FROM form_fields field JOIN forms form ON form.id = field.form_id
    WHERE form.event_id = ? AND field.deleted_at IS NULL
  `).bind(eventId).all<{ key: string }>();
  return [...new Set([...eventDerivedKeys(), ...rows.results.map((row) => canonicalRoutingFieldKey(row.key))])];
}

async function taxonomyReference(
  db: D1Database,
  table: "tracks" | "tags" | "levels",
  eventId: string,
  id: string,
): Promise<{ id: string; name: string; deleted_at: number | null } | null> {
  return db.prepare(`SELECT id, name, deleted_at FROM ${table} WHERE id = ? AND event_id = ?`)
    .bind(id, eventId).first<{ id: string; name: string; deleted_at: number | null }>();
}

function normalizeConditions(conditions: Condition[]): Condition[] {
  return conditions.flatMap((item) => {
    if (!item || typeof item.fieldKey !== "string" || typeof item.op !== "string") return [];
    return [{ fieldKey: canonicalRoutingFieldKey(item.fieldKey), op: item.op, ...(item.value === undefined ? {} : { value: item.value as FormAnswerValue }) }];
  });
}

type ConditionDomainTable = "formats" | "tracks" | "levels";

function conditionDomain(fieldKey: string): ConditionDomainTable | null {
  switch (canonicalRoutingFieldKey(fieldKey)) {
    case "format": return "formats";
    case "tracks": return "tracks";
    case "audience_level": return "levels";
    default: return null;
  }
}

async function resolveConditionDomainValue(
  db: D1Database,
  eventId: string,
  table: ConditionDomainTable,
  value: string,
): Promise<string> {
  if (table === "formats") {
    const byId = await db.prepare("SELECT id FROM formats WHERE id = ? AND event_id = ?").bind(value, eventId).first<{ id: string }>();
    if (byId) return byId.id;
    const rows = await db.prepare("SELECT id, name FROM formats WHERE event_id = ?").bind(eventId).all<{ id: string; name: string }>();
    const matches = rows.results.filter((row) => taxonomyNameKey(row.name) === taxonomyNameKey(value));
    if (matches.length === 1) return matches[0]!.id;
    throw ApiError.unprocessable(matches.length > 1 ? "The format condition is ambiguous." : "Choose a format from this conference.", "when_json");
  }
  const byId = await db.prepare(`SELECT id, deleted_at FROM ${table} WHERE id = ? AND event_id = ?`).bind(value, eventId).first<{ id: string; deleted_at: number | null }>();
  if (byId) {
    if (byId.deleted_at !== null) throw ApiError.unprocessable(`The ${table.slice(0, -1)} condition names a deleted option.`, "when_json");
    return byId.id;
  }
  const rows = await db.prepare(`SELECT id, name, deleted_at FROM ${table} WHERE event_id = ? AND deleted_at IS NULL`).bind(eventId).all<{ id: string; name: string; deleted_at: number | null }>();
  const matches = rows.results.filter((row) => taxonomyNameKey(row.name) === taxonomyNameKey(value));
  if (matches.length === 1) return matches[0]!.id;
  throw ApiError.unprocessable(matches.length > 1 ? `The ${table.slice(0, -1)} condition is ambiguous.` : `Choose an active ${table.slice(0, -1)} from this conference.`, "when_json");
}

async function normalizeConditionReferences(
  db: D1Database,
  eventId: string,
  conditions: Condition[],
): Promise<Condition[]> {
  return Promise.all(conditions.map(async (condition) => {
    const table = conditionDomain(condition.fieldKey);
    if (!table || typeof condition.value !== "string" || condition.value.trim() === "") return condition;
    return { ...condition, value: await resolveConditionDomainValue(db, eventId, table, condition.value) };
  }));
}

async function danglingConditionReferences(
  db: D1Database,
  eventId: string,
  conditions: readonly Condition[],
): Promise<string[]> {
  const dangling: string[] = [];
  for (const condition of conditions) {
    const table = conditionDomain(condition.fieldKey);
    if (!table || typeof condition.value !== "string" || condition.value.trim() === "") continue;
    if (table === "formats") {
      const row = await db.prepare("SELECT id FROM formats WHERE id = ? AND event_id = ?").bind(condition.value, eventId).first();
      if (!row) dangling.push(`format:${condition.value}`);
      continue;
    }
    const row = await db.prepare(`SELECT id, deleted_at FROM ${table} WHERE id = ? AND event_id = ?`).bind(condition.value, eventId).first<{ id: string; deleted_at: number | null }>();
    if (!row || row.deleted_at !== null) dangling.push(`${table.slice(0, -1)}:${condition.value}`);
  }
  return dangling;
}

function storedJsonObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") return jsonObject(value);
  try {
    return jsonObject(JSON.parse(value) as unknown);
  } catch {
    return {};
  }
}

async function validateRuleReferences(
  db: D1Database,
  eventId: string,
  conditions: Condition[],
  actionValue: Action,
): Promise<Condition[]> {
  const fields = await activeFieldKeys(db, eventId);
  const normalized = await normalizeConditionReferences(db, eventId, normalizeConditions(conditions));
  const evaluation = validateRoutingConditions(normalized, {
    eventFieldKeys: fields,
  });
  if (evaluation.state === "dangling" || evaluation.state === "invalid") {
    throw ApiError.unprocessable(evaluation.reason ?? "Fix the routing condition before saving.", "when_json");
  }
  if (actionValue.track_id) {
    const track = await taxonomyReference(db, "tracks", eventId, actionValue.track_id);
    if (!track || track.deleted_at !== null) throw ApiError.unprocessable("Choose an active track for this routing action.", "then_json.track_id");
  }
  if (actionValue.level_id) {
    const level = await taxonomyReference(db, "levels", eventId, actionValue.level_id);
    if (!level || level.deleted_at !== null) throw ApiError.unprocessable("Choose an active level for this routing action.", "then_json.level_id");
  }
  const tagIds = [...new Set(actionValue.add_tag_ids ?? [])];
  for (const tagId of tagIds) {
    const tag = await taxonomyReference(db, "tags", eventId, tagId);
    if (!tag || tag.deleted_at !== null) throw ApiError.unprocessable("Choose active tags for this routing action.", "then_json.add_tag_ids");
  }
  if (actionValue.plan_id) {
    const plan = await db.prepare("SELECT id FROM evaluation_plans WHERE id = ? AND event_id = ? AND status = 'open'").bind(actionValue.plan_id, eventId).first();
    if (!plan) throw ApiError.unprocessable("Choose an open review plan for this routing action.", "then_json.plan_id");
  }
  if (actionValue.committee_id) {
    const committee = await db.prepare("SELECT id FROM committees WHERE id = ? AND event_id = ?").bind(actionValue.committee_id, eventId).first();
    if (!committee) throw ApiError.unprocessable("Choose a committee in this conference.", "then_json.committee_id");
  }
  if (actionValue.round_id) {
    const round = await db.prepare(`SELECT round.id FROM evaluation_rounds round JOIN evaluation_plans plan ON plan.id = round.plan_id WHERE round.id = ? AND plan.event_id = ? AND plan.status = 'open'`).bind(actionValue.round_id, eventId).first();
    if (!round) throw ApiError.unprocessable("Choose an open review round in this conference.", "then_json.round_id");
  }
  if (!actionValue.track_id && !actionValue.level_id && tagIds.length === 0 && !actionValue.plan_id && !actionValue.committee_id && !actionValue.round_id) {
    throw ApiError.unprocessable("Choose at least one routing destination.", "then_json");
  }
  return normalized;
}

function summary(conditions: Condition[], actionValue: Action, names: Map<string, string>): string {
  const clauses = conditions.map((item) => `${item.fieldKey} ${item.op}${item.value === undefined ? "" : ` ${String(item.value)}`}`).join(" and ");
  const destinations: string[] = [];
  if (actionValue.track_id) destinations.push(`set track ${names.get(actionValue.track_id) ?? actionValue.track_id}`);
  if (actionValue.add_tag_ids?.length) destinations.push(`add tag ${actionValue.add_tag_ids.map((id) => names.get(id) ?? id).join(", ")}`);
  if (actionValue.level_id) destinations.push(`set level ${names.get(actionValue.level_id) ?? actionValue.level_id}`);
  if (actionValue.committee_id || actionValue.plan_id || actionValue.round_id) destinations.push("route to review");
  return `When ${clauses} -> ${destinations.join(", ")}`;
}

async function ruleView(db: D1Database, eventId: string, row: { id: string; event_id: string; name: string; when_json: string; then_json: string; position: number; enabled: number; deleted_at: number | null; updated_at: number }): Promise<z.infer<typeof ruleSchema>> {
  const when = storedJsonObject(row.when_json);
  const then = storedJsonObject(row.then_json);
  const conditions: Condition[] = Array.isArray(when.all)
    ? normalizeConditions(when.all as Condition[])
    : typeof when.field === "string"
      ? [{ fieldKey: canonicalRoutingFieldKey(String(when.field)), op: String(when.op), ...(when.value === undefined ? {} : { value: when.value as FormAnswerValue }) }]
      : [];
  const actionValue = then as Action;
  const dangling: string[] = [];
  const fields = new Set(await activeFieldKeys(db, eventId));
  for (const item of conditions) {
    const fieldKey = canonicalRoutingFieldKey(item.fieldKey);
    if (!fields.has(fieldKey)) dangling.push(`field:${fieldKey}`);
  }
  dangling.push(...await danglingConditionReferences(db, eventId, conditions));
  const refs: Array<["tracks" | "tags" | "levels", string | null]> = [["tracks", actionValue.track_id ?? null], ["levels", actionValue.level_id ?? null], ...((actionValue.add_tag_ids ?? []).map((id) => ["tags", id] as ["tags", string]))];
  for (const [table, id] of refs) {
    if (!id) continue;
    const ref = await taxonomyReference(db, table, eventId, id);
    if (!ref || ref.deleted_at !== null) dangling.push(`${table.slice(0, -1)}:${id}`);
  }
  const names = new Map<string, string>();
  for (const [table, id] of refs) if (id) { const ref = await taxonomyReference(db, table, eventId, id); if (ref) names.set(id, ref.name); }
  return {
    id: row.id, event_id: row.event_id, name: row.name, when_json: when, then_json: then, position: Number(row.position), enabled: row.enabled === 1 && dangling.length === 0,
    deleted_at: row.deleted_at === null ? null : Number(row.deleted_at), dangling_references: dangling, dangling_reason: dangling.length ? `Fix ${dangling.join(", ")} before enabling this rule.` : null,
    summary: summary(conditions, actionValue, names), updated_at: Number(row.updated_at),
  };
}

async function readRules(db: D1Database, eventId: string): Promise<z.infer<typeof ruleSchema>[]> {
  const rows = await db.prepare(`SELECT id, event_id, name, when_json, then_json, position, enabled, deleted_at, updated_at FROM routing_rules WHERE event_id = ? AND deleted_at IS NULL ORDER BY position, id`).bind(eventId).all<{ id: string; event_id: string; name: string; when_json: string; then_json: string; position: number; enabled: number; deleted_at: number | null; updated_at: number }>();
  return Promise.all(rows.results.map((row) => ruleView(db, eventId, row)));
}

const listRules = defineApiRoute({
  method: "get", path: "/api/v1/events/{eventId}/routing-rules", operationId: "listRoutingRules", summary: "List conference routing rules", tags: ["Routing rules"], request: { params: eventParams }, policy: { auth: { kind: "grants", grants: ["program:read"] }, rateLimit: { bucket: "read" }, concurrency: "none" }, responses: { 200: jsonResponse(z.object({ data: z.array(ruleSchema) }), "Routing rules"), ...errorResponses([401, 403, 404, 429, 500]) },
}, async (context) => context.json({ data: await readRules(context.env.DB, context.req.valid("param").eventId) }, 200));

const createRule = defineApiRoute({
  method: "post", path: "/api/v1/events/{eventId}/routing-rules", operationId: "createRoutingRule", summary: "Create a conference routing rule", tags: ["Routing rules"], request: { params: eventParams, body: { content: { "application/json": { schema: ruleInput } } } }, policy: { auth: { kind: "grants", grants: ["program:write"] }, rateLimit: { bucket: "write" }, concurrency: "none" }, responses: { 201: jsonResponse(z.object({ data: ruleSchema }), "Routing rule"), ...errorResponses([400, 401, 403, 404, 409, 422, 429, 500]) },
}, async (context) => {
  const { eventId } = context.req.valid("param");
  const body = context.req.valid("json");
  const payload = payloadOf(body);
  const conditions = await validateRuleReferences(context.env.DB, eventId, payload.conditions, payload.action);
  const count = await context.env.DB.prepare("SELECT COUNT(*) AS count FROM routing_rules WHERE event_id = ? AND deleted_at IS NULL").bind(eventId).first<{ count: number }>();
  const now = Date.now();
  const id = crypto.randomUUID();
  try {
    await context.env.DB.prepare(`INSERT INTO routing_rules (id, event_id, name, when_json, then_json, position, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, eventId, body.name, JSON.stringify({ all: conditions }), JSON.stringify(payload.action), body.position ?? Number(count?.count ?? 0), body.enabled === false ? 0 : 1, now, now).run();
  } catch (error) { if (error instanceof Error && /unique|constraint/i.test(error.message)) throw ApiError.conflict("A routing rule with this position already exists."); throw error; }
  const row = await context.env.DB.prepare("SELECT id, event_id, name, when_json, then_json, position, enabled, deleted_at, updated_at FROM routing_rules WHERE id = ? AND event_id = ?").bind(id, eventId).first<any>();
  return context.json({ data: await ruleView(context.env.DB, eventId, row) }, 201);
});

const updateRule = defineApiRoute({
  method: "patch", path: "/api/v1/events/{eventId}/routing-rules/{ruleId}", operationId: "updateRoutingRule", summary: "Update a conference routing rule", tags: ["Routing rules"], request: { params: ruleParams, body: { content: { "application/json": { schema: rulePatch } } } }, policy: { auth: { kind: "grants", grants: ["program:write"] }, rateLimit: { bucket: "write" }, concurrency: "none" }, responses: { 200: jsonResponse(z.object({ data: ruleSchema }), "Routing rule"), ...errorResponses([400, 401, 403, 404, 409, 422, 429, 500]) },
}, async (context) => {
  const { eventId, ruleId } = context.req.valid("param");
  const current = await context.env.DB.prepare("SELECT * FROM routing_rules WHERE id = ? AND event_id = ? AND deleted_at IS NULL").bind(ruleId, eventId).first<any>();
  if (!current) throw ApiError.notFound("routing rule not found");
  const body = context.req.valid("json");
  const currentWhen = storedJsonObject(current.when_json);
  const currentThen = storedJsonObject(current.then_json);
  const payload = {
    conditions: body.when_json?.all ?? body.when?.all ?? currentWhen.all,
    action: (body.then_json ?? body.then ?? currentThen) as Action,
  };
  if (!Array.isArray(payload.conditions)) throw ApiError.unprocessable("A routing rule needs conditions.", "when_json");
  const conditions = await validateRuleReferences(context.env.DB, eventId, payload.conditions, payload.action);
  await context.env.DB.prepare(`UPDATE routing_rules SET name = ?, when_json = ?, then_json = ?, position = ?, enabled = ?, updated_at = ? WHERE id = ? AND event_id = ?`).bind(body.name ?? current.name, JSON.stringify({ all: conditions }), JSON.stringify(payload.action), body.position ?? current.position, body.enabled === undefined ? current.enabled : body.enabled ? 1 : 0, Date.now(), ruleId, eventId).run();
  const row = await context.env.DB.prepare("SELECT id, event_id, name, when_json, then_json, position, enabled, deleted_at, updated_at FROM routing_rules WHERE id = ? AND event_id = ?").bind(ruleId, eventId).first<any>();
  return context.json({ data: await ruleView(context.env.DB, eventId, row) }, 200);
});

const deleteRule = defineApiRoute({
  method: "delete", path: "/api/v1/events/{eventId}/routing-rules/{ruleId}", operationId: "deleteRoutingRule", summary: "Archive a conference routing rule", tags: ["Routing rules"], request: { params: ruleParams }, policy: { auth: { kind: "grants", grants: ["program:write"] }, rateLimit: { bucket: "write" }, concurrency: "none" }, responses: { 200: jsonResponse(z.object({ data: ruleSchema }), "Archived routing rule"), ...errorResponses([401, 403, 404, 429, 500]) },
}, async (context) => {
  const { eventId, ruleId } = context.req.valid("param");
  const current = await context.env.DB.prepare("SELECT * FROM routing_rules WHERE id = ? AND event_id = ? AND deleted_at IS NULL").bind(ruleId, eventId).first<any>();
  if (!current) throw ApiError.notFound("routing rule not found");
  await context.env.DB.prepare("UPDATE routing_rules SET deleted_at = ?, enabled = 0, updated_at = ? WHERE id = ? AND event_id = ?").bind(Date.now(), Date.now(), ruleId, eventId).run();
  const row = { ...current, deleted_at: Date.now(), enabled: 0, updated_at: Date.now() };
  return context.json({ data: await ruleView(context.env.DB, eventId, row) }, 200);
});

const reorderRules = defineApiRoute({
  method: "patch", path: "/api/v1/events/{eventId}/routing-rules/reorder", operationId: "reorderRoutingRules", summary: "Reorder conference routing rules", tags: ["Routing rules"], request: { params: eventParams, body: { content: { "application/json": { schema: reorderInput } } } }, policy: { auth: { kind: "grants", grants: ["program:write"] }, rateLimit: { bucket: "write" }, concurrency: "none" }, responses: { 200: jsonResponse(z.object({ data: z.array(ruleSchema) }), "Reordered routing rules"), ...errorResponses([401, 403, 404, 422, 429, 500]) },
}, async (context) => {
  const { eventId } = context.req.valid("param");
  const body = context.req.valid("json");
  const rows = await context.env.DB.prepare("SELECT id FROM routing_rules WHERE event_id = ? AND deleted_at IS NULL ORDER BY position, id").bind(eventId).all<{ id: string }>();
  const ids = rows.results.map((row) => row.id);
  const index = ids.indexOf(body.rule_id);
  if (index < 0) throw ApiError.notFound("routing rule not found");
  ids.splice(index, 1); ids.splice(Math.min(body.position, ids.length), 0, body.rule_id);
  await context.env.DB.batch(ids.map((id, position) => context.env.DB.prepare("UPDATE routing_rules SET position = ?, updated_at = ? WHERE id = ? AND event_id = ?").bind(position, Date.now(), id, eventId)));
  return context.json({ data: await readRules(context.env.DB, eventId) }, 200);
});

async function listTaxonomy(db: D1Database, table: "tags" | "levels", eventId: string) {
  return (await db.prepare(`SELECT id, event_id, name, name_key, position, deleted_at, updated_at FROM ${table} WHERE event_id = ? AND deleted_at IS NULL ORDER BY position, id`).bind(eventId).all()).results;
}

async function reorderTaxonomy(db: D1Database, table: "tags" | "levels", eventId: string, id: string, requestedPosition: number): Promise<void> {
  const rows = await db.prepare(`SELECT id FROM ${table} WHERE event_id = ? AND deleted_at IS NULL ORDER BY position, id`).bind(eventId).all<{ id: string }>();
  const ordered = rows.results.map((row) => row.id);
  const current = ordered.indexOf(id);
  if (current < 0) throw ApiError.notFound(`${table.slice(0, -1)} not found`);
  ordered.splice(current, 1);
  ordered.splice(Math.min(Math.max(requestedPosition, 0), ordered.length), 0, id);
  const now = Date.now();
  await db.batch(ordered.map((item, position) => db.prepare(`UPDATE ${table} SET position = ?, updated_at = ? WHERE id = ? AND event_id = ?`).bind(position, now, item, eventId)));
}

function taxonomyRoutes(table: "tags" | "levels") {
  const plural = table;
  const singular = table === "tags" ? "tag" : "level";
  const params = table === "tags" ? tagParams : levelParams;
  const schema = table === "tags" ? tagSchema : levelSchema;
  const list = defineApiRoute({ method: "get", path: `/api/v1/events/{eventId}/${plural}`, operationId: `listEvent${singular}s`, summary: `List event ${plural}`, tags: ["Routing rules"], request: { params: eventParams }, policy: { auth: { kind: "grants", grants: ["program:read"] }, rateLimit: { bucket: "read" }, concurrency: "none" }, responses: { 200: jsonResponse(z.object({ data: z.array(schema) }), `${plural}`), ...errorResponses([401, 403, 404, 429, 500]) } }, async (context) => context.json({ data: await listTaxonomy(context.env.DB, table, context.req.valid("param").eventId) }, 200));
  const create = defineApiRoute({ method: "post", path: `/api/v1/events/{eventId}/${plural}`, operationId: `createEvent${singular}`, summary: `Create event ${singular}`, tags: ["Routing rules"], request: { params: eventParams, body: { content: { "application/json": { schema: taxonomyInput } } } }, policy: { auth: { kind: "grants", grants: ["program:write"] }, rateLimit: { bucket: "write" }, concurrency: "none" }, responses: { 201: jsonResponse(z.object({ data: schema }), singular), ...errorResponses([401, 403, 404, 409, 422, 429, 500]) } }, async (context) => {
    const { eventId } = context.req.valid("param"); const body = context.req.valid("json"); const name = normalizeTaxonomyName(body.name); const key = taxonomyNameKey(name); const count = await context.env.DB.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE event_id = ? AND deleted_at IS NULL`).bind(eventId).first<{ count: number }>(); const now = Date.now(); const id = crypto.randomUUID();
    try { await context.env.DB.prepare(`INSERT INTO ${table} (id, event_id, name, name_key, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(id, eventId, name, key, body.position ?? Number(count?.count ?? 0), now, now).run(); } catch (error) { if (error instanceof Error && /unique|constraint/i.test(error.message)) throw ApiError.conflict(`${singular} name is already in use`); throw error; }
    const row = await context.env.DB.prepare(`SELECT id, event_id, name, name_key, position, deleted_at, updated_at FROM ${table} WHERE id = ?`).bind(id).first(); return context.json({ data: row }, 201);
  });
  const update = defineApiRoute({ method: "patch", path: `/api/v1/events/{eventId}/${plural}/{${singular}Id}`, operationId: `updateEvent${singular}`, summary: `Update event ${singular}`, tags: ["Routing rules"], request: { params, body: { content: { "application/json": { schema: taxonomyPatch } } } }, policy: { auth: { kind: "grants", grants: ["program:write"] }, rateLimit: { bucket: "write" }, concurrency: "none" }, responses: { 200: jsonResponse(z.object({ data: schema }), singular), ...errorResponses([401, 403, 404, 409, 422, 429, 500]) } }, async (context) => {
    const ids = context.req.valid("param") as { eventId: string; tagId?: string; levelId?: string }; const id = ids.tagId ?? ids.levelId!; const current = await context.env.DB.prepare(`SELECT * FROM ${table} WHERE id = ? AND event_id = ? AND deleted_at IS NULL`).bind(id, ids.eventId).first<any>(); if (!current) throw ApiError.notFound(`${singular} not found`); const body = context.req.valid("json"); const name = body.name === undefined ? current.name : normalizeTaxonomyName(body.name); const key = taxonomyNameKey(name); try { await context.env.DB.prepare(`UPDATE ${table} SET name = ?, name_key = ?, updated_at = ? WHERE id = ? AND event_id = ?`).bind(name, key, Date.now(), id, ids.eventId).run(); } catch (error) { if (error instanceof Error && /unique|constraint/i.test(error.message)) throw ApiError.conflict(`${singular} name is already in use`); throw error; } if (body.position !== undefined) await reorderTaxonomy(context.env.DB, table, ids.eventId, id, body.position); const row = await context.env.DB.prepare(`SELECT id, event_id, name, name_key, position, deleted_at, updated_at FROM ${table} WHERE id = ?`).bind(id).first(); return context.json({ data: row }, 200);
  });
  const remove = defineApiRoute({ method: "delete", path: `/api/v1/events/{eventId}/${plural}/{${singular}Id}`, operationId: `deleteEvent${singular}`, summary: `Archive event ${singular}`, tags: ["Routing rules"], request: { params }, policy: { auth: { kind: "grants", grants: ["program:write"] }, rateLimit: { bucket: "write" }, concurrency: "none" }, responses: { 200: jsonResponse(z.object({ data: schema }), singular), ...errorResponses([401, 403, 404, 429, 500]) } }, async (context) => { const ids = context.req.valid("param") as { eventId: string; tagId?: string; levelId?: string }; const id = ids.tagId ?? ids.levelId!; const now = Date.now(); const current = await context.env.DB.prepare(`SELECT * FROM ${table} WHERE id = ? AND event_id = ? AND deleted_at IS NULL`).bind(id, ids.eventId).first<any>(); if (!current) throw ApiError.notFound(`${singular} not found`); await context.env.DB.prepare(`UPDATE ${table} SET deleted_at = ?, updated_at = ? WHERE id = ? AND event_id = ?`).bind(now, now, id, ids.eventId).run(); return context.json({ data: { ...current, deleted_at: now, updated_at: now } }, 200); });
  const reorder = defineApiRoute({ method: "patch", path: `/api/v1/events/{eventId}/${plural}/reorder`, operationId: `reorderEvent${singular}s`, summary: `Reorder event ${plural}`, tags: ["Routing rules"], request: { params: eventParams, body: { content: { "application/json": { schema: taxonomyReorderInput } } } }, policy: { auth: { kind: "grants", grants: ["program:write"] }, rateLimit: { bucket: "write" }, concurrency: "none" }, responses: { 200: jsonResponse(z.object({ data: z.array(schema) }), `Reordered ${plural}`), ...errorResponses([401, 403, 404, 422, 429, 500]) } }, async (context) => {
    const { eventId } = context.req.valid("param");
    const body = context.req.valid("json");
    const id = table === "tags" ? body.tag_id : body.level_id;
    if (!id) throw ApiError.unprocessable(`Provide ${singular}_id to reorder this ${singular}.`, `${singular}_id`);
    await reorderTaxonomy(context.env.DB, table, eventId, id, body.position);
    return context.json({ data: await listTaxonomy(context.env.DB, table, eventId) }, 200);
  });
  return [list, create, reorder, update, remove];
}

export const apiRoutes = [listRules, createRule, reorderRules, updateRule, deleteRule, ...taxonomyRoutes("tags"), ...taxonomyRoutes("levels")];
