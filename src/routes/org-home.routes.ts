import { z } from "@hono/zod-openapi";

import { ApiError } from "../api/errors";
import { defineApiRoute, errorResponses, jsonResponse } from "../api/route";
import { ORG_ACTIVITY_HREF, ORG_HOME_CREATE_HREF, ORG_HOME_ATTENTION_IDS } from "../api/org-home";
import { requireOrgAccess } from "../lib/auth/org-access";
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
  due_at: z.number().nullable(),
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
    due_at: number | null;
    href: string;
  } | null;
};

type OutreachRow = {
  id: string;
  person_name: string | null;
  event_name: string | null;
  next_touch_at: number | null;
  total_count: number;
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

export const ORG_HOME_ACTIVITY_HREF = ORG_ACTIVITY_HREF;

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

function unavailableSource(): AttentionRead {
  return { state: "unavailable", count: null, item: null };
}

function emptySource(): AttentionRead {
  return { state: "empty", count: 0, item: null };
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
 * MRQ-205 integration seam. The Outreach branch owns this projection and its
 * next-touch semantics. Until that source exists, a missing table is an honest
 * unavailable state; it is never converted into a fabricated zero.
 */
export async function readOutreachAttention(db: D1Database, orgId: string, now: number): Promise<AttentionRead> {
  try {
    const rows = await db.prepare(
      `SELECT o.id, p.name AS person_name, e.name AS event_name, o.next_touch_at,
              COUNT(*) OVER () AS total_count
         FROM outreach o
         JOIN people p ON p.id = o.person_id AND p.org_id = o.org_id
         LEFT JOIN events e ON e.id = o.event_id AND e.org_id = o.org_id
        WHERE o.org_id = ?
          AND o.next_touch_at IS NOT NULL
          AND o.next_touch_at < ?
          AND (o.completed_at IS NULL OR o.completed_at = 0)
        ORDER BY o.next_touch_at ASC, o.id ASC
        LIMIT ${ATTENTION_LIMIT}`,
    ).bind(orgId, now).all<OutreachRow>();
    if (rows.results.length === 0) return emptySource();
    const first = rows.results[0];
    return {
      state: "ready",
      count: Number(first.total_count),
      item: {
        id: first.id,
        person_name: first.person_name,
        event_name: first.event_name,
        role: null,
        due_at: first.next_touch_at,
        href: "/outreach",
      },
    };
  } catch (error) {
    if (missingTable(error, "outreach")) return unavailableSource();
    throw error;
  }
}

/**
 * MRQ-212 integration seam. The stale-seat branch owns the projection of
 * ended-conference seats that need review. Its absence is distinct from an
 * empty result, so organizers never see a false all-clear while that branch is
 * still being integrated.
 */
export async function readStaleSeatAttention(db: D1Database, orgId: string, today: string): Promise<AttentionRead> {
  try {
    const rows = await db.prepare(
      `SELECT seat.id, p.name AS person_name, e.name AS event_name, seat.role,
              COUNT(*) OVER () AS total_count
         FROM stale_conference_seats seat
         JOIN people p ON p.id = seat.person_id AND p.org_id = seat.org_id
         JOIN events e ON e.id = seat.event_id AND e.org_id = seat.org_id
        WHERE seat.org_id = ? AND e.ends_on < ?
        ORDER BY e.ends_on ASC, seat.id ASC
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
        href: "/org/settings?tab=organizers",
      },
    };
  } catch (error) {
    if (missingTable(error, "stale_conference_seats")) return unavailableSource();
    throw error;
  }
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
    href: "/org/settings?tab=instance",
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
      readOutreachAttention(context.env.DB, access.orgId, now),
      readStaleSeatAttention(context.env.DB, access.orgId, today),
      readActivity(context.env.DB, access.orgId),
    ]);

    const nextSeason = seasons.find((season) => season.lifecycle === "upcoming" || season.lifecycle === "live") ?? null;
    const outreachMetric = outreach.state === "unavailable"
      ? metric(null, "unavailable", "Outreach data is not connected yet.", "/outreach")
      : metric(outreach.count ?? 0, "ready", "People being courted toward a slot.", "/outreach");
    const attention = [
      {
        id: "overdue_outreach" as const,
        label: "Overdue outreach",
        ...attentionCopy("outreach follow-ups overdue", outreach, "No outreach follow-ups overdue", "Outreach follow-ups unavailable", "/outreach", "The chase is clear."),
        server: null,
      },
      {
        id: "stale_seats" as const,
        label: "Past-conference seats",
        ...attentionCopy("seat from a past conference", staleSeats, "No past-conference seats need review", "Past-conference seats unavailable", "/org/settings?tab=organizers", "No ended-conference seats are waiting for review."),
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
          people: metric(counts.people_count, "ready", "across all conferences.", "/people"),
          returning_speakers: metric(counts.returning_speaker_count, "ready", "spoke at 2+ conferences.", "/people?filter=returning"),
          in_outreach: outreachMetric,
          organizers: metric(counts.organizer_count, "ready", "organization staff seats.", "/org/settings?tab=organizers"),
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
          href: ORG_ACTIVITY_HREF,
        })),
      },
    }, 200);
  },
);

export const apiRoutes = [getOrganizationHome];
