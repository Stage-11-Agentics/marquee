import { z } from "@hono/zod-openapi";

import { ApiError } from "../api/errors";
import { defineApiRoute, errorResponses, jsonResponse } from "../api/route";
import type { MagicLinkRow, MembershipRow, PersonRow } from "../db/schema";
import { revokeAccessStatements } from "../lib/auth/access-revocation";
import { INSTANCE_ORGANIZER_ROLE, mintOrganizerInvite } from "../lib/auth/instance-claim";
import { requireOrgAdmin, requireOrgOwner } from "../lib/auth/org-admin";
import { ORG_ACTIVITY_ACTIONS } from "../lib/activity-copy";
import { orgActivityStatement, orgActor, recordOrgActivity } from "../lib/org-activity";

/**
 * Who can run this instance, and how the next one gets in.
 *
 * An invite is a link, never a mail dependency (ruling D7): mail, once
 * configured, only offers to carry a link that already works without it. The
 * exchange itself lives in `claim.routes.ts` — an invite is a claim against an
 * instance that already has an owner, and there is exactly one implementation
 * of "turn a token into a session" in this codebase (AC-282).
 */

/**
 * The roles an invite may offer.
 *
 * `owner` is deliberately absent: ownership moves by transfer, not by minting a
 * second one from a link, and `speaker` is not an organizer seat at all — a
 * speaker's way in is their participation, not a membership. Both remain legal
 * values of `memberships.role`; this is the narrower question of what a *link*
 * may hand out.
 */
const INVITABLE_ROLES = ["program_lead", "ops", "reviewer"] as const;

const inviteSummary = z.object({
  id: z.string(),
  created_at: z.number(),
  expires_at: z.number(),
  used_at: z.number().nullable(),
  /** The seat this link mints, so a pending row can say what it is for. */
  role: z.string(),
  /** Null is the whole organization; an id scopes the seat to one conference. */
  event_id: z.string().nullable(),
  event_name: z.string().nullable(),
});
const inviteListResponse = z.object({ data: z.array(inviteSummary) });
const inviteCreateResponse = z.object({
  data: inviteSummary,
  /** Shown once. The row stores only the hash. */
  invite_url: z.string(),
  /** The same row, spoken across a registration desk. Shown once, hashed at rest. */
  short_code: z.string().nullable(),
  /** True only when a real Resend key is present; the link works either way. */
  mail_configured: z.boolean(),
});
const inviteCreateRequest = z
  .object({
    // The least authority that still means "organizer". A request that names no
    // role must not mint the most powerful seat on the instance by omission.
    role: z.enum(INVITABLE_ROLES).default("program_lead"),
    /** Omitted or null is an organization-wide seat. */
    event_id: z.string().trim().min(1).nullable().default(null),
  })
  .strict();
const inviteParams = z.object({ inviteId: z.string().min(1) });

const memberSummary = z.object({
  person_id: z.string(),
  name: z.string(),
  email: z.string(),
  role: z.string(),
  is_you: z.boolean(),
  created_at: z.number(),
  /** Null is the whole organization; an id is a seat that ends with one conference. */
  event_id: z.string().nullable(),
  event_name: z.string().nullable(),
});
const memberListResponse = z.object({ data: z.array(memberSummary) });
const memberParams = z.object({ personId: z.string().min(1) });
const removeMemberRequest = z
  .object({
    /**
     * Which of the tokens they minted die with them. The dialog lists their
     * tokens with revoke pre-checked (ruling O3) and sends back exactly what the
     * human confirmed — some of those tokens power integrations the
     * organization keeps, so this is show-and-choose, never a sweep.
     */
    revoke_token_ids: z.array(z.string().trim().min(1)).max(200).default([]),
  })
  .strict();

const orgErrors = errorResponses([400, 401, 403, 404, 422, 429, 500]);

const listOrganizerInvites = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/org/invites",
    operationId: "listOrganizerInvites",
    summary: "List pending organizer invites",
    description: "Unused, unexpired invites only. A spent invite is history, not a pending one.",
    tags: ["Organizers"],
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "read" }, concurrency: "none" },
    responses: { 200: jsonResponse(inviteListResponse, "Pending invites"), ...orgErrors },
  },
  async (context) => {
    requireOrgAdmin(context, "program:read");
    const now = Date.now();
    const rows = await context.env.DB.prepare(
      `SELECT l.id AS id, l.created_at AS created_at, l.expires_at AS expires_at, l.used_at AS used_at,
              l.invite_role AS invite_role, l.invite_event_id AS invite_event_id, e.name AS event_name
         FROM magic_links l
         LEFT JOIN events e ON e.id = l.invite_event_id
        WHERE l.purpose = 'org_invite' AND l.used_at IS NULL AND l.expires_at > ?
        ORDER BY l.created_at DESC, l.id DESC`,
    )
      .bind(now)
      .all<PendingInviteRow>();
    return context.json({ data: rows.results.map(summarizeInvite) }, 200);
  },
);

type PendingInviteRow = Pick<
  MagicLinkRow,
  "id" | "created_at" | "expires_at" | "used_at" | "invite_role" | "invite_event_id"
> & { event_name: string | null };

/**
 * A pending row says what seat it will mint. `invite_role` is null on invites
 * minted before Amendment 21, which meant org-wide owner and still do — the
 * default here is the same one `instance-claim` applies at exchange, so the
 * list never promises a seat different from the one the link delivers.
 */
function summarizeInvite(row: PendingInviteRow) {
  return {
    id: row.id,
    created_at: row.created_at,
    expires_at: row.expires_at,
    used_at: row.used_at,
    role: row.invite_role ?? INSTANCE_ORGANIZER_ROLE,
    event_id: row.invite_event_id,
    event_name: row.event_name ?? null,
  };
}

const createOrganizerInvite = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/org/invites",
    operationId: "createOrganizerInvite",
    summary: "Mint a one-time organizer invite link",
    description:
      "Returns a single-use URL valid for seven days, plus a speakable short code for the registration desk. The link carries the role and scope chosen here, so the recipient confirms who they are and never what they may do. Nothing is emailed; the link is handed over on whatever channel the organizers already share.",
    tags: ["Organizers"],
    request: { body: { content: { "application/json": { schema: inviteCreateRequest } } } },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 201: jsonResponse(inviteCreateResponse, "The invite URL, returned once."), ...orgErrors },
  },
  async (context) => {
    const auth = requireOrgAdmin(context);
    // The body is optional on this route by history — the CLI and the cold-start
    // card both mint with no arguments — so an absent body means "the defaults",
    // not a 400.
    const parsed = inviteCreateRequest.safeParse(await readOptionalJson(context));
    if (!parsed.success) throw ApiError.badRequest("invalid invite", parsed.error.issues[0]?.path.join("."));
    const seat = { role: parsed.data.role, eventId: parsed.data.event_id };
    if (seat.eventId !== null) {
      // A scope is a promise about a conference this organization runs. Without
      // this check an id from another tenant would mint a membership pointing
      // into it.
      const event = await context.env.DB.prepare("SELECT id FROM events WHERE id = ? AND org_id = ?")
        .bind(seat.eventId, auth.orgId)
        .first<{ id: string }>();
      if (!event) throw ApiError.unprocessable("that conference is not on this organization", "event_id");
    }
    const origin = new URL(context.req.url).origin;
    const invite = await mintOrganizerInvite(context.env.DB, { origin, seat });
    const row = await context.env.DB.prepare(
      `SELECT l.id AS id, l.created_at AS created_at, l.expires_at AS expires_at, l.used_at AS used_at,
              l.invite_role AS invite_role, l.invite_event_id AS invite_event_id, e.name AS event_name
         FROM magic_links l LEFT JOIN events e ON e.id = l.invite_event_id
        WHERE l.id = ?`,
    )
      .bind(invite.id)
      .first<PendingInviteRow>();
    if (!row) throw new Error("minted_invite_disappeared");
    // The link itself is never recorded — the log says an invite exists and who
    // made it, which is what an owner reviewing access needs. A credential in an
    // append-only table would outlive every reason it was minted for.
    await recordOrgActivity(context.env.DB, {
      orgId: auth.orgId,
      ...orgActor(auth),
      action: ORG_ACTIVITY_ACTIONS.inviteMinted,
      entityType: "invite",
      entityId: invite.id,
      after: { role: INSTANCE_ORGANIZER_ROLE, expires_at: row.expires_at },
      now: row.created_at,
      requestId: context.get("requestId") ?? null,
    });
    context.header("Cache-Control", "no-store");
    const resendKey = (context.env as { RESEND_API_KEY?: string }).RESEND_API_KEY;
    return context.json(
      {
        data: summarizeInvite(row),
        invite_url: invite.url,
        short_code: invite.short_code,
        mail_configured: typeof resendKey === "string" && resendKey.trim().length > 0,
      },
      201,
    );
  },
);

/** An absent or empty body is `{}` here; malformed JSON is still a client error. */
async function readOptionalJson(context: { req: { text: () => Promise<string> } }): Promise<unknown> {
  const raw = (await context.req.text().catch(() => "")).trim();
  if (raw.length === 0) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw ApiError.badRequest("body must be JSON");
  }
}

const revokeOrganizerInvite = defineApiRoute(
  {
    method: "delete",
    path: "/api/v1/org/invites/{inviteId}",
    operationId: "revokeOrganizerInvite",
    summary: "Revoke a pending organizer invite",
    description: "Revocation marks the link spent, so it can no longer be exchanged.",
    tags: ["Organizers"],
    request: { params: inviteParams },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 200: jsonResponse(z.object({ data: inviteSummary }), "The revoked invite"), ...orgErrors },
  },
  async (context) => {
    const auth = requireOrgAdmin(context);
    const { inviteId } = context.req.valid("param");
    const now = Date.now();
    const revoked = await context.env.DB.prepare(
      `UPDATE magic_links SET used_at = ?, updated_at = ?
        WHERE id = ? AND purpose = 'org_invite' AND used_at IS NULL`,
    )
      .bind(now, now, inviteId)
      .run();
    if ((revoked.meta.changes ?? 0) !== 1) throw ApiError.notFound("invite not found");
    const row = await context.env.DB.prepare(
      `SELECT l.id AS id, l.created_at AS created_at, l.expires_at AS expires_at, l.used_at AS used_at,
              l.invite_role AS invite_role, l.invite_event_id AS invite_event_id, e.name AS event_name
         FROM magic_links l LEFT JOIN events e ON e.id = l.invite_event_id
        WHERE l.id = ?`,
    )
      .bind(inviteId)
      .first<PendingInviteRow>();
    if (!row) throw ApiError.notFound("invite not found");
    // Recorded after the guarded UPDATE, so the row exists only for a revocation
    // that actually spent a live invite — a second DELETE on the same id 404s
    // and writes nothing.
    await recordOrgActivity(context.env.DB, {
      orgId: auth.orgId,
      ...orgActor(auth),
      action: ORG_ACTIVITY_ACTIONS.inviteRevoked,
      entityType: "invite",
      entityId: inviteId,
      before: { role: INSTANCE_ORGANIZER_ROLE, expires_at: row.expires_at },
      now,
      requestId: context.get("requestId") ?? null,
    });
    return context.json({ data: summarizeInvite(row) }, 200);
  },
);

const listOrganizers = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/org/members",
    operationId: "listOrganizers",
    summary: "List everyone who can run this instance",
    tags: ["Organizers"],
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "read" }, concurrency: "none" },
    responses: { 200: jsonResponse(memberListResponse, "Organization-wide memberships"), ...orgErrors },
  },
  async (context) => {
    const auth = requireOrgAdmin(context, "program:read");
    // Conference-scoped organizer seats are listed beside the org-wide ones:
    // ruling O4 mints them (a day-of volunteer is `ops` scoped to the event),
    // and a seat the removal flow ends must be a seat the list shows, or the
    // organizer cannot find what they are being asked to retire. `speaker` is
    // excluded — it is a participation, not a seat on the instance.
    const rows = await context.env.DB.prepare(
      `SELECT m.person_id AS person_id, p.name AS name, p.email AS email, m.role AS role,
              m.created_at AS created_at, m.event_id AS event_id, e.name AS event_name
         FROM memberships m
         JOIN people p ON p.id = m.person_id
         LEFT JOIN events e ON e.id = m.event_id
        WHERE m.org_id = ? AND m.role != 'speaker'
        ORDER BY m.created_at ASC, m.id ASC`,
    )
      .bind(auth.orgId)
      .all<{
        person_id: string;
        name: string;
        email: string;
        role: string;
        created_at: number;
        event_id: string | null;
        event_name: string | null;
      }>();
    const you = auth.kind === "session" ? auth.personId : null;
    return context.json(
      { data: rows.results.map((row) => ({ ...row, is_you: row.person_id === you })) },
      200,
    );
  },
);

const removeOrganizer = defineApiRoute(
  {
    method: "delete",
    path: "/api/v1/org/members/{personId}",
    operationId: "removeOrganizer",
    summary: "Remove an organizer's access to this instance",
    description:
      "Deletes every organizer membership they hold — organization-wide and conference-scoped alike — and in the same transaction revokes their sessions, consumes the unexpired sign-in links already in their inbox, and revokes the API tokens named in the request. Their authored decisions and evaluations stay on the record. A speaker participation is a different seat and is never touched. The last remaining owner cannot be removed.",
    tags: ["Organizers"],
    request: { params: memberParams, body: { content: { "application/json": { schema: removeMemberRequest } } } },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: {
      200: jsonResponse(
        z.object({
          data: z.object({
            person_id: z.string(),
            removed_roles: z.array(z.string()),
            revoked_sessions: z.number(),
            consumed_links: z.number(),
            revoked_tokens: z.number(),
          }),
        }),
        "Access ended",
      ),
      ...orgErrors,
    },
  },
  async (context) => {
    const auth = requireOrgOwner(context);
    const { personId } = context.req.valid("param");
    const parsed = removeMemberRequest.safeParse(await readOptionalJson(context));
    if (!parsed.success) {
      throw ApiError.badRequest("invalid removal", parsed.error.issues[0]?.path.join("."));
    }
    // Every organizer seat, not only the org-wide ones (ruling O3): a fired
    // volunteer's conference-scoped `ops` seat is exactly the access being
    // ended, and leaving it behind would make the dialog a lie. `speaker` is
    // excluded because it is not an organizer seat — the same human can hold
    // both, and removing the organizer must never touch the speaker.
    const memberships = await context.env.DB.prepare(
      "SELECT * FROM memberships WHERE org_id = ? AND person_id = ? AND role != 'speaker'",
    )
      .bind(auth.orgId, personId)
      .all<MembershipRow>();
    if (memberships.results.length === 0) throw ApiError.notFound("organizer not found");

    if (memberships.results.some((membership) => membership.role === INSTANCE_ORGANIZER_ROLE)) {
      const owners = await context.env.DB.prepare(
        "SELECT COUNT(*) AS total FROM memberships WHERE org_id = ? AND event_id IS NULL AND role = ?",
      )
        .bind(auth.orgId, INSTANCE_ORGANIZER_ROLE)
        .first<{ total: number }>();
      if (Number(owners?.total ?? 0) <= 1) {
        throw ApiError.unprocessable(
          "This is the last owner of the instance. Invite another owner before removing this one.",
          "personId",
        );
      }
    }

    const now = Date.now();
    // Counted before the batch revokes them, because afterwards the number is
    // zero and the log would report "no active sign-ins" for the removal that
    // just ended four of them. What a removal actually revoked is the reason
    // this row exists at all.
    //
    // The count is therefore descriptive, not authoritative: a session minted in
    // the milliseconds between this read and the batch is revoked by the batch
    // and not counted here. That is the right trade — the alternative is
    // counting inside the same transaction that zeroes the number, or splitting
    // the audit row out of the batch, and a row that can disagree with the
    // removal it describes is a worse defect than a count that can be one low.
    const liveSessions = await context.env.DB.prepare(
      "SELECT COUNT(*) AS total FROM auth_sessions WHERE person_id = ? AND revoked_at IS NULL",
    )
      .bind(personId)
      .first<{ total: number }>();
    // One batch, four arms. Authority and every way back in end together or not
    // at all: a request that failed between the membership delete and the
    // session revoke would leave a fired organizer holding a live cookie, and a
    // request that failed before the link arm would leave one holding a live
    // sign-in link, which is the same defect with a longer fuse.
    const results = await context.env.DB.batch([
      context.env.DB.prepare(
        "DELETE FROM memberships WHERE org_id = ? AND person_id = ? AND role != 'speaker'",
      ).bind(auth.orgId, personId),
      ...revokeAccessStatements(context.env.DB, {
        orgId: auth.orgId,
        personId,
        now,
        tokenIds: parsed.data.revoke_token_ids,
        // Their own way back in. A speaker-side link belongs to a seat this
        // action is not ending, so it is left alone.
        purposes: ["login"],
      }),
      orgActivityStatement(context.env.DB, {
        orgId: auth.orgId,
        ...orgActor(auth),
        action: ORG_ACTIVITY_ACTIONS.memberRemoved,
        // The subject is the person, not the membership row that no longer
        // exists: this is how the removal reaches their own record's feed
        // (lens two) without that lens having to scan payloads for an id.
        entityType: "person",
        entityId: personId,
        before: { removed_roles: memberships.results.map((membership) => membership.role) },
        after: { revoked_sessions: Number(liveSessions?.total ?? 0) },
        now,
        requestId: context.get("requestId") ?? null,
      }),
    ]);
    const changes = results.map((result) => Number(result.meta?.changes ?? 0));
    const person = await context.env.DB.prepare("SELECT id FROM people WHERE id = ?")
      .bind(personId)
      .first<Pick<PersonRow, "id">>();
    return context.json(
      {
        data: {
          person_id: person?.id ?? personId,
          removed_roles: memberships.results.map((membership) => membership.role),
          revoked_sessions: changes[1] ?? 0,
          consumed_links: changes[2] ?? 0,
          revoked_tokens: parsed.data.revoke_token_ids.length === 0 ? 0 : (changes[3] ?? 0),
        },
      },
      200,
    );
  },
);

export const apiRoutes = [
  listOrganizerInvites,
  createOrganizerInvite,
  revokeOrganizerInvite,
  listOrganizers,
  removeOrganizer,
];
