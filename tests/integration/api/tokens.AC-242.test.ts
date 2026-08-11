import { beforeEach, expect, test } from "vitest";
import { SELF } from "cloudflare:test";

import { createSession } from "../../../src/lib/auth/auth-sessions";
import { mintToken, sha256Hex } from "../../../src/lib/auth/random-token";
import { applyMigrations, env } from "../apply-migrations";

const ORIGIN = "https://marquee.example";
const ORG_ID = "org_tokens";
const EVENT_A = "evt_tokens_a";
const EVENT_B = "evt_tokens_b";
const OWNER_ID = "per_tokens_owner";
const REVIEWER_ID = "per_tokens_reviewer";

interface TokenResponse {
  data: {
    id: string;
    event_id: string | null;
    name: string;
    scopes: { permissions: string[]; event_ids: string[] };
    revoked_at: number | null;
  };
  secret: string;
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  return SELF.fetch(`${ORIGIN}${path}`, init);
}

async function ownerCookie(): Promise<string> {
  const session = await createSession(env.DB, {
    personId: OWNER_ID,
    userAgent: "mrq-30-token-test",
  });
  return `mq_session=${session.id}`;
}

async function issueToken(
  scopes: { permissions: string[]; event_ids: string[] },
  name = "Test integration token",
): Promise<{ id: string; secret: string }> {
  const response = await request("/api/v1/org/tokens", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: await ownerCookie(),
    },
    body: JSON.stringify({ name, scopes }),
  });
  expect(response.status).toBe(201);
  const body = await response.json() as TokenResponse;
  return { id: body.data.id, secret: body.secret };
}

async function insertBearerToken(options: {
  id: string;
  createdBy: string;
  permissions: string[];
  eventIds: string[];
  secret?: string;
}): Promise<string> {
  const secret = options.secret ?? `mq_${mintToken()}`;
  const now = Date.now();
  const eventId = options.eventIds.length === 1 ? options.eventIds[0] : null;
  await env.DB.prepare(
    `INSERT INTO api_tokens
     (id, org_id, event_id, name, token_hash, prefix, scopes, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    options.id,
    ORG_ID,
    eventId,
    options.id,
    await sha256Hex(secret),
    secret.slice(0, 7),
    JSON.stringify({ permissions: options.permissions, event_ids: options.eventIds }),
    options.createdBy,
    now,
    now,
  ).run();
  return secret;
}

async function eventSnapshot(eventId: string): Promise<Record<string, unknown>> {
  const row = await env.DB.prepare("SELECT * FROM events WHERE id = ?").bind(eventId).first<Record<string, unknown>>();
  if (!row) throw new Error(`missing event ${eventId}`);
  return row;
}

beforeEach(async () => {
  await applyMigrations();
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
  ).bind(ORG_ID, "Token Test Organization", "token-test", now, now).run();
  for (const [id, slug, name] of [
    [EVENT_A, "token-conference-a", "Conference A"],
    [EVENT_B, "token-conference-b", "Conference B"],
  ]) {
    await env.DB.prepare(
      `INSERT INTO events
       (id, org_id, name, slug, tagline, starts_on, ends_on, timezone, venue, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, '', '2026-10-01', '2026-10-02', 'UTC', '', 'live', ?, ?)`,
    ).bind(id, ORG_ID, name, slug, now, now).run();
  }
  for (const [id, email, name] of [
    [OWNER_ID, "owner@tokens.example", "Token Owner"],
    [REVIEWER_ID, "reviewer@tokens.example", "Token Reviewer"],
  ]) {
    await env.DB.prepare(
      "INSERT INTO people (id, org_id, email, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).bind(id, ORG_ID, email, name, now, now).run();
  }
  await env.DB.prepare(
    `INSERT INTO memberships
     (id, org_id, event_id, person_id, role, created_at, updated_at)
     VALUES ('mem_tokens_owner', ?, NULL, ?, 'owner', ?, ?),
            ('mem_tokens_reviewer', ?, ?, ?, 'reviewer', ?, ?)`,
  ).bind(ORG_ID, OWNER_ID, now, now, ORG_ID, EVENT_A, REVIEWER_ID, now, now).run();
});

test("AC-242 · grant intersection refuses a reviewer token carrying program:write before any event write", async () => {
  const reviewerSecret = await insertBearerToken({
    id: "tok_reviewer_write",
    createdBy: REVIEWER_ID,
    permissions: ["program:write"],
    eventIds: [EVENT_A],
  });
  const before = await eventSnapshot(EVENT_A);

  const refused = await request(`/api/v1/events/${EVENT_A}`, {
    method: "PATCH",
    headers: {
      authorization: `Bearer ${reviewerSecret}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ name: "Should not persist" }),
  });
  expect(refused.status).toBe(403);
  expect(await eventSnapshot(EVENT_A)).toEqual(before);

  const ownerSecret = await insertBearerToken({
    id: "tok_owner_write",
    createdBy: OWNER_ID,
    permissions: ["program:write"],
    eventIds: [EVENT_A],
  });
  const allowed = await request(`/api/v1/events/${EVENT_A}`, {
    method: "PATCH",
    headers: {
      authorization: `Bearer ${ownerSecret}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ name: "Owner change" }),
  });
  expect(allowed.status).toBe(200);
  expect((await eventSnapshot(EVENT_A)).name).toBe("Owner change");
});

test("AC-242 · secret is returned once, never stored in the token row, and authenticates without a cookie", async () => {
  const issued = await issueToken({ permissions: ["program:read"], event_ids: [EVENT_A] });
  expect(issued.secret).toMatch(/^mq_[A-Za-z0-9_-]{32}$/);

  const rows = await env.DB.prepare("SELECT * FROM api_tokens").all<Record<string, unknown>>();
  expect(JSON.stringify(rows.results)).not.toContain(issued.secret);

  const listed = await request("/api/v1/org/tokens", { headers: { cookie: await ownerCookie() } });
  expect(listed.status).toBe(200);
  const listedBody = await listed.text();
  expect(listedBody).not.toContain(issued.secret);
  expect(listedBody).not.toContain("token_hash");

  const authenticated = await request("/api/v1/auth/me", {
    headers: { authorization: `Bearer ${issued.secret}` },
  });
  expect(authenticated.status).toBe(200);
  expect((await authenticated.json() as { kind: string }).kind).toBe("api_token");
});

test("AC-242 · revocation rejects the very next bearer write while retaining the audit row and target state", async () => {
  const issued = await issueToken({ permissions: ["program:write"], event_ids: [EVENT_A] });
  const beforeRevoke = await request(`/api/v1/events/${EVENT_A}`, {
    method: "PATCH",
    headers: {
      authorization: `Bearer ${issued.secret}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ name: "Before revoke" }),
  });
  expect(beforeRevoke.status).toBe(200);

  const revoked = await request(`/api/v1/org/tokens/${issued.id}`, {
    method: "DELETE",
    headers: { cookie: await ownerCookie() },
  });
  expect(revoked.status).toBe(200);
  expect((await revoked.json() as { data: { revoked_at: number | null } }).data.revoked_at).not.toBeNull();

  const afterRevoke = await request(`/api/v1/events/${EVENT_A}`, {
    method: "PATCH",
    headers: {
      authorization: `Bearer ${issued.secret}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ name: "Must not persist" }),
  });
  expect(afterRevoke.status).toBe(401);
  expect((await eventSnapshot(EVENT_A)).name).toBe("Before revoke");
  const retained = await env.DB.prepare("SELECT revoked_at FROM api_tokens WHERE id = ?").bind(issued.id).first<{ revoked_at: number | null }>();
  expect(retained?.revoked_at).not.toBeNull();
});

test("AC-242 · a conference-restricted token succeeds on A but exposes neither B access nor B data", async () => {
  const issued = await issueToken({ permissions: ["program:read"], event_ids: [EVENT_A] });

  const sameConference = await request(`/api/v1/events/${EVENT_A}`, {
    headers: { authorization: `Bearer ${issued.secret}` },
  });
  expect(sameConference.status).toBe(200);
  const sameBody = await sameConference.text();
  expect(sameBody).toContain(EVENT_A);
  expect(sameBody).toContain("Conference A");

  const otherConference = await request(`/api/v1/events/${EVENT_B}`, {
    headers: { authorization: `Bearer ${issued.secret}` },
  });
  expect(otherConference.status).toBe(403);
  const otherBody = await otherConference.text();
  expect(otherBody).not.toContain(EVENT_B);
  expect(otherBody).not.toContain("Conference B");
});
