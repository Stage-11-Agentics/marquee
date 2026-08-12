import { z } from "@hono/zod-openapi";

import { ApiError } from "../api/errors";
import { defineApiRoute, errorResponses, jsonResponse } from "../api/route";
import type { MagicLinkRow, MembershipRow, PersonRow } from "../db/schema";
import { INSTANCE_ORGANIZER_ROLE, mintOrganizerInvite } from "../lib/auth/instance-claim";
import { requireOrgAdmin, requireOrgOwner } from "../lib/auth/org-admin";

/**
 * Who can run this instance, and how the next one gets in.
 *
 * An invite is a link, never a mail dependency (ruling D7): mail, once
 * configured, only offers to carry a link that already works without it. The
 * exchange itself lives in `claim.routes.ts` — an invite is a claim against an
 * instance that already has an owner, and there is exactly one implementation
 * of "turn a token into a session" in this codebase (AC-282).
 */

const inviteSummary = z.object({
  id: z.string(),
  created_at: z.number(),
  expires_at: z.number(),
  used_at: z.number().nullable(),
});
const inviteListResponse = z.object({ data: z.array(inviteSummary) });
const inviteCreateResponse = z.object({
  data: inviteSummary,
  /** Shown once. The row stores only the hash. */
  invite_url: z.string(),
  /** True only when a real Resend key is present; the link works either way. */
  mail_configured: z.boolean(),
});
const inviteParams = z.object({ inviteId: z.string().min(1) });

const memberSummary = z.object({
  person_id: z.string(),
  name: z.string(),
  email: z.string(),
  role: z.string(),
  is_you: z.boolean(),
  created_at: z.number(),
});
const memberListResponse = z.object({ data: z.array(memberSummary) });
const memberParams = z.object({ personId: z.string().min(1) });

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
      `SELECT id, created_at, expires_at, used_at FROM magic_links
        WHERE purpose = 'org_invite' AND used_at IS NULL AND expires_at > ?
        ORDER BY created_at DESC, id DESC`,
    )
      .bind(now)
      .all<Pick<MagicLinkRow, "id" | "created_at" | "expires_at" | "used_at">>();
    return context.json({ data: rows.results }, 200);
  },
);

const createOrganizerInvite = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/org/invites",
    operationId: "createOrganizerInvite",
    summary: "Mint a one-time organizer invite link",
    description:
      "Returns a single-use URL valid for seven days. Nothing is emailed; the link is handed over on whatever channel the organizers already share.",
    tags: ["Organizers"],
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 201: jsonResponse(inviteCreateResponse, "The invite URL, returned once."), ...orgErrors },
  },
  async (context) => {
    requireOrgAdmin(context);
    const origin = new URL(context.req.url).origin;
    const invite = await mintOrganizerInvite(context.env.DB, { origin });
    const row = await context.env.DB.prepare(
      "SELECT id, created_at, expires_at, used_at FROM magic_links WHERE id = ?",
    )
      .bind(invite.id)
      .first<Pick<MagicLinkRow, "id" | "created_at" | "expires_at" | "used_at">>();
    if (!row) throw new Error("minted_invite_disappeared");
    context.header("Cache-Control", "no-store");
    const resendKey = (context.env as { RESEND_API_KEY?: string }).RESEND_API_KEY;
    return context.json(
      {
        data: row,
        invite_url: invite.url,
        mail_configured: typeof resendKey === "string" && resendKey.trim().length > 0,
      },
      201,
    );
  },
);

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
    requireOrgAdmin(context);
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
      "SELECT id, created_at, expires_at, used_at FROM magic_links WHERE id = ?",
    )
      .bind(inviteId)
      .first<Pick<MagicLinkRow, "id" | "created_at" | "expires_at" | "used_at">>();
    if (!row) throw ApiError.notFound("invite not found");
    return context.json({ data: row }, 200);
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
    const rows = await context.env.DB.prepare(
      `SELECT m.person_id AS person_id, p.name AS name, p.email AS email, m.role AS role, m.created_at AS created_at
         FROM memberships m
         JOIN people p ON p.id = m.person_id
        WHERE m.org_id = ? AND m.event_id IS NULL
        ORDER BY m.created_at ASC, m.id ASC`,
    )
      .bind(auth.orgId)
      .all<{ person_id: string; name: string; email: string; role: string; created_at: number }>();
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
      "Deletes their organization-wide memberships and revokes their sessions in the same batch, so a link already in their inbox stops working. Their authored decisions and evaluations stay on the record. The last remaining owner cannot be removed.",
    tags: ["Organizers"],
    request: { params: memberParams },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: {
      200: jsonResponse(
        z.object({ data: z.object({ person_id: z.string(), removed_roles: z.array(z.string()) }) }),
        "Access ended",
      ),
      ...orgErrors,
    },
  },
  async (context) => {
    const auth = requireOrgOwner(context);
    const { personId } = context.req.valid("param");
    const memberships = await context.env.DB.prepare(
      "SELECT * FROM memberships WHERE org_id = ? AND person_id = ? AND event_id IS NULL",
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
    // One batch: access cannot end in the membership table and survive in the
    // session table, however the request fails after the first statement.
    await context.env.DB.batch([
      context.env.DB.prepare(
        "DELETE FROM memberships WHERE org_id = ? AND person_id = ? AND event_id IS NULL",
      ).bind(auth.orgId, personId),
      context.env.DB.prepare(
        "UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, ?), updated_at = ? WHERE person_id = ? AND revoked_at IS NULL",
      ).bind(now, now, personId),
    ]);
    const person = await context.env.DB.prepare("SELECT id FROM people WHERE id = ?")
      .bind(personId)
      .first<Pick<PersonRow, "id">>();
    return context.json(
      {
        data: {
          person_id: person?.id ?? personId,
          removed_roles: memberships.results.map((membership) => membership.role),
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
