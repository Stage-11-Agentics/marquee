/**
 * Sponsor portal API.
 *
 * The speaker portal's sibling, not a new species: the same magic-link door, the
 * same session surface, the same task machinery. What moves is the centre of
 * gravity — a speaker's portal orbits their session, a sponsor contact's orbits
 * the SPONSORSHIP, which is the company's deal with this conference.
 *
 * One read and one narrow write live here. Completing a deliverable does NOT:
 * it goes through `POST /api/v1/me/tasks/{taskId}/complete` like everything else,
 * because the task machinery is the single write path (sponsors-design §5.2
 * ruling 3) and a second completion endpoint is how the chase board starts
 * missing half of what happened.
 */

import { z } from "@hono/zod-openapi";

import { ApiError } from "../api/errors";
import { defineApiRoute, errorResponses, jsonResponse } from "../api/route";
import type { ApiEnv } from "../api/runtime";
import type { AuthContext, SessionAuth } from "../lib/auth/scope-resolution";
import { getAuth } from "../lib/auth/auth-middleware";
import { auditStatement } from "../lib/audit";
import { dealLineChips } from "../lib/sponsors/deal-line";
import { sponsorHandbookChapters } from "../lib/sponsors/handbook";
import { roomDisplayLabel } from "../lib/venues";
import { showsBuildingComparisonCount } from "../lib/venue-disclosure";
import { listPortalTasks } from "./portal-tasks.queries";

const sponsorshipQuery = z.object({ sponsorshipId: z.string().min(1).optional() });
const sponsorshipParams = z.object({ sponsorshipId: z.string().min(1) });

const companyPatchBody = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  website: z.string().trim().max(400).nullable().optional(),
  blurb: z.string().trim().max(2_000).nullable().optional(),
}).strict();

const sponsorPortalResponseSchema = z.object({
  seat: z.literal("sponsor_contact"),
  event: z.any(),
  viewer: z.any(),
  sponsorship: z.any(),
  contacts: z.array(z.any()),
  tasks: z.array(z.any()),
  sessions: z.array(z.any()),
  handbook: z.array(z.any()),
  available_sponsorships: z.array(z.any()),
}).openapi("SponsorPortal");

const sponsorCompanyResponseSchema = z.object({ company: z.any() }).openapi("SponsorCompany");

interface SponsorshipRow {
  sponsorship_id: string;
  status: string;
  passes: number;
  tier_name: string | null;
  company_id: string;
  company_name: string;
  company_website: string | null;
  company_blurb: string | null;
  booth_number: string | null;
  booth_size: string | null;
  booth_hall: string | null;
  booth_load_in: string | null;
  booth_access_note: string | null;
  booth_leave_note: string | null;
  building_id: string | null;
  building_name: string | null;
  building_address: string | null;
  building_lat: number | null;
  building_lng: number | null;
  building_access_note: string | null;
  event_id: string;
  event_name: string;
  event_slug: string;
  event_starts_on: string;
  event_ends_on: string;
  event_timezone: string;
  event_venue: string | null;
}

interface SponsorSessionRow {
  id: string;
  title: string;
  abstract: string | null;
  format_name: string | null;
  starts_at: number | null;
  duration_min: number | null;
  is_published: number | null;
  room_name: string | null;
  building_name: string | null;
  speakers_json: string;
}

function isSessionAuth(auth: AuthContext | null): auth is SessionAuth {
  return auth?.kind === "session";
}

function requireSponsorSession(context: import("hono").Context<ApiEnv>): SessionAuth {
  const auth = getAuth(context);
  if (!isSessionAuth(auth)) throw ApiError.forbidden("the sponsor portal requires a browser session");
  // A co-speaker link is scoped to one abstract and nothing else. It must not
  // widen into a sponsorship just because the same person holds one.
  if (auth.roleHint?.startsWith("cospeaker_profile:")) {
    throw ApiError.forbidden("this co-speaker link is limited to its invited abstract");
  }
  return auth;
}

const SPONSORSHIP_COLUMNS = `sponsorship.id AS sponsorship_id, sponsorship.status, sponsorship.passes,
    tier.name AS tier_name,
    company.id AS company_id, company.name AS company_name,
    company.website AS company_website, company.blurb AS company_blurb,
    sponsorship.booth_number, sponsorship.booth_size, sponsorship.booth_hall,
    sponsorship.booth_load_in, sponsorship.booth_access_note, sponsorship.booth_leave_note,
    building.id AS building_id, building.name AS building_name, building.address AS building_address,
    building.lat AS building_lat, building.lng AS building_lng, building.access_note AS building_access_note,
    conference.id AS event_id, conference.name AS event_name, conference.slug AS event_slug,
    conference.starts_on AS event_starts_on, conference.ends_on AS event_ends_on,
    conference.timezone AS event_timezone, conference.venue AS event_venue`;

/**
 * The sponsorship this session may read.
 *
 * Every access decision is in this one join: the caller must hold a contact row
 * on the sponsorship, and the sponsorship's conference must be in the caller's
 * organization. An explicit `sponsorshipId` is checked by the same predicate as
 * the default one, so naming somebody else's deal in the query string answers
 * 404 rather than reading it.
 */
async function sponsorshipFor(
  db: D1Database,
  auth: SessionAuth,
  requestedSponsorshipId?: string,
): Promise<SponsorshipRow | null> {
  const predicate = requestedSponsorshipId ? "AND sponsorship.id = ?" : "";
  const bindings = requestedSponsorshipId
    ? [auth.orgId, auth.personId, requestedSponsorshipId]
    : [auth.orgId, auth.personId];
  return db
    .prepare(
      `SELECT ${SPONSORSHIP_COLUMNS}
       FROM sponsorship_contacts contact
       JOIN sponsorships sponsorship ON sponsorship.id = contact.sponsorship_id
       JOIN events conference ON conference.id = sponsorship.event_id AND conference.org_id = ?
       JOIN companies company ON company.id = sponsorship.company_id AND company.org_id = conference.org_id
       LEFT JOIN sponsor_tiers tier ON tier.id = sponsorship.tier_id AND tier.event_id = sponsorship.event_id
       LEFT JOIN buildings building
         ON building.id = sponsorship.booth_building_id AND building.event_id = sponsorship.event_id
       WHERE contact.person_id = ? ${predicate}
       ORDER BY conference.starts_on ASC, sponsorship.id ASC
       LIMIT 1`,
    )
    .bind(...bindings)
    .first<SponsorshipRow>();
}

/**
 * Every deal this person is a contact on. One row is the ordinary case and the
 * page draws no switcher for it; a company sponsoring two conferences is why the
 * list exists at all.
 */
async function availableSponsorships(db: D1Database, auth: SessionAuth) {
  const rows = await db
    .prepare(
      `SELECT sponsorship.id, company.name AS company_name, conference.name AS event_name
       FROM sponsorship_contacts contact
       JOIN sponsorships sponsorship ON sponsorship.id = contact.sponsorship_id
       JOIN events conference ON conference.id = sponsorship.event_id AND conference.org_id = ?
       JOIN companies company ON company.id = sponsorship.company_id
       WHERE contact.person_id = ?
       ORDER BY conference.starts_on ASC, sponsorship.id ASC`,
    )
    .bind(auth.orgId, auth.personId)
    .all<{ id: string; company_name: string; event_name: string }>();
  return rows.results;
}

async function contactsFor(db: D1Database, sponsorshipId: string, viewerPersonId: string) {
  const rows = await db
    .prepare(
      `SELECT contact.person_id, contact.is_primary, person.name, person.title, person.email
       FROM sponsorship_contacts contact
       JOIN people person ON person.id = contact.person_id
       WHERE contact.sponsorship_id = ?
       ORDER BY contact.is_primary DESC, person.name COLLATE NOCASE ASC, contact.person_id ASC`,
    )
    .bind(sponsorshipId)
    .all<{ person_id: string; is_primary: number; name: string; title: string | null; email: string }>();
  return rows.results.map((row) => ({
    person_id: row.person_id,
    name: row.name,
    title: row.title,
    // A colleague's address is theirs; the roster names people, and the one
    // address the portal prints is the organizer's, who asked to be written to.
    is_primary: row.is_primary === 1,
    is_you: row.person_id === viewerPersonId,
  }));
}

/**
 * Who at the conference owns this sponsorship.
 *
 * Read from the event's own staff memberships rather than stored on the deal: a
 * second copy of "who to email" is a copy that goes stale the week the
 * sponsorship lead changes, and every sponsor then writes to someone who left.
 */
async function organizerContactFor(db: D1Database, eventId: string, orgId: string) {
  const row = await db
    .prepare(
      // Organization-scoped, and event-scoped seats sort ahead of org-wide ones.
      // Without the `org_id` predicate an org-wide `owner` in ANY organization is
      // an eligible candidate, and this name and address are printed on the page
      // and in the handbook — a cross-tenant leak of a stranger's contact details
      // dressed as "your organizer". The ordering matters for the same reason it
      // does everywhere else here: this conference's own staff answer for this
      // conference before the organization's general staff do.
      `SELECT person.id, person.name, person.email, membership.role
       FROM memberships membership
       JOIN people person ON person.id = membership.person_id AND person.org_id = ?
       WHERE membership.org_id = ?
         AND (membership.event_id = ? OR membership.event_id IS NULL)
         AND membership.role IN ('program_lead', 'owner', 'ops')
       ORDER BY CASE WHEN membership.event_id = ? THEN 0 ELSE 1 END,
         CASE membership.role
           WHEN 'program_lead' THEN 0 WHEN 'owner' THEN 1 ELSE 2 END,
         person.name COLLATE NOCASE ASC, person.id ASC
       LIMIT 1`,
    )
    .bind(orgId, orgId, eventId, eventId)
    .first<{ id: string; name: string; email: string; role: string }>();
  if (!row) return null;
  const roleLabel = row.role === "program_lead" ? "Program lead" : row.role === "owner" ? "Conference owner" : "Conference operations";
  return { person_id: row.id, name: row.name, email: row.email, role: roleLabel };
}

async function sessionsFor(db: D1Database, sponsorship: SponsorshipRow, showBuildingComparison: boolean) {
  const rows = await db
    .prepare(
      `SELECT s.id, s.title, s.abstract, format.name AS format_name,
         agenda.starts_at, agenda.duration_min, agenda.is_published,
         room.name AS room_name, building.name AS building_name,
         COALESCE((
           SELECT json_group_array(json_object('id', ordered.person_id, 'name', ordered.name))
           FROM (
             SELECT part.person_id, person.name
             FROM participations part
             JOIN people person ON person.id = part.person_id
             WHERE part.submission_id = s.id AND part.role IN ('speaker', 'co_speaker')
             ORDER BY part.position ASC, part.id ASC
           ) ordered
         ), '[]') AS speakers_json
       FROM submissions s
       LEFT JOIN formats format ON format.id = s.format_id AND format.event_id = s.event_id
       LEFT JOIN agenda_items agenda
         ON agenda.submission_id = s.id AND agenda.event_id = s.event_id AND agenda.kind = 'session'
       LEFT JOIN rooms room ON room.id = agenda.room_id AND room.event_id = s.event_id
       LEFT JOIN buildings building ON building.id = room.building_id AND building.event_id = s.event_id
       WHERE s.sponsorship_id = ? AND s.event_id = ?
       ORDER BY agenda.starts_at IS NULL ASC, agenda.starts_at ASC, s.id ASC`,
    )
    .bind(sponsorship.sponsorship_id, sponsorship.event_id)
    .all<SponsorSessionRow>();

  return rows.results.map((row) => {
    const speakers = JSON.parse(row.speakers_json) as Array<{ id: string; name: string }>;
    const slot = row.starts_at === null ? null : {
      starts_at: row.starts_at,
      duration_min: row.duration_min,
      day: new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: sponsorship.event_timezone }).format(new Date(row.starts_at)),
      date: new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: sponsorship.event_timezone }).format(new Date(row.starts_at)),
      time: new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: sponsorship.event_timezone }).format(new Date(row.starts_at)),
      room: row.room_name && row.building_name
        ? roomDisplayLabel({ name: row.room_name }, { name: row.building_name }, showBuildingComparison)
        : row.room_name ?? "—",
      is_published: row.is_published === 1,
    };
    return {
      id: row.id,
      title: row.title,
      description: row.abstract,
      format: row.format_name,
      speakers,
      slot,
    };
  });
}

function boothFor(sponsorship: SponsorshipRow) {
  // Booth data is a set of columns, so "has a booth" is ANY of those columns
  // carrying something — not a flag, and not a second record type (ruling 5).
  // All of them, not the three obvious ones: a sponsorship carrying only a
  // load-in window would otherwise render no booth card and silently drop the one
  // fact it had.
  const hasBoothData = [
    sponsorship.booth_number,
    sponsorship.booth_size,
    sponsorship.booth_hall,
    sponsorship.booth_load_in,
    sponsorship.booth_access_note,
    sponsorship.booth_leave_note,
    sponsorship.building_id,
  ].some((value) => value !== null && value !== "");
  if (!hasBoothData) return null;
  return {
    number: sponsorship.booth_number,
    size: sponsorship.booth_size,
    hall: sponsorship.booth_hall,
    load_in: sponsorship.booth_load_in,
    access_note: sponsorship.booth_access_note ?? sponsorship.building_access_note,
    leave_note: sponsorship.booth_leave_note,
    building: sponsorship.building_id
      ? {
          id: sponsorship.building_id,
          name: sponsorship.building_name,
          address: sponsorship.building_address,
          lat: sponsorship.building_lat,
          lng: sponsorship.building_lng,
        }
      : null,
  };
}

function statusLabel(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

async function sponsorPortalSnapshot(
  context: import("hono").Context<ApiEnv>,
  auth: SessionAuth,
  requestedSponsorshipId?: string,
) {
  const db = context.env.DB;
  const sponsorship = await sponsorshipFor(db, auth, requestedSponsorshipId);
  if (!sponsorship) throw ApiError.notFound("sponsorship not found");

  const mediaOrigin = (context.env as unknown as { MEDIA_PUBLIC_ORIGIN?: string }).MEDIA_PUBLIC_ORIGIN ?? "";
  const mediaSecret = (context.env as unknown as { UPLOAD_TOKEN_SECRET: string }).UPLOAD_TOKEN_SECRET;

  const [viewer, contacts, organizer, tasks, pinnedBuildings, options] = await Promise.all([
    db.prepare("SELECT id, name, email, title FROM people WHERE id = ?").bind(auth.personId)
      .first<{ id: string; name: string; email: string; title: string | null }>(),
    contactsFor(db, sponsorship.sponsorship_id, auth.personId),
    organizerContactFor(db, sponsorship.event_id, auth.orgId),
    listPortalTasks(
      db,
      { id: sponsorship.event_id, timezone: sponsorship.event_timezone },
      { kind: "sponsorship", sponsorshipId: sponsorship.sponsorship_id },
      mediaOrigin,
      mediaSecret,
    ),
    db.prepare(
      "SELECT COUNT(DISTINCT id) AS pinned_count FROM buildings WHERE event_id = ? AND lat IS NOT NULL AND lng IS NOT NULL",
    ).bind(sponsorship.event_id).first<{ pinned_count: number | null }>(),
    availableSponsorships(db, auth),
  ]);
  if (!viewer) throw ApiError.notFound("sponsor contact not found");

  const showBuildingComparison = showsBuildingComparisonCount(Number(pinnedBuildings?.pinned_count ?? 0));
  const sessions = await sessionsFor(db, sponsorship, showBuildingComparison);
  const booth = boothFor(sponsorship);

  return {
    seat: "sponsor_contact" as const,
    event: {
      id: sponsorship.event_id,
      name: sponsorship.event_name,
      slug: sponsorship.event_slug,
      starts_on: sponsorship.event_starts_on,
      ends_on: sponsorship.event_ends_on,
      timezone: sponsorship.event_timezone,
      venue: sponsorship.event_venue,
    },
    viewer: { id: viewer.id, name: viewer.name, email: viewer.email, title: viewer.title },
    sponsorship: {
      id: sponsorship.sponsorship_id,
      status: sponsorship.status,
      status_label: statusLabel(sponsorship.status),
      tier: sponsorship.tier_name,
      passes: sponsorship.passes,
      company: {
        id: sponsorship.company_id,
        name: sponsorship.company_name,
        website: sponsorship.company_website,
        blurb: sponsorship.company_blurb,
      },
      booth,
      // Derived, every time, from what is attached (AC 6).
      deal_line: dealLineChips({
        sessionCount: sessions.length,
        boothNumber: sponsorship.booth_number,
        passes: sponsorship.passes,
      }),
      organizer_contact: organizer,
    },
    contacts,
    tasks,
    sessions,
    handbook: sponsorHandbookChapters({
      eventSlug: sponsorship.event_slug,
      hasBooth: booth !== null,
      boothNumber: sponsorship.booth_number,
      organizerEmail: organizer?.email ?? null,
    }),
    available_sponsorships: options,
  };
}

const getSponsorPortal = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/me/sponsor-portal",
    operationId: "getSponsorPortal",
    summary: "Read the authenticated sponsor portal",
    description:
      "Returns the whole sponsorship this contact holds: the deal and its derived deal line, every deliverable with its assignee and its completer, the read-only Session cards, the contact roster, and the sponsor handbook. Every deliverable of the sponsorship is visible to every contact.",
    tags: ["Sponsor portal"],
    request: { query: sponsorshipQuery },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "read" }, concurrency: "none" },
    responses: { 200: jsonResponse(sponsorPortalResponseSchema, "Sponsor portal snapshot"), ...errorResponses([401, 403, 404, 429, 500]) },
  },
  async (context) => {
    const auth = requireSponsorSession(context);
    const query = context.req.valid("query");
    return context.json(await sponsorPortalSnapshot(context, auth, query.sponsorshipId), 200);
  },
);

/**
 * The company's public facts, edited by a contact who holds the deal.
 *
 * Org-level on purpose: these carry to every conference this company sponsors,
 * which is what `companies` above `sponsorships` means. The contact ROSTER is
 * deliberately not writable here — access to a sponsorship is the organizer's
 * to grant, and a portal that could add its own contacts would be a portal that
 * could invite anybody into the deal.
 */
const updateSponsorCompany = defineApiRoute(
  {
    method: "patch",
    path: "/api/v1/me/sponsorships/{sponsorshipId}/company",
    operationId: "updateSponsorCompany",
    summary: "Update the organization-level company profile behind a sponsorship",
    description:
      "Updates the company facts the conference publishes. Authorized only for a contact of the named sponsorship; the contact roster itself is managed by the organizer.",
    tags: ["Sponsor portal"],
    request: { params: sponsorshipParams, body: { content: { "application/json": { schema: companyPatchBody } } } },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 200: jsonResponse(sponsorCompanyResponseSchema, "Updated company profile"), ...errorResponses([400, 401, 403, 404, 422, 429, 500]) },
  },
  async (context) => {
    const auth = requireSponsorSession(context);
    const { sponsorshipId } = context.req.valid("param");
    const body = context.req.valid("json");
    if (body.name === undefined && body.website === undefined && body.blurb === undefined) {
      throw ApiError.badRequest("Change a company name, website, or blurb before saving.");
    }
    const sponsorship = await sponsorshipFor(context.env.DB, auth, sponsorshipId);
    if (!sponsorship) throw ApiError.notFound("sponsorship not found");

    const next = {
      name: body.name === undefined ? sponsorship.company_name : body.name,
      website: body.website === undefined ? sponsorship.company_website : (body.website || null),
      blurb: body.blurb === undefined ? sponsorship.company_blurb : (body.blurb || null),
    };
    const now = Date.now();
    await context.env.DB.batch([
      context.env.DB.prepare(
        `UPDATE companies SET name = ?, website = ?, blurb = ?, last_write_source = 'marquee', updated_at = ?
         WHERE id = ? AND org_id = ?`,
      ).bind(next.name, next.website, next.blurb, now, sponsorship.company_id, auth.orgId),
      auditStatement(context.env.DB, {
        eventId: sponsorship.event_id,
        actorKind: "user",
        actorPersonId: auth.personId,
        action: "sponsor_company_updated",
        entityType: "company",
        entityId: sponsorship.company_id,
        before: {
          name: sponsorship.company_name,
          website: sponsorship.company_website,
          blurb: sponsorship.company_blurb,
        },
        after: next,
        now,
        requestId: context.get("requestId") ?? null,
      }),
    ]);
    return context.json({ company: { id: sponsorship.company_id, ...next } }, 200);
  },
);

export const apiRoutes = [getSponsorPortal, updateSponsorCompany];
