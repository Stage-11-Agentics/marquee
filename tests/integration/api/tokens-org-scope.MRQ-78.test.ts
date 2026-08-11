import { beforeEach, expect, test } from "vitest";
import { SELF } from "cloudflare:test";

import { createSession } from "../../../src/lib/auth/auth-sessions";
import {
  DEMO_EVENT_ID,
  DEMO_ORGANIZATION_ID,
  DEMO_ORGANIZER_PERSON_ID,
  DEMO_SPEAKER_PERSON_ID,
  demoFixtureRows,
} from "../../../src/lib/reset-demo/demo-fixture";
import { applyMigrations, env } from "../apply-migrations";

const ORIGIN = "https://marquee.stage11.dev";
const REVIEWER_ID = "per_demo_reviewer";
const TOKEN_NAME = "MRQ-78 scoped integration token";

interface TokenSummary {
  id: string;
  event_id: string | null;
  name: string;
  scopes: { permissions: string[]; event_ids: string[] };
  revoked_at: number | null;
}

interface TokenCreateResponse {
  data: TokenSummary;
  secret: string;
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  return SELF.fetch(`${ORIGIN}${path}`, { ...init, headers });
}

async function sessionCookie(personId: string): Promise<string> {
  const session = await createSession(env.DB, {
    personId,
    userAgent: "mrq-78-token-scope-test",
  });
  return `mq_session=${session.id}`;
}

async function tokenCount(): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM api_tokens").first<{ n: number }>();
  return Number(row?.n ?? 0);
}

async function assertRefused(
  response: Response,
  status: number,
  disclosures: readonly string[],
): Promise<void> {
  expect(response.status).toBe(status);
  const body = await response.text();
  for (const disclosure of disclosures) expect(body).not.toContain(disclosure);
}

beforeEach(async () => {
  await applyMigrations();
  const now = Date.now();
  for (const row of demoFixtureRows(now)) {
    await env.DB.prepare(row.statement).bind(...row.bindings).run();
  }
  await env.DB.prepare(
    "INSERT INTO people (id, org_id, email, name, is_demo, last_write_source, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 'marquee', ?, ?)",
  ).bind(REVIEWER_ID, DEMO_ORGANIZATION_ID, "reviewer@demo.marquee.example", "Demo Reviewer", now, now).run();
  await env.DB.prepare(
    "INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, 'reviewer', ?, ?)",
  ).bind("mem_demo_reviewer", DEMO_ORGANIZATION_ID, DEMO_EVENT_ID, REVIEWER_ID, now, now).run();
});

test("AC-242 · MRQ-78 · the demo organizer manages tokens while reviewer, speaker, and anonymous callers are refused", async () => {
  const organizerHeaders = { cookie: await sessionCookie(DEMO_ORGANIZER_PERSON_ID) };
  const reviewerHeaders = { cookie: await sessionCookie(REVIEWER_ID) };
  const speakerHeaders = { cookie: await sessionCookie(DEMO_SPEAKER_PERSON_ID) };

  const initiallyListed = await request("/api/v1/org/tokens", { headers: organizerHeaders });
  expect(initiallyListed.status).toBe(200);
  expect((await initiallyListed.json() as { data: TokenSummary[] }).data).toEqual([]);

  const issuedResponse = await request("/api/v1/org/tokens", {
    method: "POST",
    headers: { ...organizerHeaders, "content-type": "application/json" },
    body: JSON.stringify({
      name: TOKEN_NAME,
      scopes: { permissions: ["program:read"], event_ids: [DEMO_EVENT_ID] },
    }),
  });
  expect(issuedResponse.status).toBe(201);
  const issued = await issuedResponse.json() as TokenCreateResponse;
  expect(issued.data.name).toBe(TOKEN_NAME);
  expect(issued.data.scopes).toEqual({ permissions: ["program:read"], event_ids: [DEMO_EVENT_ID] });
  expect(issued.secret).toMatch(/^mq_/);
  expect(await tokenCount()).toBe(1);

  const disclosures = [issued.data.id, issued.data.name, issued.secret];
  const listRefusals = [
    ["reviewer", reviewerHeaders, 403],
    ["speaker", speakerHeaders, 403],
    ["anonymous", {}, 401],
  ] as const;
  for (const [, headers, status] of listRefusals) {
    await assertRefused(await request("/api/v1/org/tokens", { headers }), status, disclosures);
  }

  const countBeforeIssueRefusals = await tokenCount();
  const issueRefusals = [
    [reviewerHeaders, 403],
    [speakerHeaders, 403],
    [{}, 401],
  ] as const;
  for (const [headers, status] of issueRefusals) {
    await assertRefused(await request("/api/v1/org/tokens", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({
        name: "refused token must not be created",
        scopes: { permissions: ["program:read"], event_ids: [DEMO_EVENT_ID] },
      }),
    }), status, disclosures);
  }
  expect(await tokenCount()).toBe(countBeforeIssueRefusals);

  const bearerHeaders = { authorization: `Bearer ${issued.secret}` };
  const bearerAllowed = await request(`/api/v1/events/${DEMO_EVENT_ID}`, { headers: bearerHeaders });
  expect(bearerAllowed.status).toBe(200);
  expect(await bearerAllowed.text()).toContain(DEMO_EVENT_ID);

  const countBeforeRevokeRefusals = await tokenCount();
  const revokeRefusals = [
    [reviewerHeaders, 403],
    [speakerHeaders, 403],
    [{}, 401],
  ] as const;
  for (const [headers, status] of revokeRefusals) {
    await assertRefused(await request(`/api/v1/org/tokens/${encodeURIComponent(issued.data.id)}`, {
      method: "DELETE",
      headers,
    }), status, disclosures);
  }
  expect(await tokenCount()).toBe(countBeforeRevokeRefusals);

  const revokedResponse = await request(`/api/v1/org/tokens/${encodeURIComponent(issued.data.id)}`, {
    method: "DELETE",
    headers: organizerHeaders,
  });
  expect(revokedResponse.status).toBe(200);
  expect((await revokedResponse.json() as { data: TokenSummary }).data.revoked_at).not.toBeNull();

  const bearerRefused = await request(`/api/v1/events/${DEMO_EVENT_ID}`, { headers: bearerHeaders });
  expect(bearerRefused.status).toBe(401);
});
