/**
 * People — the org-level person record, and the ONE list query behind both
 * entrances to it.
 *
 * `buildPeopleQuery` is the single definition of "list people". `event_id` is
 * optional and is the only difference between the two surfaces the product
 * shows:
 *
 *   - **People** (`/people`, `GET /api/v1/org/people`) — no `eventId`: everyone
 *     this organization has ever worked with.
 *   - **the conference roster** — the same builder with `eventId` set, which
 *     restricts to `SPEAKER_ROSTER_PERSON_SOURCE`, imported from
 *     `speakers.queries.ts` so "who speaks at this conference" is defined once
 *     and cannot drift between the two screens.
 *
 * Two filter implementations would be two bugs. There is one.
 *
 * Search, filter, sort, and pagination are all SQL. At ~1,100 seeded rows a
 * client-side filter would look fine today and be a defect at real scale (R7),
 * and `idx_people_org_name` is what the default ordering leans on.
 *
 * Tags and pipeline stages are folded out of the append-only `person_events`
 * log rather than stored: a person carries a tag when the LATEST row for that
 * (person, tag) says `add`, and their stage is the LATEST `stage` row. That fold
 * lives here, in SQL, so filtering by tag or stage stays server-side too.
 */
import type { D1Database } from "@cloudflare/workers-types";
import { z } from "@hono/zod-openapi";

import { resolveSort, type PageParams, type SortRegistry } from "../api/pagination";
import { PIPELINE_STAGE_IDS } from "../lib/person-annotations";
import { SPEAKER_ROSTER_PERSON_SOURCE } from "../lib/roster-source";

/**
 * The saved filter behind a Live list. It lives beside the query rather than
 * beside the route because it IS this query's filter vocabulary — a Live list
 * is a saved call to `buildPeopleQuery`, nothing more.
 */
export const listConfigSchema = z.object({
  q: z.string().trim().max(200).default(""),
  company: z.string().trim().max(200).optional(),
  title: z.string().trim().max(200).optional(),
  tag: z.string().trim().max(80).optional(),
  stage: z.enum(PIPELINE_STAGE_IDS as unknown as [string, ...string[]]).optional(),
});

export type PersonListConfig = z.infer<typeof listConfigSchema>;

export function parseListConfig(value: string): PersonListConfig {
  try {
    return listConfigSchema.parse(JSON.parse(value) as unknown);
  } catch {
    return listConfigSchema.parse({});
  }
}

export function configFilters(config: PersonListConfig) {
  return {
    ...(config.q ? { q: config.q } : {}),
    ...(config.company ? { company: config.company } : {}),
    ...(config.title ? { title: config.title } : {}),
    ...(config.tag ? { tag: config.tag } : {}),
    ...(config.stage ? { stage: config.stage } : {}),
  };
}

/**
 * Turn `list_id` into a scope, which is not the same thing for both kinds.
 *
 * A **Fixed** list is its membership rows. A **Live** list has none — it is a
 * saved filter, and its members are whoever matches that filter right now — so
 * resolving it through `person_list_members` matches nobody. That is why
 * opening a Live list showed an empty table under a band naming a real count.
 *
 * Both kinds come back as an id restriction rather than as filters, and that is
 * load-bearing rather than tidy. `buildPeopleQuery` holds one value per key, so
 * a Live list merged in as filters would be *overwritten* by a caller's chip
 * naming the same field — searching "raman" inside a 12-person shortlist would
 * quietly show every Raman in the organization, under a band still reading
 * "Keynote shortlist · 12 people". As an intersection it cannot: the caller's
 * filters AND with the list instead of competing with it.
 *
 * An unknown or borrowed id keeps the membership clause, which is empty for a
 * list this org does not own — the safe direction. Dropping the clause instead
 * would answer a typo'd id with the entire organization.
 */
export async function resolveListScope(
  db: D1Database,
  orgId: string,
  listId: string,
): Promise<Partial<PeopleQueryInput>> {
  const row = await db
    .prepare("SELECT kind, config_json FROM person_lists WHERE id = ? AND org_id = ?")
    .bind(listId, orgId)
    .first<{ kind: string; config_json: string }>();
  if (!row || row.kind !== "live") return { listId };
  const saved = buildPeopleQuery({ orgId, ...configFilters(parseListConfig(row.config_json)) });
  return { personIdIn: { sql: saved.idsSql, bindings: saved.idsBindings } };
}

export const PEOPLE_SORTS: SortRegistry = {
  name: { column: "person.name COLLATE NOCASE", direction: "asc" },
  name_desc: { column: "person.name COLLATE NOCASE", direction: "desc" },
  company: { column: "person.company COLLATE NOCASE", direction: "asc", nullsLast: true },
  newest: { column: "person.created_at", direction: "desc" },
  updated: { column: "person.updated_at", direction: "desc" },
  last_contact: { column: "last_contact_at", direction: "desc", nullsLast: true },
};

export const DEFAULT_PEOPLE_SORT = "name";

export interface PeopleFilters {
  /** Free text over name, email, company, and job title. */
  q?: string;
  company?: string;
  title?: string;
  tag?: string;
  stage?: string;
  /** Restrict to a saved Fixed list's members. */
  listId?: string;
  /** Restrict to one conference's roster population — the roster entrance. */
  eventId?: string;
  /** Read exactly one person through the same projection the list uses. */
  personId?: string;
  /**
   * An id projection this query intersects with — how a Live list is applied.
   * Built by `resolveListScope`, never by a request, and always AND-ed, so a
   * caller's own filters can only narrow what it selects.
   */
  personIdIn?: { sql: string; bindings: (string | number)[] };
}

export interface PeopleQueryInput extends PeopleFilters {
  orgId?: string;
  sort?: string;
  page?: PageParams;
  /**
   * Extra projection for a caller that needs more of the person row than the
   * list shows. The conference roster uses this to add its membership columns
   * without forking the query — it is the same query, extended, which is the
   * whole point of there being one.
   */
  columns?: string;
  /** Extra JOIN clause for those columns; its bindings bind BEFORE the filters. */
  joins?: string;
  joinBindings?: (string | number)[];
}

export interface PersonListRow {
  id: string;
  name: string;
  email: string;
  title: string | null;
  company: string | null;
  bio: string | null;
  headshot_attachment_id: string | null;
  created_at: number;
  updated_at: number;
  /** Distinct conferences this person has any session on. */
  conference_count: number;
  /** Most recent queued/sent message to this person, or null. */
  last_contact_at: number | null;
  /** Folded from the annotations log; JSON array text from `json_group_array`. */
  tags_json: string | null;
  stage: string | null;
}

/**
 * The current value of one tag for one person: the newest row wins, so a tag
 * added, removed, and added again reads as present without any row ever being
 * updated or deleted.
 */
const LATEST_TAG_OP = `(
  SELECT json_extract(latest_tag.value_json, '$.op')
  FROM person_events latest_tag
  WHERE latest_tag.person_id = person.id AND latest_tag.kind = 'tag'
    AND json_extract(latest_tag.value_json, '$.tag') = ?
  ORDER BY latest_tag.created_at DESC, latest_tag.id DESC
  LIMIT 1
)`;

/** Every tag the person currently carries, as a JSON array, same fold. */
const CURRENT_TAGS = `(
  SELECT json_group_array(carried.tag) FROM (
    SELECT DISTINCT json_extract(tag_row.value_json, '$.tag') AS tag
    FROM person_events tag_row
    WHERE tag_row.person_id = person.id AND tag_row.kind = 'tag'
      AND json_extract(tag_row.value_json, '$.op') = (
        SELECT json_extract(newest.value_json, '$.op')
        FROM person_events newest
        WHERE newest.person_id = person.id AND newest.kind = 'tag'
          AND json_extract(newest.value_json, '$.tag') = json_extract(tag_row.value_json, '$.tag')
        ORDER BY newest.created_at DESC, newest.id DESC
        LIMIT 1
      )
      AND json_extract(tag_row.value_json, '$.op') = 'add'
    ORDER BY tag
  ) carried
)`;

/** The current pipeline stage: the newest `stage` row, or NULL if never enrolled. */
export const CURRENT_STAGE = `(
  SELECT json_extract(latest_stage.value_json, '$.stage')
  FROM person_events latest_stage
  WHERE latest_stage.person_id = person.id AND latest_stage.kind = 'stage'
  ORDER BY latest_stage.created_at DESC, latest_stage.id DESC
  LIMIT 1
)`;

const CONFERENCE_COUNT = `(
  SELECT COUNT(DISTINCT counted.event_id)
  FROM participations counted_part
  JOIN submissions counted ON counted.id = counted_part.submission_id
  WHERE counted_part.person_id = person.id
)`;

const LAST_CONTACT = `(
  SELECT MAX(contacted.created_at) FROM outbox contacted WHERE contacted.person_id = person.id
)`;

interface Clauses {
  where: string[];
  bindings: (string | number)[];
}

/**
 * The WHERE half, shared by the count and the page so the two can never
 * disagree about what "matching" means. Caller strings are always bound, never
 * interpolated.
 */
function filterClauses(input: PeopleQueryInput): Clauses {
  const where: string[] = [];
  const bindings: (string | number)[] = [];
  if (input.orgId) {
    where.push("person.org_id = ?");
    bindings.push(input.orgId);
  }
  if (input.eventId) {
    where.push(`person.id IN (${SPEAKER_ROSTER_PERSON_SOURCE})`);
    bindings.push(input.eventId, input.eventId);
  }
  const search = input.q?.trim();
  if (search) {
    where.push(`(person.name LIKE ? COLLATE NOCASE
      OR person.email LIKE ? COLLATE NOCASE
      OR IFNULL(person.company, '') LIKE ? COLLATE NOCASE
      OR IFNULL(person.title, '') LIKE ? COLLATE NOCASE)`);
    const pattern = `%${search}%`;
    bindings.push(pattern, pattern, pattern, pattern);
  }
  if (input.company) {
    where.push("person.company = ?");
    bindings.push(input.company);
  }
  if (input.title) {
    where.push("person.title = ?");
    bindings.push(input.title);
  }
  if (input.tag) {
    where.push(`${LATEST_TAG_OP} = 'add'`);
    bindings.push(input.tag);
  }
  if (input.stage) {
    where.push(`${CURRENT_STAGE} = ?`);
    bindings.push(input.stage);
  }
  if (input.listId) {
    // Joined to `person_lists` so the clause is empty for a list this org does
    // not own, rather than trusting every future writer of
    // `person_list_members` to have filtered by org first. The emptiness has to
    // be a property of the query, not of an invariant kept in another file.
    where.push(`person.id IN (
      SELECT member.person_id FROM person_list_members member
      JOIN person_lists saved ON saved.id = member.list_id
      WHERE member.list_id = ? AND saved.org_id = ?)`);
    bindings.push(input.listId, input.orgId ?? "");
  }
  if (input.personIdIn) {
    // A Live list, already compiled to an id projection by `resolveListScope`.
    // It cannot be merged in as filters: `buildPeopleQuery` holds one value per
    // key, so a caller's chip naming a field the saved filter also names would
    // REPLACE the list's predicate instead of intersecting with it — widening
    // the view to people outside the list, under a band still naming the list.
    where.push(`person.id IN (${input.personIdIn.sql})`);
    bindings.push(...input.personIdIn.bindings);
  }
  if (input.personId) {
    where.push("person.id = ?");
    bindings.push(input.personId);
  }
  return { where, bindings };
}

export interface BuiltQuery {
  countSql: string;
  countBindings: (string | number)[];
  dataSql: string;
  dataBindings: (string | number)[];
  /** The same population as an id-only subquery, for callers that intersect. */
  idsSql: string;
  idsBindings: (string | number)[];
}

/**
 * Build both halves of a people page. Exported (and unit-tested) as a pure
 * function so the shape of the query is checked without paying for a Worker.
 */
export function buildPeopleQuery(input: PeopleQueryInput): BuiltQuery {
  const { where, bindings } = filterClauses(input);
  const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  const sort = resolveSort(PEOPLE_SORTS, input.sort, DEFAULT_PEOPLE_SORT);
  // Same shape as `orderClause`, with the ULID tiebreaker qualified: this query
  // aliases `people` and a bare `id ASC` is ambiguous under the subqueries.
  // NULLs sort last in both directions — a person nobody has ever emailed
  // belongs at the bottom of "last contact", not at the top of it.
  const direction = sort.direction.toUpperCase();
  const primary = sort.nullsLast
    ? `${sort.column} IS NULL ASC, ${sort.column} ${direction}`
    : `${sort.column} ${direction}`;
  const order = `${primary}, person.id ASC`;
  const columns = `person.id, person.name, person.email, person.title, person.company, person.bio,
       person.headshot_attachment_id, person.created_at, person.updated_at,
       ${CONFERENCE_COUNT} AS conference_count,
       ${LAST_CONTACT} AS last_contact_at,
       ${CURRENT_TAGS} AS tags_json,
       ${CURRENT_STAGE} AS stage${input.columns ? `,\n       ${input.columns}` : ""}`;
  const joins = input.joins ? ` ${input.joins}` : "";
  const joinBindings = input.joinBindings ?? [];
  const limit = input.page ? " LIMIT ? OFFSET ?" : "";
  const pageBindings = input.page ? [input.page.limit, input.page.offset] : [];
  return {
    // The count never needs the projection's joins — it counts people, and a
    // LEFT JOIN that only widens columns cannot change how many there are.
    countSql: `SELECT COUNT(*) AS total FROM people person ${whereSql}`,
    countBindings: [...bindings],
    dataSql: `SELECT ${columns} FROM people person${joins} ${whereSql} ORDER BY ${order}${limit}`,
    dataBindings: [...joinBindings, ...bindings, ...pageBindings],
    // The same population as `countSql`, projected to ids so another query can
    // intersect with it. No joins, no order, no limit: it is only ever a
    // subquery, and it is the one shape that lets a saved filter compose with a
    // caller's filters instead of competing with them for a key.
    idsSql: `SELECT person.id FROM people person ${whereSql}`,
    idsBindings: [...bindings],
  };
}

export interface PeopleFacet {
  value: string;
  count: number;
}

export interface PeopleFacets {
  company: PeopleFacet[];
  title: PeopleFacet[];
  tag: PeopleFacet[];
}

/**
 * The filter panel's options and counts, resolved server-side against the same
 * org the list reads. A panel built from the current page would offer the
 * organizer filters that vanish as they page — which is not a filter panel.
 */
export async function listPeopleFacets(db: D1Database, orgId: string): Promise<PeopleFacets> {
  const [companies, titles, tags] = await Promise.all([
    db.prepare(
      `SELECT company AS value, COUNT(*) AS count FROM people
       WHERE org_id = ? AND company IS NOT NULL AND company <> ''
       GROUP BY company ORDER BY count DESC, company COLLATE NOCASE ASC LIMIT 8`,
    ).bind(orgId).all<PeopleFacet>(),
    db.prepare(
      `SELECT title AS value, COUNT(*) AS count FROM people
       WHERE org_id = ? AND title IS NOT NULL AND title <> ''
       GROUP BY title ORDER BY count DESC, title COLLATE NOCASE ASC LIMIT 8`,
    ).bind(orgId).all<PeopleFacet>(),
    db.prepare(
      `SELECT tag AS value, COUNT(*) AS count FROM (
         SELECT json_extract(tag_row.value_json, '$.tag') AS tag, tag_row.person_id AS person_id
         FROM person_events tag_row
         WHERE tag_row.org_id = ? AND tag_row.kind = 'tag'
           AND tag_row.id = (
             SELECT newest.id FROM person_events newest
             WHERE newest.person_id = tag_row.person_id AND newest.kind = 'tag'
               AND json_extract(newest.value_json, '$.tag') = json_extract(tag_row.value_json, '$.tag')
             ORDER BY newest.created_at DESC, newest.id DESC LIMIT 1
           )
           AND json_extract(tag_row.value_json, '$.op') = 'add'
       ) GROUP BY tag ORDER BY count DESC, tag COLLATE NOCASE ASC LIMIT 12`,
    ).bind(orgId).all<PeopleFacet>(),
  ]);
  return {
    company: companies.results,
    title: titles.results,
    tag: tags.results,
  };
}

export function parseTags(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((tag): tag is string => typeof tag === "string" && tag.length > 0) : [];
  } catch {
    return [];
  }
}
