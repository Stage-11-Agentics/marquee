import { beforeEach, expect, test } from "vitest";
import { z } from "@hono/zod-openapi";

import { defineApiRoute, errorResponses, jsonResponse } from "../../../src/api/route";
import { createApiRouter } from "../../../src/api/router";
import { createCredentialResolver } from "../../../src/lib/auth/credential-resolver";
import { createSession, SESSION_TTL_MS } from "../../../src/lib/auth/auth-sessions";
import { mintToken, sha256Hex } from "../../../src/lib/auth/random-token";
import { applyMigrations, env } from "../apply-migrations";

const ORIGIN = "https://marquee.stage11.dev";
const EVENT_A = "evt_a";
const EVENT_B = "evt_b";
const PRIVATE_SUBMISSION_ID = "sub_private";

const submissionResponse = z.object({
  data: z.array(z.object({ id: z.string(), title: z.string() })),
});

let handlerCalls = 0;

const protectedSubmissionsRoute = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/events/{eventId}/submissions",
    operationId: "credentialResolverSubmissionFixture",
    summary: "Protected submission fixture",
    policy: {
      auth: { kind: "grants", grants: ["program:read"] },
      rateLimit: { bucket: "read" },
      concurrency: "none",
    },
    request: { params: z.object({ eventId: z.string().min(1) }) },
    responses: {
      200: jsonResponse(submissionResponse, "fixture submissions"),
      ...errorResponses([401, 403, 429, 500]),
    },
  },
  (context) => {
    handlerCalls += 1;
    return context.json(
      { data: [{ id: PRIVATE_SUBMISSION_ID, title: "Unpublished private submission" }] },
      200,
    );
  },
);

beforeEach(async () => {
  await applyMigrations();
  handlerCalls = 0;
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind("org_1", "Org One", "org-one", now, now)
    .run();
  for (const [id, slug] of [[EVENT_A, "event-a"], [EVENT_B, "event-b"]]) {
    await env.DB.prepare(
      `INSERT INTO events
       (id, org_id, name, slug, tagline, starts_on, ends_on, timezone, venue, status, created_at, updated_at)
       VALUES (?, 'org_1', ?, ?, '', '2026-10-01', '2026-10-02', 'UTC', '', 'live', ?, ?)`,
    )
      .bind(id, slug, slug, now, now)
      .run();
  }
  await env.DB.prepare(
    "INSERT INTO people (id, org_id, email, name, created_at, updated_at) VALUES (?, 'org_1', ?, ?, ?, ?)",
  )
    .bind("per_owner", "owner@org-one.example", "Owner", now, now)
    .run();
  await env.DB.prepare(
    "INSERT INTO people (id, org_id, email, name, created_at, updated_at) VALUES (?, 'org_1', ?, ?, ?, ?)",
  )
    .bind("per_reviewer", "reviewer@org-one.example", "Reviewer", now, now)
    .run();
  await env.DB.prepare(
    `INSERT INTO memberships
     (id, org_id, event_id, person_id, role, created_at, updated_at)
     VALUES ('mem_owner', 'org_1', NULL, 'per_owner', 'owner', ?, ?),
            ('mem_reviewer', 'org_1', ?, 'per_reviewer', 'reviewer', ?, ?)`,
  )
    .bind(now, now, EVENT_A, now, now)
    .run();
});

async function makeRouter() {
  return createApiRouter([protectedSubmissionsRoute], {
    credentialResolver: createCredentialResolver(),
  });
}

async function request(
  router: Awaited<ReturnType<typeof makeRouter>>,
  eventId: string,
  headers?: HeadersInit,
): Promise<Response> {
  return router.app.request(
    `${ORIGIN}/api/v1/events/${eventId}/submissions`,
    { headers },
    env,
  );
}

async function expectNoSubmissionLeak(response: Response): Promise<string> {
  const body = await response.text();
  expect(body).not.toContain(PRIVATE_SUBMISSION_ID);
  expect(body).not.toContain("Unpublished private submission");
  return body;
}

test("CONTRACT · unauthenticated submissions reads fail closed without invoking the handler or leaking data", async () => {
  const router = await makeRouter();
  const response = await request(router, EVENT_A);

  expect(response.status).toBe(401);
  const body = await expectNoSubmissionLeak(response);
  expect(JSON.parse(body).error.code).toBe("unauthenticated");
  expect(handlerCalls).toBe(0);
});

test("CONTRACT · a session cookie authenticates the event-scoped admin read", async () => {
  const session = await createSession(env.DB, {
    personId: "per_owner",
    userAgent: "mrq-60-test",
  });
  const router = await makeRouter();
  const response = await request(router, EVENT_A, { cookie: `mq_session=${session.id}` });

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    data: [{ id: PRIVATE_SUBMISSION_ID, title: "Unpublished private submission" }],
  });
  expect(handlerCalls).toBe(1);
});

test("AC-107 · bearer auth works without a cookie and is event-restricted", async () => {
  const rawToken = `mq_${mintToken()}`;
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO api_tokens
     (id, org_id, event_id, name, token_hash, prefix, scopes, created_by, created_at, updated_at)
     VALUES ('tok_1', 'org_1', NULL, 'Test token', ?, ?, ?, 'per_owner', ?, ?)`,
  )
    .bind(
      await sha256Hex(rawToken),
      rawToken.slice(0, 7),
      JSON.stringify({ permissions: ["program:read"], event_ids: [EVENT_A] }),
      now,
      now,
    )
    .run();
  const router = await makeRouter();

  const sameEvent = await request(router, EVENT_A, {
    authorization: `Bearer ${rawToken}`,
  });
  expect(sameEvent.status).toBe(200);
  expect(handlerCalls).toBe(1);

  const differentEvent = await request(router, EVENT_B, {
    authorization: `Bearer ${rawToken}`,
  });
  expect(differentEvent.status).toBe(403);
  const body = await expectNoSubmissionLeak(differentEvent);
  expect(JSON.parse(body).error.code).toBe("forbidden");
  expect(handlerCalls).toBe(1);
});

test("CONTRACT · an event-A reviewer cannot read event-B submissions", async () => {
  const session = await createSession(env.DB, {
    personId: "per_reviewer",
    userAgent: "mrq-60-reviewer-test",
  });
  const router = await makeRouter();
  const response = await request(router, EVENT_B, { cookie: `mq_session=${session.id}` });

  expect(response.status).toBe(403);
  const body = await expectNoSubmissionLeak(response);
  expect(JSON.parse(body).error.code).toBe("forbidden");
  expect(handlerCalls).toBe(0);
});

test("CONTRACT · expired and tampered session cookies are rejected", async () => {
  const expired = await createSession(env.DB, {
    personId: "per_owner",
    userAgent: "mrq-60-expired-test",
    now: Date.now() - SESSION_TTL_MS - 1,
  });
  const router = await makeRouter();

  for (const sessionId of [expired.id, "tampered-session-id"]) {
    const response = await request(router, EVENT_A, { cookie: `mq_session=${sessionId}` });
    expect(response.status).toBe(401);
    const body = await expectNoSubmissionLeak(response);
    expect(JSON.parse(body).error.code).toBe("unauthenticated");
  }
  expect(handlerCalls).toBe(0);
});
