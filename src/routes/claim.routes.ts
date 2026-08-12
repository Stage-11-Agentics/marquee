import { z } from "@hono/zod-openapi";
import type { Context } from "hono";

import { ApiError } from "../api/errors";
import { defineApiRoute, errorResponses, jsonResponse } from "../api/route";
import type { ApiEnv } from "../api/runtime";
import { SESSION_TTL_MS } from "../lib/auth/auth-sessions";
import {
  exchangeInstanceLink,
  instanceIsUnclaimed,
  mintClaimLink,
} from "../lib/auth/instance-claim";
import { setSessionCookie } from "../lib/cookies";

/**
 * The two unauthenticated doors of the cold start, and the only two that exist.
 *
 * `setup/claim-link` is callable without a credential because it exists
 * precisely when no credential does — and it is self-limiting: the moment the
 * instance has an owner it refuses, forever (SPEC Amendment 19 §4.3).
 *
 * `claim` is the single exchange path for both a claim token and an organizer
 * invite (AC-282). Neither route touches a mail binding: identity here cannot
 * depend on the thing setup configures.
 */

const claimLinkResponse = z.object({
  ok: z.literal(true),
  /** Returned once. Never stored, never logged — the log allowlist has no field for it. */
  claim_url: z.string(),
  expires_at: z.number(),
});
const claimRequest = z.object({
  token: z.string().min(1),
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().min(3).max(320),
  purpose: z.enum(["claim", "org_invite"]).default("claim"),
});
const claimResponse = z.object({
  ok: z.literal(true),
  person: z.object({ id: z.string(), name: z.string(), email: z.string() }),
  org_id: z.string(),
  role: z.literal("owner"),
  redirect_to: z.string(),
});

const mintInstanceClaimLink = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/setup/claim-link",
    operationId: "mintInstanceClaimLink",
    summary: "Mint the one-time link that claims an unowned instance",
    description:
      "Available only while no person owns this instance. Minting invalidates any previous claim link, so re-running it is the permanent recovery path rather than a way to accumulate live keys.",
    tags: ["Setup"],
    policy: { auth: { kind: "public" }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: {
      201: jsonResponse(claimLinkResponse, "The claim URL, returned exactly once."),
      ...errorResponses([409, 429, 500]),
    },
  },
  (async (context: Context<ApiEnv>) => {
    const origin = new URL(context.req.url).origin;
    const minted = await mintClaimLink(context.env.DB, { origin });
    if (!minted) {
      throw new ApiError(
        "conflict",
        "This instance already has an owner; invite further organizers from Conference settings → Organizers",
      );
    }
    context.header("Cache-Control", "no-store");
    return context.json(
      { ok: true as const, claim_url: minted.url, expires_at: minted.expires_at },
      201,
    );
  }) as never,
);

const claimInstance = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/claim",
    operationId: "claimInstance",
    summary: "Exchange a claim or organizer-invite token for ownership and a session",
    description:
      "Creates the organization if absent, the person, an organization-wide owner membership, and a session. The token is consumed by the same statement that read it, so a replay creates nothing.",
    tags: ["Setup"],
    request: { body: { content: { "application/json": { schema: claimRequest } } } },
    policy: { auth: { kind: "public" }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: {
      200: jsonResponse(claimResponse, "Ownership landed on a person."),
      401: jsonResponse(
        z.object({ error: z.object({ code: z.string(), message: z.string() }) }),
        "The link is expired, already used, or unknown.",
      ),
      ...errorResponses([400, 429, 500]),
    },
  },
  (async (context: Context<ApiEnv>) => {
    const body = await context.req.json<z.infer<typeof claimRequest>>();
    const purpose = body.purpose ?? "claim";
    // A claim token only ever works while the instance is unowned. Checking here
    // as well as at mint closes the window where a link minted before a claim is
    // presented after one.
    if (purpose === "claim" && !(await instanceIsUnclaimed(context.env.DB))) {
      return inertResponse(context);
    }
    const result = await exchangeInstanceLink(context.env.DB, {
      token: body.token,
      purpose,
      name: body.name,
      email: body.email,
      userAgent: context.req.header("user-agent") ?? "",
    });
    if (!result) return inertResponse(context);
    setSessionCookie(context, result.session.id, SESSION_TTL_MS / 1000);
    context.header("Cache-Control", "no-store");
    return context.json(
      {
        ok: true as const,
        person: {
          id: result.person.id,
          name: result.person.name,
          email: result.person.email,
        },
        org_id: result.organization.id,
        role: "owner" as const,
        redirect_to: result.redirectTo,
      },
      200,
    );
  }) as never,
);

/** One answer for used, expired, and unknown alike — the inert page's own words. */
function inertResponse(context: Context<ApiEnv>): Response {
  context.header("Cache-Control", "no-store");
  return context.json(
    {
      error: {
        code: "link_inert",
        message:
          "This link has expired or was already used. Re-run the claim-link command in your deploy terminal for a fresh one.",
      },
    },
    401,
  );
}

export const apiRoutes = [mintInstanceClaimLink, claimInstance];
