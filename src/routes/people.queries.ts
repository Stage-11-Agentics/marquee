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
import { ATTENDEE_PERSON_SOURCE, SPEAKER_ROSTER_PERSON_SOURCE, type EventPopulation } from "../lib/roster-source";

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
 * An unknown or borrowed id is reported to the route so the API can distinguish
 * a missing List from an existing List with zero members. The membership query
 * still defends its own org boundary for every known Fixed list.
 */
export interface ResolvedListScope {
  found: boolean;
  filters: Partial<PeopleQueryInput>;
}

export async function resolveListScope(
  db: D1Database,
  orgId: string,
  listId: string,
): Promise<ResolvedListScope> {
  const row = await db
    .prepare("SELECT kind, config_json FROM person_lists WHERE id = ? AND org_id = ?")
    .bind(listId, orgId)
    .first<{ kind: string; config_json: string }>();
  if (!row) return { found: false, filters: {} };
  if (row.kind !== "live") return { found: true, filters: { listId } };
  const saved = buildPeopleQuery({ orgId, ...configFilters(parseListConfig(row.config_json)) });
  return { found: true, filters: { personIdIn: { sql: saved.idsSql, bindings: saved.idsBindings } } };
}

export const PEOPLE_SORTS: SortRegistry = {
  name: { column: "person.name COLLATE NOCASE", direction: "asc" },
  name_desc: { column: "person.name COLLATE NOCASE", direction: "desc" },
  company: { column: "person.company COLLATE NOCASE", direction: "asc", nullsLast: true },
  newest: { column: "person.created_at", direction: "desc" },
  updated: { column: "person.updated_at", direction: "desc" },
  last_contact: { column: "last_contact_at", direction: "desc", nullsLast: true },
  next_touch: { column: "outreach_next_touch_on", direction: "asc", nullsLast: true },
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
  /** Restrict to one conference's population — see `eventPopulation`. */
  eventId?: string;
  /**
   * Which population `eventId` means. `roster` is who speaks at the conference
   * (the entrance the roster screen uses); `attendee` is who is coming to it;
   * `any` is either. One builder, three entrances — two implementations of
   * "who belongs to this conference" would be two bugs.
   */
  eventPopulation?: EventPopulation;
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
  /** Internal CTE prefix shared by the count, data, and id projections. */
  withSql?: string;
  withBindings?: (string | number)[];
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
  /** Internal predicate appended to both the count and data halves. */
  extraWhere?: { sql: string; bindings: (string | number)[] };
  /** Joins required by `extraWhere` in count and id projections. */
  countJoins?: string;
  countJoinBindings?: (string | number)[];
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
  do_not_contact: number;
  outreach_target_event_id: string | null;
  outreach_target_event_name: string | null;
  outreach_next_touch_on: string | null;
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

/** The current card's conference target and next touch, folded from the latest stage row. */
export const CURRENT_TARGET_EVENT = `(
  SELECT latest_stage.target_event_id
  FROM person_events latest_stage
  WHERE latest_stage.person_id = person.id AND latest_stage.kind = 'stage'
  ORDER BY latest_stage.created_at DESC, latest_stage.id DESC
  LIMIT 1
)`;

export const CURRENT_NEXT_TOUCH = `(
  SELECT latest_stage.next_touch_on
  FROM person_events latest_stage
  WHERE latest_stage.person_id = person.id AND latest_stage.kind = 'stage'
  ORDER BY latest_stage.created_at DESC, latest_stage.id DESC
  LIMIT 1
)`;

const CURRENT_TARGET_EVENT_NAME = `(
  SELECT target.name
  FROM events target
  WHERE target.id = ${CURRENT_TARGET_EVENT} AND target.org_id = person.org_id
  LIMIT 1
)`;

/**
 * The detail projection for a Live List cannot bind its saved filter as
 * request input: the row being selected is the source of that filter. Keep
 * the count in the same SQL statement as the List metadata so opening one
 * never becomes metadata-plus-roster work. The predicates mirror
 * `filterClauses`, with the saved config read through the selected row.
 */
export const LIVE_LIST_COUNT_SQL = `(
  SELECT COUNT(*) FROM people live_person
  WHERE live_person.org_id = saved.org_id
    AND (
      NULLIF(json_extract(saved.config_json, '$.q'), '') IS NULL
      OR live_person.name LIKE ('%' || json_extract(saved.config_json, '$.q') || '%') COLLATE NOCASE
      OR live_person.email LIKE ('%' || json_extract(saved.config_json, '$.q') || '%') COLLATE NOCASE
      OR IFNULL(live_person.company, '') LIKE ('%' || json_extract(saved.config_json, '$.q') || '%') COLLATE NOCASE
      OR IFNULL(live_person.title, '') LIKE ('%' || json_extract(saved.config_json, '$.q') || '%') COLLATE NOCASE
    )
    AND (
      NULLIF(json_extract(saved.config_json, '$.company'), '') IS NULL
      OR live_person.company = json_extract(saved.config_json, '$.company')
    )
    AND (
      NULLIF(json_extract(saved.config_json, '$.title'), '') IS NULL
      OR live_person.title = json_extract(saved.config_json, '$.title')
    )
    AND (
      NULLIF(json_extract(saved.config_json, '$.tag'), '') IS NULL
      OR (
        SELECT json_extract(latest_tag.value_json, '$.op')
        FROM person_events latest_tag
        WHERE latest_tag.person_id = live_person.id AND latest_tag.kind = 'tag'
          AND json_extract(latest_tag.value_json, '$.tag') = json_extract(saved.config_json, '$.tag')
        ORDER BY latest_tag.created_at DESC, latest_tag.id DESC
        LIMIT 1
      ) = 'add'
    )
    AND (
      NULLIF(json_extract(saved.config_json, '$.stage'), '') IS NULL
      OR (
        SELECT json_extract(latest_stage.value_json, '$.stage')
        FROM person_events latest_stage
        WHERE latest_stage.person_id = live_person.id AND latest_stage.kind = 'stage'
        ORDER BY latest_stage.created_at DESC, latest_stage.id DESC
        LIMIT 1
      ) = json_extract(saved.config_json, '$.stage')
    )
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
    const population = input.eventPopulation ?? "roster";
    if (population === "attendee") {
      where.push(`person.id IN (${ATTENDEE_PERSON_SOURCE})`);
      bindings.push(input.eventId);
    } else if (population === "any") {
      where.push(`(person.id IN (${SPEAKER_ROSTER_PERSON_SOURCE}) OR person.id IN (${ATTENDEE_PERSON_SOURCE}))`);
      bindings.push(input.eventId, input.eventId, input.eventId);
    } else {
      where.push(`person.id IN (${SPEAKER_ROSTER_PERSON_SOURCE})`);
      bindings.push(input.eventId, input.eventId);
    }
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
  if (input.extraWhere?.sql) {
    where.push(`(${input.extraWhere.sql})`);
    bindings.push(...input.extraWhere.bindings);
  }
  return { where, bindings };
}

function whereClause(input: PeopleQueryInput): { sql: string; bindings: (string | number)[] } {
  const clauses = filterClauses(input);
  return {
    sql: clauses.where.length > 0 ? `WHERE ${clauses.where.join(" AND ")}` : "",
    bindings: clauses.bindings,
  };
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
  const { sql: whereSql, bindings } = whereClause(input);
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
       person.do_not_contact,
       ${CONFERENCE_COUNT} AS conference_count,
       ${LAST_CONTACT} AS last_contact_at,
       ${CURRENT_TAGS} AS tags_json,
       ${CURRENT_STAGE} AS stage,
       ${CURRENT_TARGET_EVENT} AS outreach_target_event_id,
       ${CURRENT_TARGET_EVENT_NAME} AS outreach_target_event_name,
       ${CURRENT_NEXT_TOUCH} AS outreach_next_touch_on${input.columns ? `,\n       ${input.columns}` : ""}`;
  const joins = input.joins ? ` ${input.joins}` : "";
  const joinBindings = input.joinBindings ?? [];
  const withSql = input.withSql ? `${input.withSql.trimEnd()}\n` : "";
  const withBindings = input.withBindings ?? [];
  const countJoins = input.countJoins ? ` ${input.countJoins}` : "";
  const countJoinBindings = input.countJoinBindings ?? [];
  const limit = input.page ? " LIMIT ? OFFSET ?" : "";
  const pageBindings = input.page ? [input.page.limit, input.page.offset] : [];
  return {
    // A projection-only join is data-only. A caller-specific predicate can
    // opt into a one-row-per-person count join when its SQL references that
    // projection; the caller owns that cardinality contract.
    countSql: `${withSql}SELECT COUNT(*) AS total FROM people person${countJoins} ${whereSql}`,
    countBindings: [...withBindings, ...countJoinBindings, ...bindings],
    dataSql: `${withSql}SELECT ${columns} FROM people person${joins} ${whereSql} ORDER BY ${order}${limit}`,
    dataBindings: [...withBindings, ...joinBindings, ...bindings, ...pageBindings],
    // The same population as `countSql`, projected to ids so another query can
    // intersect with it. No data-only joins, no order, no limit: it is only ever a
    // subquery, and it is the one shape that lets a saved filter compose with a
    // caller's filters instead of competing with them for a key.
    //
    // It carries the count join rather than the data-only projection join, so
    // a caller-specific predicate that references its aliases stays valid.
    idsSql: `${withSql}SELECT person.id FROM people person${countJoins} ${whereSql}`,
    idsBindings: [...withBindings, ...countJoinBindings, ...bindings],
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
 * population the table reads. Each facet leaves its own field open so the
 * organizer can switch to another value without first clearing the active
 * chip; list/search/other chips stay in the scope. The filter panel says plainly
 * that these are available-value counts, not counts for the selected facet.
 */
export async function listPeopleFacets(db: D1Database, input: PeopleQueryInput): Promise<PeopleFacets> {
  const countFacet = (column: "company" | "title", limit: number) => {
    const { sql, bindings } = whereClause({ ...input, [column]: undefined });
    const extra = `${sql ? "AND" : "WHERE"} person.${column} IS NOT NULL AND person.${column} <> ''`;
    return db.prepare(
      `SELECT person.${column} AS value, COUNT(*) AS count FROM people person
       ${sql} ${extra}
       GROUP BY person.${column} ORDER BY count DESC, person.${column} COLLATE NOCASE ASC LIMIT ${limit}`,
    ).bind(...bindings).all<PeopleFacet>();
  };

  const tagScope = whereClause({ ...input, tag: undefined });
  const tagPersonScope = `SELECT person.id FROM people person ${tagScope.sql}`;
  const [companies, titles, tags] = await Promise.all([
    countFacet("company", 8),
    countFacet("title", 8),
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
       ) current_tags
       WHERE current_tags.person_id IN (${tagPersonScope})
       GROUP BY tag ORDER BY count DESC, tag COLLATE NOCASE ASC LIMIT 12`,
    ).bind(input.orgId ?? "", ...tagScope.bindings).all<PeopleFacet>(),
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
