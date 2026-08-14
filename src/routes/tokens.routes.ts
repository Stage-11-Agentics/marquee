import { z } from "@hono/zod-openapi";
import type { Context } from "hono";

import { ApiError } from "../api/errors";
import { newUlid } from "../api/ids";
import { API_GRANTS, apiGrantSchemaValues } from "../api/grants";
import { defineApiRoute, errorResponses, jsonResponse } from "../api/route";
import type { ApiEnv } from "../api/runtime";
import type { ApiTokenRow, ApiTokenScopes } from "../db/schema";
import { getAuth } from "../lib/auth/auth-middleware";
import { mintToken, sha256Hex } from "../lib/auth/random-token";
import { roleRank, type SessionAuth } from "../lib/auth/scope-resolution";
import { ORG_ACTIVITY_ACTIONS } from "../lib/activity-copy";
import { orgActor, recordOrgActivity } from "../lib/org-activity";

const tokenParams = z.object({ tokenId: z.string().min(1) });
const tokenScopes = z.object({
  permissions: z.array(z.enum(apiGrantSchemaValues)).min(1).max(API_GRANTS.length),
  event_ids: z.array(z.string().trim().min(1)).max(100).default([]),
});
const tokenInput = z.object({
  name: z.string().trim().min(1).max(120),
  scopes: tokenScopes,
}).strict();

const tokenScopeResponse = z.object({
  permissions: z.array(z.enum(apiGrantSchemaValues)),
  event_ids: z.array(z.string()),
});
const tokenSummary = z.object({
  acts_as_person_id: z.string().nullable(),
  acting_person_name: z.string().nullable(),
  id: z.string(),
  org_id: z.string(),
  event_id: z.string().nullable(),
  name: z.string(),
  prefix: z.string(),
  scopes: tokenScopeResponse,
  created_by: z.string(),
  last_used_at: z.number().nullable(),
  revoked_at: z.number().nullable(),
  created_at: z.number(),
  updated_at: z.number(),
}).openapi("ApiToken");
const tokenListResponse = z.object({ data: z.array(tokenSummary) });
const tokenCreateResponse = z.object({
  data: tokenSummary,
  secret: z.string(),
});
const tokenErrorResponses = errorResponses([400, 401, 403, 404, 422, 429, 500]);

function requireTokenAdmin(context: Context<ApiEnv>): SessionAuth {
  const auth = getAuth(context);
  if (!auth || auth.kind !== "session") {
    throw ApiError.forbidden("API tokens can only be managed from an organizer session");
  }
  const hasAdminMembership = auth.memberships.some(
    (membership) =>
      membership.org_id === auth.orgId &&
      membership.event_id === null &&
      roleRank(membership.role) >= roleRank("program_lead"),
  );
  if (!hasAdminMembership) {
    throw ApiError.forbidden("API tokens require an organization program lead or owner");
  }
  return auth;
}

async function assertEventIdsBelongToOrg(
  db: D1Database,
  orgId: string,
  eventIds: readonly string[],
): Promise<void> {
  const unique = new Set(eventIds);
  if (unique.size !== eventIds.length) {
    throw ApiError.badRequest("event_ids must not contain duplicates", "scopes.event_ids");
  }
  if (eventIds.length === 0) return;
  const placeholders = eventIds.map(() => "?").join(", ");
  const rows = await db
    .prepare(`SELECT id FROM events WHERE org_id = ? AND id IN (${placeholders})`)
    .bind(orgId, ...eventIds)
    .all<{ id: string }>();
  if (rows.results.length !== eventIds.length) {
    throw ApiError.unprocessable(
      "every restricted conference must belong to the current organization",
      "scopes.event_ids",
    );
  }
}

function parseScopes(value: ApiTokenRow["scopes"]): ApiTokenScopes {
  const parsed = JSON.parse(value as string) as ApiTokenScopes;
  return {
    permissions: parsed.permissions,
    event_ids: parsed.event_ids,
  };
}

function summarizeToken(row: ApiTokenRow) {
  return {
    acts_as_person_id: (row as ApiTokenRow & { acts_as_person_id?: string | null }).acts_as_person_id ?? null,
    acting_person_name: (row as ApiTokenRow & { acting_person_name?: string | null }).acting_person_name ?? null,
    id: row.id,
    org_id: row.org_id,
    event_id: row.event_id,
    name: row.name,
    prefix: row.prefix,
    scopes: parseScopes(row.scopes),
    created_by: row.created_by,
    last_used_at: row.last_used_at,
    revoked_at: row.revoked_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

const listTokens = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/org/tokens",
    operationId: "listApiTokens",
    summary: "List organization API tokens",
    description: "Lists token metadata without exposing a secret or token hash.",
    tags: ["Auth"],
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "read" }, concurrency: "none" },
    responses: { 200: jsonResponse(tokenListResponse, "API token metadata"), ...tokenErrorResponses },
  },
  async (context) => {
    const auth = requireTokenAdmin(context);
    const rows = await context.env.DB
      .prepare(`
        SELECT token.*, person.name AS acting_person_name
        FROM api_tokens token
        LEFT JOIN people person ON person.id = token.acts_as_person_id
        WHERE token.org_id = ?
        ORDER BY token.created_at DESC, token.id DESC
      `)
      .bind(auth.orgId)
      .all<ApiTokenRow>();
    return context.json({ data: rows.results.map(summarizeToken) }, 200);
  },
);

const createApiToken = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/org/tokens",
    operationId: "createApiToken",
    summary: "Issue a scoped organization API token",
    description:
      "Issues a bearer secret once. Effective authority remains the intersection of these grants and the issuer's memberships.",
    tags: ["Auth"],
    request: { body: { content: { "application/json": { schema: tokenInput } } } },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 201: jsonResponse(tokenCreateResponse, "The token secret is shown once"), ...tokenErrorResponses },
  },
  async (context) => {
    const auth = requireTokenAdmin(context);
    const body = context.req.valid("json");
    const permissions = [...new Set(body.scopes.permissions)];
    if (permissions.length !== body.scopes.permissions.length) {
      throw ApiError.badRequest("scopes.permissions must not contain duplicates", "scopes.permissions");
    }
    await assertEventIdsBelongToOrg(context.env.DB, auth.orgId, body.scopes.event_ids);

    const now = Date.now();
    const secret = `mq_${mintToken()}`;
    const id = newUlid(now);
    const eventId = body.scopes.event_ids.length === 1 ? body.scopes.event_ids[0] : null;
    const scopes = JSON.stringify({
      permissions,
      event_ids: body.scopes.event_ids,
    });
    await context.env.DB.prepare(
      `INSERT INTO api_tokens
       (id, org_id, event_id, name, token_hash, prefix, scopes, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id,
      auth.orgId,
      eventId,
      body.name,
      await sha256Hex(secret),
      secret.slice(0, 7),
      scopes,
      auth.personId,
      now,
      now,
    ).run();

    const row = await context.env.DB.prepare("SELECT * FROM api_tokens WHERE id = ?").bind(id).first<ApiTokenRow>();
    if (!row) throw new Error("created_api_token_disappeared");
    // The name and the grants, never the secret or its hash: a credential in an
    // append-only log is a credential that cannot be un-leaked. `eventId` is the
    // scope, so the lens can name the conference by join rather than by a copy
    // of its name that a rename would falsify.
    await recordOrgActivity(context.env.DB, {
      orgId: auth.orgId,
      eventId,
      ...orgActor(auth),
      action: ORG_ACTIVITY_ACTIONS.tokenCreated,
      entityType: "api_token",
      entityId: id,
      after: { name: body.name, permissions },
      now,
      requestId: context.get("requestId") ?? null,
    });
    return context.json({ data: summarizeToken(row), secret }, 201);
  },
);

const revokeApiToken = defineApiRoute(
  {
    method: "delete",
    path: "/api/v1/org/tokens/{tokenId}",
    operationId: "revokeApiToken",
    summary: "Revoke an organization API token",
    description: "Revocation takes effect on the next bearer request and preserves the audit row.",
    tags: ["Auth"],
    request: { params: tokenParams },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 200: jsonResponse(z.object({ data: tokenSummary }), "Revoked token metadata"), ...tokenErrorResponses },
  },
  async (context) => {
    const auth = requireTokenAdmin(context);
    const { tokenId } = context.req.valid("param");
    const row = await context.env.DB
      .prepare("SELECT * FROM api_tokens WHERE id = ? AND org_id = ?")
      .bind(tokenId, auth.orgId)
      .first<ApiTokenRow>();
    if (!row) throw ApiError.notFound("API token not found");
    const now = Date.now();
    await context.env.DB.prepare(
      "UPDATE api_tokens SET revoked_at = COALESCE(revoked_at, ?), updated_at = ? WHERE id = ? AND org_id = ?",
    ).bind(now, now, tokenId, auth.orgId).run();
    const revoked = await context.env.DB.prepare("SELECT * FROM api_tokens WHERE id = ?").bind(tokenId).first<ApiTokenRow>();
    if (!revoked) throw new Error("revoked_api_token_disappeared");
    await recordOrgActivity(context.env.DB, {
      orgId: auth.orgId,
      eventId: row.event_id,
      ...orgActor(auth),
      action: ORG_ACTIVITY_ACTIONS.tokenRevoked,
      entityType: "api_token",
      entityId: tokenId,
      before: { name: row.name },
      now,
      requestId: context.get("requestId") ?? null,
    });
    return context.json({ data: summarizeToken(revoked) }, 200);
  },
);

export const apiRoutes = [listTokens, createApiToken, revokeApiToken];
