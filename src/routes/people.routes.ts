/**
 * People — the organization-level person record.
 *
 * These endpoints sit at `/api/v1/org/*` rather than under a conference on
 * purpose: a person belongs to the organization and outlives any one
 * conference, which is the whole point of the area. `?event_id=` narrows the
 * same list to one conference's roster population — one query, two entrances.
 *
 * Notes, tags, and stage moves all append to `person_events` and are read back
 * from it. Nothing here keeps state in the browser: the drawer's note is on the
 * server before the composer clears, so a reload shows it.
 */
import { z } from "@hono/zod-openapi";

import { ApiError } from "../api/errors";
import { newUlid } from "../api/ids";
import { LIST_DEFAULTS } from "../api/list";
import { executeListPage, parsePagination } from "../api/pagination";
import { defineApiRoute, errorResponses, jsonResponse } from "../api/route";
import { requireOrgAccess } from "../lib/auth/org-access";
import {
  currentCard,
  foldNotes,
  foldStageHistory,
  foldTags,
  PIPELINE_STAGES,
  PIPELINE_STAGE_IDS,
  pipelineStageName,
  type PersonEventRow,
} from "../lib/person-annotations";
import { normalizeEmail } from "../lib/sessionize-import";
import {
  buildPeopleQuery,
  listPeopleFacets,
  parseTags,
  PEOPLE_SORTS,
  resolveListScope,
  type PersonListRow,
} from "./people.queries";

const personParams = z.object({ personId: z.string().min(1) });

export const peopleListQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  company: z.string().trim().max(200).optional(),
  title: z.string().trim().max(200).optional(),
  tag: z.string().trim().max(80).optional(),
  stage: z.enum(PIPELINE_STAGE_IDS as unknown as [string, ...string[]]).optional(),
  list_id: z.string().trim().min(1).optional(),
  event_id: z.string().trim().min(1).optional()
    .describe("Narrow the same query to one conference's roster population."),
  // The directory predates the shared list contract but is pasted and
  // hand-edited exactly like every list built on it, so its navigational
  // parameters degrade to the endpoint's defaults rather than 400-ing the
  // whole roster away. Filters above stay strict. As in `createListQuerySchema`,
  // `.catch()` is opaque to the OpenAPI generator, so each field restates its
  // shape explicitly rather than throwing while the document is built.
  page: z.coerce.number().int().min(1).optional().catch(undefined)
    .openapi({ type: "integer", minimum: 1 }),
  per_page: z.coerce.number().int().min(1).max(LIST_DEFAULTS.maxPerPage).optional().catch(undefined)
    .openapi({ type: "integer", minimum: 1, maximum: LIST_DEFAULTS.maxPerPage }),
  sort: z.enum(Object.keys(PEOPLE_SORTS) as [string, ...string[]]).optional().catch(undefined)
    .openapi({ type: "string", enum: Object.keys(PEOPLE_SORTS) }),
  format: z.enum(["json", "csv"]).optional().catch(undefined)
    .openapi({ type: "string", enum: ["json", "csv"] }),
});

const personSummary = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  title: z.string().nullable(),
  company: z.string().nullable(),
  bio: z.string().nullable(),
  headshot_attachment_id: z.string().nullable(),
  tags: z.array(z.string()),
  stage: z.string().nullable(),
  do_not_contact: z.boolean(),
  outreach_target_event_id: z.string().nullable(),
  outreach_target_event_name: z.string().nullable(),
  outreach_next_touch_on: z.string().nullable(),
  conference_count: z.number().int().nonnegative(),
  last_contact_at: z.number().int().nullable(),
  created_at: z.number().int(),
  updated_at: z.number().int(),
}).openapi("Person");

const facetSchema = z.array(z.object({ value: z.string(), count: z.number().int() }));
const peopleListResponse = z.object({
  data: z.array(personSummary),
  page: z.number().int(),
  per_page: z.number().int(),
  total: z.number().int(),
  total_pages: z.number().int(),
  facets: z.object({ company: facetSchema, title: facetSchema, tag: facetSchema }),
}).openapi("PersonList");

const noteSchema = z.object({
  id: z.string(),
  body: z.string(),
  actor_person_id: z.string().nullable(),
  actor_name: z.string().nullable(),
  created_at: z.number().int(),
});
const targetEventSchema = z.object({ id: z.string(), name: z.string() });
const stageEntrySchema = z.object({
  id: z.string(),
  stage: z.string(),
  stage_name: z.string(),
  score: z.number().nullable(),
  rationale: z.string().nullable(),
  actor_person_id: z.string().nullable(),
  actor_name: z.string().nullable(),
  created_at: z.number().int(),
  target_event_id: z.string().nullable(),
  target_event_name: z.string().nullable().optional(),
  next_touch_on: z.string().nullable(),
});
const connectionSchema = z.object({
  submission_id: z.string(),
  title: z.string(),
  status: z.string(),
  role: z.string(),
  event_id: z.string(),
  event_name: z.string(),
});
const activitySchema = z.object({
  id: z.string(),
  kind: z.string(),
  summary: z.string(),
  actor_name: z.string().nullable(),
  created_at: z.number().int(),
});
const personRecordResponse = z.object({
  person: personSummary,
  notes: z.array(noteSchema),
  connections: z.array(connectionSchema),
  activity: z.array(activitySchema),
  stage_history: z.array(stageEntrySchema),
  card: stageEntrySchema.nullable(),
  target_events: z.array(targetEventSchema),
}).openapi("PersonRecord");

const personInput = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(320),
  title: z.string().trim().max(200).optional(),
  company: z.string().trim().max(200).optional(),
  bio: z.string().trim().max(5000).optional(),
  do_not_contact: z.boolean().optional(),
});
const personPatch = personInput.partial();

function rowResponse(row: PersonListRow) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    title: row.title,
    company: row.company,
    bio: row.bio,
    headshot_attachment_id: row.headshot_attachment_id,
    tags: parseTags(row.tags_json),
    stage: row.stage,
    do_not_contact: Number(row.do_not_contact) === 1,
    outreach_target_event_id: row.outreach_target_event_id,
    outreach_target_event_name: row.outreach_target_event_name,
    outreach_next_touch_on: row.outreach_next_touch_on,
    conference_count: Number(row.conference_count ?? 0),
    last_contact_at: row.last_contact_at === null ? null : Number(row.last_contact_at),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** Every annotation on one person, newest first, with the actor's name resolved. */
export async function readPersonEvents(db: D1Database, personId: string): Promise<PersonEventRow[]> {
  const result = await db
    .prepare(
      `SELECT annotation.id, annotation.person_id, annotation.kind, annotation.value_json,
              annotation.actor_person_id, annotation.created_at,
              annotation.target_event_id, annotation.next_touch_on,
              actor.name AS actor_name
       FROM person_events annotation
       LEFT JOIN people actor ON actor.id = annotation.actor_person_id
       WHERE annotation.person_id = ?
       ORDER BY annotation.created_at DESC, annotation.id DESC
       LIMIT 400`,
    )
    .bind(personId)
    .all<PersonEventRow>();
  return result.results;
}

async function appendPersonEvent(input: {
  db: D1Database;
  orgId: string;
  personId: string;
  kind: "note" | "tag" | "stage";
  value: Record<string, unknown>;
  actorPersonId: string | null;
  targetEventId?: string | null;
  nextTouchOn?: string | null;
  now?: number;
}): Promise<{ id: string; created_at: number }> {
  const id = newUlid();
  const createdAt = input.now ?? Date.now();
  await input.db
    .prepare(
      `INSERT INTO person_events
        (id, org_id, person_id, kind, value_json, actor_person_id, target_event_id, next_touch_on, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.orgId,
      input.personId,
      input.kind,
      JSON.stringify(input.value),
      input.actorPersonId,
      input.targetEventId ?? null,
      input.nextTouchOn ?? null,
      createdAt,
    )
    .run();
  return { id, created_at: createdAt };
}

/** One person, read through the same projection the list uses. */
export async function requirePerson(db: D1Database, orgId: string, personId: string): Promise<PersonListRow> {
  const built = buildPeopleQuery({ orgId, personId });
  const row = await db.prepare(built.dataSql).bind(...built.dataBindings).first<PersonListRow>();
  if (!row) throw ApiError.notFound("person not found in this organization");
  return row;
}

function csvCell(value: unknown): string {
  return `"${String(value ?? "").replaceAll('"', '""').replaceAll("\n", " ").replaceAll("\r", " ")}"`;
}

function peopleCsv(rows: readonly PersonListRow[]): string {
  const lines = [[
    "id",
    "name",
    "email",
    "company",
    "title",
    "stage",
    "target_event",
    "next_touch_on",
    "do_not_contact",
  ].map(csvCell).join(",")];
  for (const row of rows) {
    lines.push([
      row.id,
      row.name,
      row.email,
      row.company,
      row.title,
      row.stage,
      row.outreach_target_event_name,
      row.outreach_next_touch_on,
      Number(row.do_not_contact) === 1 ? "true" : "false",
    ].map(csvCell).join(","));
  }
  return `${lines.join("\n")}\n`;
}

const listPeople = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/org/people",
    operationId: "listOrgPeople",
    summary: "List the organization's people",
    description:
      "Everyone this organization has worked with, across every conference. Search, filters, sort, and paging are server-side. Pass event_id to narrow the same query to one conference's roster. An unknown list_id is not an empty List and returns 404.",
    tags: ["People"],
    request: { query: peopleListQuerySchema },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "read" }, concurrency: "none" },
    responses: {
      200: {
        content: {
          "application/json": { schema: peopleListResponse },
          "text/csv": { schema: z.string() },
        },
        description: "People or a server-filtered CSV export",
      },
      ...errorResponses([400, 401, 403, 404, 429, 500]),
    },
  },
  async (context) => {
    const access = requireOrgAccess(context);
    const query = context.req.valid("query");
    const page = parsePagination({ page: query.page, per_page: query.per_page });
    // A Live list is a saved filter, not a membership, so it has to be resolved
    // before the query is built or it matches nobody. It arrives as an id
    // restriction rather than as filters precisely so the caller's own chips
    // AND with it — see `resolveListScope`, where merging them was the bug.
    const resolvedList = query.list_id
      ? await resolveListScope(context.env.DB, access.orgId, query.list_id)
      : { found: true, filters: {} };
    if (!resolvedList.found) throw ApiError.notFound("list not found");
    const input = {
      orgId: access.orgId,
      ...resolvedList.filters,
      ...(query.q ? { q: query.q } : {}),
      ...(query.company ? { company: query.company } : {}),
      ...(query.title ? { title: query.title } : {}),
      ...(query.tag ? { tag: query.tag } : {}),
      ...(query.stage ? { stage: query.stage } : {}),
      ...(query.event_id ? { eventId: query.event_id } : {}),
      ...(query.sort ? { sort: query.sort } : {}),
    };
    if (query.format === "csv") {
      const built = buildPeopleQuery(input);
      const rows = await context.env.DB.prepare(built.dataSql).bind(...built.dataBindings).all<PersonListRow>();
      return new Response(peopleCsv(rows.results), {
        headers: {
          "Content-Disposition": "attachment; filename=marquee-people.csv",
          "Content-Type": "text/csv; charset=utf-8",
        },
      });
    }
    const built = buildPeopleQuery({
      ...input,
      page,
    });
    const [envelope, facets] = await Promise.all([
      executeListPage<PersonListRow>({
        count: context.env.DB.prepare(built.countSql).bind(...built.countBindings),
        data: context.env.DB.prepare(built.dataSql).bind(...built.dataBindings),
        page,
      }),
      listPeopleFacets(context.env.DB, input),
    ]);
    return context.json({ ...envelope, data: envelope.data.map(rowResponse), facets }, 200);
  },
);

const createPerson = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/org/people",
    operationId: "createOrgPerson",
    summary: "Add a person to the organization",
    description: "Matched on email: an address already in the organization is updated rather than duplicated.",
    tags: ["People"],
    request: { body: { content: { "application/json": { schema: personInput } } } },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 201: jsonResponse(z.object({ person: personSummary }), "Person"), ...errorResponses([400, 401, 403, 429, 500]) },
  },
  async (context) => {
    const access = requireOrgAccess(context, true);
    const body = context.req.valid("json");
    const email = normalizeEmail(body.email);
    const now = Date.now();
    const existing = await context.env.DB
      .prepare("SELECT id FROM people WHERE org_id = ? AND email = ?")
      .bind(access.orgId, email)
      .first<{ id: string }>();
    const id = existing?.id ?? newUlid(now);
    if (existing) {
      await context.env.DB.prepare(
        `UPDATE people SET name = ?, title = COALESCE(?, title), company = COALESCE(?, company),
                bio = COALESCE(?, bio), updated_at = ? WHERE id = ?`,
      ).bind(body.name, body.title ?? null, body.company ?? null, body.bio ?? null, now, id).run();
      if (body.do_not_contact !== undefined) {
        await context.env.DB.prepare("UPDATE people SET do_not_contact = ? WHERE id = ? AND org_id = ?")
          .bind(body.do_not_contact ? 1 : 0, id, access.orgId)
          .run();
      }
    } else {
      await context.env.DB.prepare(
        `INSERT INTO people
          (id, org_id, email, name, title, company, bio, social_links, custom_fields, is_demo, do_not_contact, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, '[]', '{}', 0, ?, ?, ?)`,
      ).bind(
        id,
        access.orgId,
        email,
        body.name,
        body.title ?? null,
        body.company ?? null,
        body.bio ?? null,
        body.do_not_contact ? 1 : 0,
        now,
        now,
      ).run();
    }
    return context.json({ person: rowResponse(await requirePerson(context.env.DB, access.orgId, id)) }, 201);
  },
);

const getPerson = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/org/people/{personId}",
    operationId: "getOrgPerson",
    summary: "Read one person's whole record",
    description:
      "Identity, tags, internal notes, connections across every conference, the activity feed, and the Outreach card — one read, because the profile is one scrolling drawer rather than a tab chain.",
    tags: ["People"],
    request: { params: personParams },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "read" }, concurrency: "none" },
    responses: { 200: jsonResponse(personRecordResponse, "Person record"), ...errorResponses([401, 403, 404, 429, 500]) },
  },
  async (context) => {
    const access = requireOrgAccess(context);
    const { personId } = context.req.valid("param");
    const person = await requirePerson(context.env.DB, access.orgId, personId);
    const [annotations, connections, audit, messages, targetEvents] = await Promise.all([
      readPersonEvents(context.env.DB, personId),
      context.env.DB.prepare(
        `SELECT participation.submission_id, participation.role, submission.title, submission.status,
                submission.event_id, conference.name AS event_name
         FROM participations participation
         JOIN submissions submission ON submission.id = participation.submission_id
         JOIN events conference ON conference.id = submission.event_id
         WHERE participation.person_id = ?
         ORDER BY conference.starts_on DESC, submission.title COLLATE NOCASE ASC
         LIMIT 100`,
      ).bind(personId).all<{ submission_id: string; role: string; title: string; status: string; event_id: string; event_name: string }>(),
      context.env.DB.prepare(
        `SELECT entry.id, entry.action, entry.created_at, actor.name AS actor_name
         FROM audit_log entry
         LEFT JOIN people actor ON actor.id = entry.actor_person_id
         WHERE entry.entity_type = 'person' AND entry.entity_id = ?
         ORDER BY entry.created_at DESC LIMIT 40`,
      ).bind(personId).all<{ id: string; action: string; created_at: number; actor_name: string | null }>(),
      context.env.DB.prepare(
        `SELECT id, subject, status, created_at FROM outbox
         WHERE person_id = ? ORDER BY created_at DESC LIMIT 40`,
      ).bind(personId).all<{ id: string; subject: string; status: string; created_at: number }>(),
      context.env.DB.prepare(
        "SELECT id, name FROM events WHERE org_id = ? ORDER BY starts_on ASC, id ASC",
      ).bind(access.orgId).all<{ id: string; name: string }>(),
    ]);
    // The activity feed is the annotations log plus what the rest of the product
    // already records about this person. It is assembled, never stored.
    const activity = [
      ...annotations.map((row) => ({
        id: row.id,
        kind: row.kind,
        summary: row.kind === "note"
          ? "Note added"
          : row.kind === "tag"
          ? `Tag ${JSON.parse(row.value_json).op === "remove" ? "removed" : "added"} — ${JSON.parse(row.value_json).tag}`
          : `Moved to ${pipelineStageName(String(JSON.parse(row.value_json).stage))}`,
        actor_name: row.actor_name ?? null,
        created_at: row.created_at,
      })),
      ...audit.results.map((row) => ({
        id: row.id,
        kind: "audit",
        summary: row.action,
        actor_name: row.actor_name,
        created_at: row.created_at,
      })),
      ...messages.results.map((row) => ({
        id: row.id,
        kind: "email",
        summary: `Email ${row.status} — “${row.subject}”`,
        actor_name: null,
        created_at: row.created_at,
      })),
    ].sort((left, right) => right.created_at - left.created_at).slice(0, 60);
    const targetNames = new Map(targetEvents.results.map((event) => [event.id, event.name]));
    const stageHistory = foldStageHistory(annotations).map((entry) => ({
      ...entry,
      target_event_name: entry.target_event_id ? targetNames.get(entry.target_event_id) ?? null : null,
    }));
    const card = currentCard(annotations);
    return context.json({
      person: rowResponse(person),
      notes: foldNotes(annotations),
      connections: connections.results.map((row) => ({
        submission_id: row.submission_id,
        title: row.title,
        status: row.status,
        role: row.role,
        event_id: row.event_id,
        event_name: row.event_name,
      })),
      activity,
      stage_history: stageHistory,
      card: card
        ? { ...card, target_event_name: card.target_event_id ? targetNames.get(card.target_event_id) ?? null : null }
        : null,
      target_events: targetEvents.results,
    }, 200);
  },
);

const updatePerson = defineApiRoute(
  {
    method: "patch",
    path: "/api/v1/org/people/{personId}",
    operationId: "updateOrgPerson",
    summary: "Update a person's identity",
    tags: ["People"],
    request: { params: personParams, body: { content: { "application/json": { schema: personPatch } } } },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 200: jsonResponse(z.object({ person: personSummary }), "Person"), ...errorResponses([400, 401, 403, 404, 429, 500]) },
  },
  async (context) => {
    const access = requireOrgAccess(context, true);
    const { personId } = context.req.valid("param");
    await requirePerson(context.env.DB, access.orgId, personId);
    const body = context.req.valid("json");
    const now = Date.now();
    await context.env.DB.prepare(
      `UPDATE people SET name = COALESCE(?, name), email = COALESCE(?, email), title = COALESCE(?, title),
              company = COALESCE(?, company), bio = COALESCE(?, bio),
              do_not_contact = CASE WHEN ? IS NULL THEN do_not_contact ELSE ? END,
              updated_at = ?
       WHERE id = ? AND org_id = ?`,
    ).bind(
      body.name ?? null,
      body.email ? normalizeEmail(body.email) : null,
      body.title ?? null,
      body.company ?? null,
      body.bio ?? null,
      body.do_not_contact === undefined ? null : body.do_not_contact ? 1 : 0,
      body.do_not_contact === undefined ? null : body.do_not_contact ? 1 : 0,
      now,
      personId,
      access.orgId,
    ).run();
    return context.json({ person: rowResponse(await requirePerson(context.env.DB, access.orgId, personId)) }, 200);
  },
);

const addNote = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/org/people/{personId}/notes",
    operationId: "addOrgPersonNote",
    summary: "Write an internal note on a person",
    description: "Notes are internal, org-level, and never visible to the person. They persist across conferences.",
    tags: ["People"],
    request: {
      params: personParams,
      body: { content: { "application/json": { schema: z.object({ body: z.string().trim().min(1).max(5000) }) } } },
    },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 201: jsonResponse(z.object({ note: noteSchema }), "Note"), ...errorResponses([400, 401, 403, 404, 429, 500]) },
  },
  async (context) => {
    const access = requireOrgAccess(context, true);
    const { personId } = context.req.valid("param");
    await requirePerson(context.env.DB, access.orgId, personId);
    const body = context.req.valid("json");
    const written = await appendPersonEvent({
      db: context.env.DB,
      orgId: access.orgId,
      personId,
      kind: "note",
      value: { body: body.body },
      actorPersonId: access.personId,
    });
    const actor = access.personId
      ? await context.env.DB.prepare("SELECT name FROM people WHERE id = ?").bind(access.personId).first<{ name: string }>()
      : null;
    return context.json({
      note: {
        id: written.id,
        body: body.body,
        actor_person_id: access.personId,
        actor_name: actor?.name ?? null,
        created_at: written.created_at,
      },
    }, 201);
  },
);

const addTag = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/org/people/{personId}/tags",
    operationId: "addOrgPersonTag",
    summary: "Tag a person",
    tags: ["People"],
    request: {
      params: personParams,
      body: { content: { "application/json": { schema: z.object({ tag: z.string().trim().min(1).max(60) }) } } },
    },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 200: jsonResponse(z.object({ tags: z.array(z.string()) }), "Tags"), ...errorResponses([400, 401, 403, 404, 429, 500]) },
  },
  async (context) => {
    const access = requireOrgAccess(context, true);
    const { personId } = context.req.valid("param");
    await requirePerson(context.env.DB, access.orgId, personId);
    const { tag } = context.req.valid("json");
    await appendPersonEvent({
      db: context.env.DB,
      orgId: access.orgId,
      personId,
      kind: "tag",
      value: { tag, op: "add" },
      actorPersonId: access.personId,
    });
    return context.json({ tags: foldTags(await readPersonEvents(context.env.DB, personId)) }, 200);
  },
);

const removeTag = defineApiRoute(
  {
    method: "delete",
    path: "/api/v1/org/people/{personId}/tags/{tag}",
    operationId: "removeOrgPersonTag",
    summary: "Remove a tag from a person",
    description: "Appends a removal to the annotations log; nothing is deleted, so the history stays readable.",
    tags: ["People"],
    request: { params: personParams.extend({ tag: z.string().min(1) }) },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 200: jsonResponse(z.object({ tags: z.array(z.string()) }), "Tags"), ...errorResponses([400, 401, 403, 404, 429, 500]) },
  },
  async (context) => {
    const access = requireOrgAccess(context, true);
    const { personId, tag } = context.req.valid("param");
    await requirePerson(context.env.DB, access.orgId, personId);
    await appendPersonEvent({
      db: context.env.DB,
      orgId: access.orgId,
      personId,
      kind: "tag",
      value: { tag, op: "remove" },
      actorPersonId: access.personId,
    });
    return context.json({ tags: foldTags(await readPersonEvents(context.env.DB, personId)) }, 200);
  },
);

const moveStage = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/org/people/{personId}/stage",
    operationId: "setOrgPersonStage",
    summary: "Enroll a person in Outreach, or move their card",
    description:
      "One verb for both: enrolling is the first stage row, moving is the next one. The append-only log is the timestamped stage history.",
    tags: ["People"],
    request: {
      params: personParams,
      body: {
        content: {
          "application/json": {
            schema: z.object({
              stage: z.enum(PIPELINE_STAGE_IDS as unknown as [string, ...string[]]),
              score: z.number().int().min(0).max(100).optional(),
              rationale: z.string().trim().max(2000).optional(),
              target_event_id: z.string().trim().min(1).nullable().optional(),
              next_touch_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
            }),
          },
        },
      },
    },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: {
      200: jsonResponse(z.object({ card: stageEntrySchema, stage_history: z.array(stageEntrySchema) }), "Pipeline card"),
      ...errorResponses([400, 401, 403, 404, 429, 500]),
    },
  },
  async (context) => {
    const access = requireOrgAccess(context, true);
    const { personId } = context.req.valid("param");
    const person = await requirePerson(context.env.DB, access.orgId, personId);
    const body = context.req.valid("json");
    const targetEventId = body.target_event_id === undefined
      ? person.outreach_target_event_id
      : body.target_event_id;
    if (targetEventId) {
      const target = await context.env.DB
        .prepare("SELECT id FROM events WHERE id = ? AND org_id = ?")
        .bind(targetEventId, access.orgId)
        .first<{ id: string }>();
      if (!target) throw ApiError.notFound("target conference not found in this organization");
    }
    const nextTouchOn = body.stage === "confirmed" || body.stage === "declined"
      ? null
      : body.next_touch_on === undefined ? person.outreach_next_touch_on : body.next_touch_on;
    await appendPersonEvent({
      db: context.env.DB,
      orgId: access.orgId,
      personId,
      kind: "stage",
      value: {
        stage: body.stage,
        ...(body.score === undefined ? {} : { score: body.score }),
        ...(body.rationale === undefined ? {} : { rationale: body.rationale }),
      },
      actorPersonId: access.personId,
      targetEventId,
      nextTouchOn,
    });
    const annotations = await readPersonEvents(context.env.DB, personId);
    const card = currentCard(annotations);
    if (!card) throw new Error("stage_row_disappeared");
    return context.json({ card, stage_history: foldStageHistory(annotations) }, 200);
  },
);

const pipelineCardSchema = z.object({
  person_id: z.string(),
  name: z.string(),
  company: z.string().nullable(),
  stage: z.string(),
  score: z.number().nullable(),
  rationale: z.string().nullable(),
  moved_at: z.number().int(),
  target_event_id: z.string().nullable(),
  target_event_name: z.string().nullable(),
  next_touch_on: z.string().nullable(),
});

const getPipeline = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/org/pipeline",
    operationId: "getOrgPipeline",
    summary: "Read the Outreach board",
    description: "Six named stages including terminal won and lost, folded from the append-only annotations log.",
    tags: ["People"],
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "read" }, concurrency: "none" },
    responses: {
      200: jsonResponse(
        z.object({
          stages: z.array(z.object({ id: z.string(), name: z.string(), kind: z.string() })),
          cards: z.array(pipelineCardSchema),
          target_events: z.array(targetEventSchema),
        }).openapi("Outreach"),
        "Outreach",
      ),
      ...errorResponses([401, 403, 429, 500]),
    },
  },
  async (context) => {
    const access = requireOrgAccess(context);
    // One pass over the org's stage rows: the newest row per person is the card,
    // and the score/rationale fall back to the most recent row that stated one.
    const rows = await context.env.DB
      .prepare(
        `SELECT annotation.id, annotation.person_id, annotation.kind, annotation.value_json,
                annotation.actor_person_id, annotation.created_at,
                annotation.target_event_id, annotation.next_touch_on,
                person.name, person.company, target.name AS target_event_name
         FROM person_events annotation
         JOIN people person ON person.id = annotation.person_id
         LEFT JOIN events target ON target.id = annotation.target_event_id AND target.org_id = annotation.org_id
         WHERE annotation.org_id = ? AND annotation.kind = 'stage'
         ORDER BY annotation.created_at ASC, annotation.id ASC`,
      )
      .bind(access.orgId)
      .all<PersonEventRow & { name: string; company: string | null; target_event_name: string | null }>();
    const byPerson = new Map<string, Array<PersonEventRow & { name: string; company: string | null; target_event_name: string | null }>>();
    for (const row of rows.results) {
      const current = byPerson.get(row.person_id);
      if (current) current.push(row);
      else byPerson.set(row.person_id, [row]);
    }
    const cards = [...byPerson.entries()].flatMap(([personId, personRows]) => {
      const card = currentCard(personRows);
      if (!card) return [];
      const identity = personRows[personRows.length - 1]!;
      return [{
        person_id: personId,
        name: identity.name,
        company: identity.company,
        stage: card.stage,
        score: card.score,
        rationale: card.rationale,
        moved_at: card.created_at,
        target_event_id: card.target_event_id,
        target_event_name: identity.target_event_name,
        next_touch_on: card.next_touch_on,
      }];
    }).sort((left, right) => right.moved_at - left.moved_at || left.person_id.localeCompare(right.person_id));
    const targetEvents = await context.env.DB
      .prepare("SELECT id, name FROM events WHERE org_id = ? ORDER BY starts_on ASC, id ASC")
      .bind(access.orgId)
      .all<{ id: string; name: string }>();
    return context.json({ stages: PIPELINE_STAGES.map((stage) => ({ ...stage })), cards, target_events: targetEvents.results }, 200);
  },
);

const getSummary = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/org/summary",
    operationId: "getOrgSummary",
    summary: "Counts and one populated widget for the People header",
    description: "The counts the People strip states, plus the organization's top companies. A header, not a page.",
    tags: ["People"],
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "read" }, concurrency: "none" },
    responses: {
      200: jsonResponse(
        z.object({
          people: z.number().int(),
          conferences: z.number().int(),
          returning_speakers: z.number().int(),
          in_pipeline: z.number().int(),
          top_companies: z.array(z.object({ value: z.string(), count: z.number().int() })),
        }).openapi("OrgSummary"),
        "Organization summary",
      ),
      ...errorResponses([401, 403, 429, 500]),
    },
  },
  async (context) => {
    const access = requireOrgAccess(context);
    const [people, conferences, returning, pipeline, companies] = await Promise.all([
      context.env.DB.prepare("SELECT COUNT(*) AS total FROM people WHERE org_id = ?").bind(access.orgId).first<{ total: number }>(),
      context.env.DB.prepare("SELECT COUNT(*) AS total FROM events WHERE org_id = ?").bind(access.orgId).first<{ total: number }>(),
      context.env.DB.prepare(
        `SELECT COUNT(*) AS total FROM (
           SELECT participation.person_id
           FROM participations participation
           JOIN submissions submission ON submission.id = participation.submission_id
           JOIN people person ON person.id = participation.person_id
           WHERE person.org_id = ? AND participation.role IN ('speaker', 'co_speaker')
           GROUP BY participation.person_id
           HAVING COUNT(DISTINCT submission.event_id) > 1
         )`,
      ).bind(access.orgId).first<{ total: number }>(),
      context.env.DB.prepare(
        "SELECT COUNT(DISTINCT person_id) AS total FROM person_events WHERE org_id = ? AND kind = 'stage'",
      ).bind(access.orgId).first<{ total: number }>(),
      context.env.DB.prepare(
        `SELECT company AS value, COUNT(*) AS count FROM people
         WHERE org_id = ? AND company IS NOT NULL AND company <> ''
         GROUP BY company ORDER BY count DESC, company COLLATE NOCASE ASC LIMIT 5`,
      ).bind(access.orgId).all<{ value: string; count: number }>(),
    ]);
    return context.json({
      people: Number(people?.total ?? 0),
      conferences: Number(conferences?.total ?? 0),
      returning_speakers: Number(returning?.total ?? 0),
      in_pipeline: Number(pipeline?.total ?? 0),
      top_companies: companies.results,
    }, 200);
  },
);

export const apiRoutes = [
  listPeople,
  createPerson,
  getPerson,
  updatePerson,
  addNote,
  addTag,
  removeTag,
  moveStage,
  getPipeline,
  getSummary,
];
