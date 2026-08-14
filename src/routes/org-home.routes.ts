import { z } from "@hono/zod-openapi";

import { ApiError } from "../api/errors";
import { defineApiRoute, errorResponses, jsonResponse } from "../api/route";
import {
  ORG_HOME_ACTIVITY_HREF,
  ORG_HOME_ATTENTION_IDS,
  ORG_HOME_CREATE_HREF,
  ORG_HOME_ORGANIZERS_HREF,
  ORG_HOME_OUTREACH_HREF,
  ORG_HOME_PEOPLE_HREF,
  ORG_HOME_RETURNING_PEOPLE_HREF,
  ORG_HOME_SERVER_HREF,
} from "../api/org-home";
import { requireOrgAccess } from "../lib/auth/org-access";
import { CURRENT_STAGE } from "./people.queries";
import {
  readInstanceStatus,
  type InstanceStatusEnvironment,
  type InstanceStatusRow,
} from "../lib/instance-status";

const lifecycleValues = z.enum(["draft", "upcoming", "live", "ended"]);
const attentionState = z.enum(["ready", "empty", "unavailable"]);
const attentionStatus = z.enum(["ok", "attention", "unavailable"]);

const seasonSchema = z.object({
  id: z.string(),
  name: z.string(),
  starts_on: z.string(),
  ends_on: z.string(),
  status: z.string(),
  lifecycle: lifecycleValues,
  lifecycle_label: z.string(),
  submission_count: z.number().int().nonnegative(),
  speaker_count: z.number().int().nonnegative(),
  session_count: z.number().int().nonnegative(),
  links: z.object({ dashboard: z.string() }),
});

const relationshipMetricSchema = z.object({
  value: z.number().int().nonnegative().nullable(),
  state: z.enum(["ready", "unavailable"]),
  note: z.string(),
  href: z.string(),
});

const attentionItemSchema = z.object({
  id: z.string(),
  person_name: z.string().nullable(),
  event_name: z.string().nullable(),
  role: z.string().nullable(),
  due_at: z.string().nullable(),
  href: z.string(),
});

const serverStatusSchema = z.object({
  host: z.string(),
  configured: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  status: z.enum(["ok", "attention"]),
  rows: z.array(z.object({
    key: z.enum(["mail", "uploads", "spam", "domain"]),
    label: z.string(),
    configured: z.boolean(),
    note: z.string(),
  })),
});

const attentionSchema = z.object({
  id: z.enum(ORG_HOME_ATTENTION_IDS),
  label: z.string(),
  state: attentionState,
  status: attentionStatus,
  count: z.number().int().nonnegative().nullable(),
  title: z.string(),
  detail: z.string(),
  href: z.string().nullable(),
  item: attentionItemSchema.nullable(),
  server: serverStatusSchema.nullable(),
});

const activitySchema = z.object({
  id: z.string(),
  event_id: z.string(),
  event_name: z.string(),
  actor_name: z.string(),
  actor_kind: z.string(),
  action: z.string(),
  entity_type: z.string(),
  entity_id: z.string(),
  created_at: z.number(),
  href: z.string(),
});

const orgHomeResponse = z.object({
  data: z.object({
    organization: z.object({ id: z.string(), name: z.string() }),
    seasons: z.array(seasonSchema),
    next_season: seasonSchema.nullable(),
    create_conference_href: z.string(),
    relationships: z.object({
      people: relationshipMetricSchema,
      returning_speakers: relationshipMetricSchema,
      in_outreach: relationshipMetricSchema,
      organizers: relationshipMetricSchema,
    }),
    attention: z.tuple([attentionSchema, attentionSchema, attentionSchema]),
    recent_activity: z.array(activitySchema),
  }),
});

type EventSeasonRow = {
  id: string;
  name: string;
  slug: string;
  starts_on: string;
  ends_on: string;
  status: string;
  submission_count: number;
  speaker_count: number;
  session_count: number;
};

type RelationshipCounts = {
  people_count: number;
  returning_speaker_count: number;
  organizer_count: number;
};

type AttentionRead = {
  state: "ready" | "empty" | "unavailable";
  count: number | null;
  item: {
    id: string;
    person_name: string | null;
    event_name: string | null;
    role: string | null;
    due_at: string | null;
    href: string;
  } | null;
};

type OutreachRead = {
  state: "ready" | "empty" | "unavailable";
  active_count: number | null;
  overdue_count: number | null;
  overdue_item: AttentionRead["item"];
};

type StaleSeatRow = {
  id: string;
  person_name: string | null;
  event_name: string | null;
  role: string | null;
  total_count: number;
};

type ActivityRow = {
  id: string;
  event_id: string;
  event_name: string;
  actor_person_id: string | null;
  actor_name: string | null;
  actor_kind: string;
  action: string;
  entity_type: string;
  entity_id: string;
  created_at: number;
};

const STAFF_ROLES = ["owner", "program_lead", "ops"] as const;
const SPEAKER_ROLES = ["speaker", "co_speaker"] as const;
const ATTENTION_LIMIT = 25;
const SEASON_LIMIT = 100;
const ACTIVITY_LIMIT = 4;

function todayIso(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

function dashboardHref(eventId: string): string {
  return `/dashboard?event=${encodeURIComponent(eventId)}`;
}

function lifecycleFor(row: Pick<EventSeasonRow, "starts_on" | "ends_on" | "status">, today: string): {
  lifecycle: "draft" | "upcoming" | "live" | "ended";
  label: string;
} {
  if (row.ends_on < today) return { lifecycle: "ended", label: "Complete" };
  if (row.status === "live" && row.starts_on <= today) return { lifecycle: "live", label: "Live" };
  if (row.starts_on > today) return { lifecycle: "upcoming", label: "Upcoming" };
  return { lifecycle: "draft", label: "Draft" };
}

function asSeason(row: EventSeasonRow, today: string) {
  const lifecycle = lifecycleFor(row, today);
  return {
    id: row.id,
    name: row.name,
    starts_on: row.starts_on,
    ends_on: row.ends_on,
    status: row.status,
    lifecycle: lifecycle.lifecycle,
    lifecycle_label: lifecycle.label,
    submission_count: Number(row.submission_count),
    speaker_count: Number(row.speaker_count),
    session_count: Number(row.session_count),
    links: { dashboard: dashboardHref(row.id) },
  } as const;
}

function missingTable(error: unknown, table: string): boolean {
  if (!(error instanceof Error)) return false;
  return new RegExp(`no such table:\\s*(?:main\\.)?${table}\\b`, "i").test(error.message);
}

function missingColumn(error: unknown, column: string): boolean {
  if (!(error instanceof Error)) return false;
  return new RegExp(`no such column:\\s*(?:[A-Za-z0-9_]+\\.)?${column}\\b`, "i").test(error.message);
}

function missingOutreachSource(error: unknown): boolean {
  return missingTable(error, "person_events")
    || missingColumn(error, "target_event_id")
    || missingColumn(error, "next_touch_on");
}

function unavailableSource(): AttentionRead {
  return { state: "unavailable", count: null, item: null };
}

function emptySource(): AttentionRead {
  return { state: "empty", count: 0, item: null };
}

function unavailableOutreach(): OutreachRead {
  return { state: "unavailable", active_count: null, overdue_count: null, overdue_item: null };
}

function emptyOutreach(): OutreachRead {
  return { state: "empty", active_count: 0, overdue_count: 0, overdue_item: null };
}

async function readOrganization(db: D1Database, orgId: string): Promise<{ id: string; name: string }> {
  const row = await db.prepare("SELECT id, name FROM organizations WHERE id = ? LIMIT 1").bind(orgId).first<{ id: string; name: string }>();
  if (!row) throw ApiError.notFound("organization not found");
  return row;
}

async function readSeasons(db: D1Database, orgId: string, today: string): Promise<ReturnType<typeof asSeason>[]> {
  const rows = await db.prepare(
    `SELECT e.id, e.name, e.slug, e.starts_on, e.ends_on, e.status,
       (SELECT COUNT(*) FROM submissions s WHERE s.event_id = e.id) AS submission_count,
       (SELECT COUNT(DISTINCT p.person_id)
          FROM participations p
          JOIN submissions speaker_submission ON speaker_submission.id = p.submission_id
         WHERE speaker_submission.event_id = e.id AND p.role IN ('speaker', 'co_speaker')) AS speaker_count,
       (SELECT COUNT(*) FROM agenda_items ai WHERE ai.event_id = e.id AND ai.kind = 'session') AS session_count
       FROM events e
      WHERE e.org_id = ?
      ORDER BY e.starts_on DESC, e.id DESC
      LIMIT ${SEASON_LIMIT}`,
  ).bind(orgId).all<EventSeasonRow>();

  return rows.results
    .map((row) => asSeason(row, today))
    .sort((left, right) => {
      const leftEnded = left.lifecycle === "ended";
      const rightEnded = right.lifecycle === "ended";
      if (leftEnded !== rightEnded) return leftEnded ? 1 : -1;
      if (leftEnded) return right.starts_on.localeCompare(left.starts_on) || right.id.localeCompare(left.id);
      return left.starts_on.localeCompare(right.starts_on) || left.id.localeCompare(right.id);
    });
}

async function readRelationshipCounts(db: D1Database, orgId: string): Promise<RelationshipCounts> {
  const row = await db.prepare(
    `SELECT
       (SELECT COUNT(*) FROM people WHERE org_id = ?) AS people_count,
       (SELECT COUNT(DISTINCT m.person_id)
          FROM memberships m
         WHERE m.org_id = ? AND m.role IN ('owner', 'program_lead', 'ops')) AS organizer_count,
       (SELECT COUNT(*) FROM (
          SELECT p.person_id
            FROM participations p
            JOIN submissions s ON s.id = p.submission_id
            JOIN people speaker ON speaker.id = p.person_id
           WHERE speaker.org_id = ? AND p.role IN ('speaker', 'co_speaker')
           GROUP BY p.person_id
          HAVING COUNT(DISTINCT s.event_id) >= 2
       )) AS returning_speaker_count`,
  ).bind(orgId, orgId, orgId).first<RelationshipCounts>();
  if (!row) return { people_count: 0, returning_speaker_count: 0, organizer_count: 0 };
  return {
    people_count: Number(row.people_count),
    returning_speaker_count: Number(row.returning_speaker_count),
    organizer_count: Number(row.organizer_count),
  };
}

/**
 * MRQ-205 integration seam. A person's current stage is the newest stage row
 * in the append-only person_events log. The branch adds target_event_id and
 * next_touch_on to that row; until those columns exist, the result is honest
 * unavailable rather than a fabricated zero.
 */
export async function readOutreachAttention(db: D1Database, orgId: string, today: string): Promise<OutreachRead> {
  try {
    const [summary, oldestOverdue] = await Promise.all([
      db.prepare(
        `SELECT COUNT(*) AS active_count,
                COALESCE(SUM(CASE WHEN latest.next_touch_on IS NOT NULL AND latest.next_touch_on < ? THEN 1 ELSE 0 END), 0) AS overdue_count
           FROM people person
           JOIN person_events latest
             ON latest.org_id = person.org_id
            AND latest.person_id = person.id
            AND latest.kind = 'stage'
            AND latest.id = (
              SELECT newest.id
                FROM person_events newest
               WHERE newest.org_id = person.org_id
                 AND newest.person_id = person.id
                 AND newest.kind = 'stage'
               ORDER BY newest.created_at DESC, newest.id DESC
               LIMIT 1
            )
          WHERE person.org_id = ?
            AND ${CURRENT_STAGE} NOT IN ('confirmed', 'declined')`,
      ).bind(today, orgId).first<{ active_count: number; overdue_count: number }>(),
      db.prepare(
        `SELECT latest.id, person.name AS person_name, event.name AS event_name, latest.next_touch_on
           FROM people person
           JOIN person_events latest
             ON latest.org_id = person.org_id
            AND latest.person_id = person.id
            AND latest.kind = 'stage'
            AND latest.id = (
              SELECT newest.id
                FROM person_events newest
               WHERE newest.org_id = person.org_id
                 AND newest.person_id = person.id
                 AND newest.kind = 'stage'
               ORDER BY newest.created_at DESC, newest.id DESC
               LIMIT 1
            )
           LEFT JOIN events event
             ON event.id = latest.target_event_id AND event.org_id = person.org_id
          WHERE person.org_id = ?
            AND ${CURRENT_STAGE} NOT IN ('confirmed', 'declined')
            AND latest.next_touch_on IS NOT NULL
            AND latest.next_touch_on < ?
          ORDER BY latest.next_touch_on ASC, latest.id ASC
          LIMIT 1`,
      ).bind(orgId, today).first<{ id: string; person_name: string | null; event_name: string | null; next_touch_on: string | null }>(),
    ]);
    const activeCount = Number(summary?.active_count ?? 0);
    const overdueCount = Number(summary?.overdue_count ?? 0);
    if (activeCount === 0) return emptyOutreach();
    return {
      state: "ready",
      active_count: activeCount,
      overdue_count: overdueCount,
      overdue_item: oldestOverdue ? {
        id: oldestOverdue.id,
        person_name: oldestOverdue.person_name,
        event_name: oldestOverdue.event_name,
        role: null,
        due_at: oldestOverdue.next_touch_on,
        href: ORG_HOME_OUTREACH_HREF,
      } : null,
    };
  } catch (error) {
    if (missingOutreachSource(error)) return unavailableOutreach();
    throw error;
  }
}

/**
 * MRQ-212 integration seam. Memberships are the canonical source for
 * event-scoped organizer seats; ended conferences are derived at read time.
 */
export async function readStaleSeatAttention(db: D1Database, orgId: string, today: string): Promise<AttentionRead> {
  const rows = await db.prepare(
    `SELECT seat.id, person.name AS person_name, event.name AS event_name, seat.role,
            COUNT(*) OVER () AS total_count
       FROM memberships seat
       JOIN people person ON person.id = seat.person_id AND person.org_id = seat.org_id
       JOIN events event ON event.id = seat.event_id AND event.org_id = seat.org_id
      WHERE seat.org_id = ?
        AND seat.event_id IS NOT NULL
        AND seat.role != 'speaker'
        AND event.ends_on < ?
      ORDER BY event.ends_on ASC, seat.id ASC
      LIMIT ${ATTENTION_LIMIT}`,
  ).bind(orgId, today).all<StaleSeatRow>();
  if (rows.results.length === 0) return emptySource();
  const first = rows.results[0];
  return {
    state: "ready",
    count: Number(first.total_count),
    item: {
      id: first.id,
      person_name: first.person_name,
      event_name: first.event_name,
      role: first.role,
      due_at: null,
      href: ORG_HOME_ORGANIZERS_HREF,
    },
  };
}

async function readActivity(db: D1Database, orgId: string): Promise<ActivityRow[]> {
  const rows = await db.prepare(
    `SELECT a.id, a.event_id, e.name AS event_name, a.actor_person_id,
            actor.name AS actor_name, a.actor_kind, a.action, a.entity_type,
            a.entity_id, a.created_at
       FROM audit_log a
       JOIN events e ON e.id = a.event_id AND e.org_id = ?
       LEFT JOIN people actor ON actor.id = a.actor_person_id AND actor.org_id = e.org_id
      WHERE e.org_id = ?
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT ${ACTIVITY_LIMIT}`,
  ).bind(orgId, orgId).all<ActivityRow>();
  return rows.results;
}

function actorName(row: ActivityRow): string {
  if (row.actor_name) return row.actor_name;
  if (row.actor_kind === "system") return "System";
  if (row.actor_kind === "airtable") return "Airtable";
  if (row.actor_kind === "api_token") return "API token";
  return "Unknown actor";
}

function attentionCopy(
  label: string,
  source: AttentionRead,
  emptyTitle: string,
  unavailableTitle: string,
  href: string,
  detail: string,
): { state: AttentionRead["state"]; status: "ok" | "attention" | "unavailable"; count: number | null; title: string; detail: string; href: string; item: AttentionRead["item"] } {
  if (source.state === "unavailable") {
    return { state: source.state, status: "unavailable", count: null, title: unavailableTitle, detail: "This source has not been connected yet.", href, item: null };
  }
  if (source.state === "empty") {
    return { state: source.state, status: "ok", count: 0, title: emptyTitle, detail, href, item: null };
  }
  return {
    state: source.state,
    status: "attention",
    count: source.count,
    title: `${source.count} ${label}`,
    detail: source.item?.person_name
      ? `${source.item.person_name}${source.item.event_name ? ` · ${source.item.event_name}` : ""}`
      : detail,
    href,
    item: source.item,
  };
}

function overdueOutreach(source: OutreachRead): AttentionRead {
  if (source.state === "unavailable") return unavailableSource();
  if (source.overdue_count === 0) return emptySource();
  return {
    state: "ready",
    count: source.overdue_count,
    item: source.overdue_item,
  };
}

function serverAttention(rows: InstanceStatusRow[], requestUrl: string) {
  const configured = rows.filter((row) => row.configured).length;
  const allConfigured = configured === rows.length;
  return {
    id: "server_status" as const,
    label: "Server status",
    state: "ready" as const,
    status: allConfigured ? "ok" as const : "attention" as const,
    count: null,
    title: allConfigured ? "Server: all connections working" : "Server: some connections need attention",
    detail: allConfigured
      ? "Email, uploads, spam protection, web address"
      : rows.filter((row) => !row.configured).map((row) => row.label).join(" · "),
    href: ORG_HOME_SERVER_HREF,
    item: null,
    server: {
      host: new URL(requestUrl).host,
      configured,
      total: rows.length,
      status: allConfigured ? "ok" as const : "attention" as const,
      rows: rows.map((row) => ({ key: row.key, label: row.label, configured: row.configured, note: row.note })),
    },
  };
}

function metric(value: number | null, state: "ready" | "unavailable", note: string, href: string) {
  return { value, state, note, href };
}

const getOrganizationHome = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/org/home",
    operationId: "getOrganizationHome",
    summary: "Read the organization home snapshot",
    description: "One bounded organization-scoped composition for conferences, relationships, attention, and recent activity.",
    tags: ["Organization"],
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "read" }, concurrency: "none" },
    responses: { 200: jsonResponse(orgHomeResponse, "Organization Home snapshot"), ...errorResponses([401, 403, 404, 429, 500]) },
  },
  async (context) => {
    const access = requireOrgAccess(context);
    const now = Date.now();
    const today = todayIso(now);
    const instanceRows = readInstanceStatus(context.env as unknown as InstanceStatusEnvironment, context.req.url);
    const [organization, seasons, counts, outreach, staleSeats, activity] = await Promise.all([
      readOrganization(context.env.DB, access.orgId),
      readSeasons(context.env.DB, access.orgId, today),
      readRelationshipCounts(context.env.DB, access.orgId),
      readOutreachAttention(context.env.DB, access.orgId, today),
      readStaleSeatAttention(context.env.DB, access.orgId, today),
      readActivity(context.env.DB, access.orgId),
    ]);

    const nextSeason = seasons.find((season) => season.lifecycle === "upcoming" || season.lifecycle === "live") ?? null;
    const outreachAttention = overdueOutreach(outreach);
    const outreachMetric = outreach.state === "unavailable"
      ? metric(null, "unavailable", "Outreach data is not connected yet.", ORG_HOME_OUTREACH_HREF)
      : metric(outreach.active_count ?? 0, "ready", "People being courted toward a slot.", ORG_HOME_OUTREACH_HREF);
    const attention = [
      {
        id: "overdue_outreach" as const,
        label: "Overdue outreach",
        ...attentionCopy("outreach follow-ups overdue", outreachAttention, "No outreach follow-ups overdue", "Outreach follow-ups unavailable", ORG_HOME_OUTREACH_HREF, "The chase is clear."),
        server: null,
      },
      {
        id: "stale_seats" as const,
        label: "Past-conference seats",
        ...attentionCopy("seat from a past conference", staleSeats, "No past-conference seats need review", "Past-conference seats unavailable", ORG_HOME_ORGANIZERS_HREF, "No ended-conference seats are waiting for review."),
        server: null,
      },
      serverAttention(instanceRows, context.req.url),
    ] as const;

    context.header("Cache-Control", "no-store");
    return context.json({
      data: {
        organization,
        seasons,
        next_season: nextSeason,
        create_conference_href: ORG_HOME_CREATE_HREF,
        relationships: {
          people: metric(counts.people_count, "ready", "across all conferences.", ORG_HOME_PEOPLE_HREF),
          returning_speakers: metric(counts.returning_speaker_count, "ready", "spoke at 2+ conferences.", ORG_HOME_RETURNING_PEOPLE_HREF),
          in_outreach: outreachMetric,
          organizers: metric(counts.organizer_count, "ready", "organization staff seats.", ORG_HOME_ORGANIZERS_HREF),
        },
        attention,
        recent_activity: activity.map((row) => ({
          id: row.id,
          event_id: row.event_id,
          event_name: row.event_name,
          actor_name: actorName(row),
          actor_kind: row.actor_kind,
          action: row.action,
          entity_type: row.entity_type,
          entity_id: row.entity_id,
          created_at: row.created_at,
          href: ORG_HOME_ACTIVITY_HREF,
        })),
      },
    }, 200);
  },
);

export const apiRoutes = [getOrganizationHome];
