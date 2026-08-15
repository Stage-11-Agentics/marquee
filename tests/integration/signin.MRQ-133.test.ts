/**
 * The door, end to end.
 *
 * Everything here is behaviour a curl of a single endpoint cannot see: whether
 * a request with no `event_id` finds a person at all, whether an unknown
 * address is answered identically to a known one, whether a second request
 * inside a minute quietly sends a second email, and what a browser is shown
 * when it opens a link sixteen minutes late.
 */
import { beforeEach, expect, test } from "vitest";

import { app } from "../../src/index";
import { createSession } from "../../src/lib/auth/auth-sessions";
import { mintMagicLink } from "../../src/lib/auth/magic-links";
import {
  DEMO_ORGANIZER_PERSON_ID,
  demoFixtureRows,
} from "../../src/lib/reset-demo/demo-fixture";
import { applyMigrations, env } from "./apply-migrations";

const ACKNOWLEDGEMENT = "If that address is registered, a sign-in link is on its way.";

const ORG = "org_real";
const OLDER_EVENT = "evt_real_older";
const NEWER_EVENT = "evt_real_newer";
const PERSON = "per_real_reviewer";
const ADDRESS = "returning@marquee.example";

beforeEach(async () => {
  await applyMigrations();
});

function eventRow(id: string, createdAt: number, demoMode: 0 | 1 = 0) {
  return env.DB.prepare(
    `INSERT INTO events
      (id, org_id, name, slug, tagline, starts_on, ends_on, timezone, venue, status, demo_mode, created_at, updated_at)
     VALUES (?, ?, ?, ?, '', '2026-10-19', '2026-10-21', 'America/New_York', 'Javits Center', 'live', ?, ?, ?)`,
  ).bind(id, ORG, id, id, demoMode, createdAt, createdAt);
}

/** A claimed, non-demo instance: two conferences, one returning reviewer. */
async function seedRealInstance(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, 'Real', 'real', 1, 1)").bind(ORG),
    eventRow(OLDER_EVENT, 100),
    eventRow(NEWER_EVENT, 300),
    env.DB.prepare(
      `INSERT INTO people (id, org_id, email, name, is_demo, last_write_source, created_at, updated_at)
       VALUES (?, ?, ?, 'Returning Reviewer', 0, 'marquee', 1, 1)`,
    ).bind(PERSON, ORG, ADDRESS),
    env.DB.prepare(
      `INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at)
       VALUES ('mem_real_reviewer', ?, ?, ?, 'reviewer', 200, 200)`,
    ).bind(ORG, OLDER_EVENT, PERSON),
  ]);
}

async function seedDemoFixture(): Promise<void> {
  const now = Date.now();
  for (const row of demoFixtureRows(now)) {
    await env.DB.prepare(row.statement).bind(...row.bindings).run();
  }
}

async function requestLink(body: Record<string, unknown>): Promise<Response> {
  return app.request("/api/v1/auth/magic-link", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  }, env);
}

async function outboxRows(): Promise<{ event_id: string; to_email: string }[]> {
  const result = await env.DB
    .prepare("SELECT event_id, to_email FROM outbox")
    .all<{ event_id: string; to_email: string }>();
  return result.results;
}

async function loginLinks(): Promise<{ redirect_to: string }[]> {
  const result = await env.DB
    .prepare("SELECT redirect_to FROM magic_links WHERE purpose = 'login'")
    .all<{ redirect_to: string }>();
  return result.results;
}

test("CONTRACT · MRQ-133 · a request with no event_id resolves the person and enqueues exactly one mail", async () => {
  await seedRealInstance();
  const response = await requestLink({ email: ADDRESS });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true, message: ACKNOWLEDGEMENT });

  const rows = await outboxRows();
  expect(rows).toHaveLength(1);
  expect(rows[0].to_email).toBe(ADDRESS);
  // Attribution: the person's membership event, not the org's newest.
  expect(rows[0].event_id).toBe(OLDER_EVENT);
  // The redirect resolves the seat at mint time — a reviewer goes to the queue.
  expect(await loginLinks()).toEqual([{ redirect_to: "/reviewer" }]);
});

test("CONTRACT · MRQ-133 · a person with no event membership is filed against the org's newest event", async () => {
  await seedRealInstance();
  await env.DB.prepare("DELETE FROM memberships WHERE person_id = ?").bind(PERSON).run();
  await requestLink({ email: ADDRESS });
  const rows = await outboxRows();
  expect(rows).toHaveLength(1);
  expect(rows[0].event_id).toBe(NEWER_EVENT);
  // No membership at all is a speaker as far as the door is concerned.
  expect(await loginLinks()).toEqual([{ redirect_to: "/portal" }]);
});

test("CONTRACT · MRQ-133 · an unknown address gets the identical body and enqueues nothing", async () => {
  await seedRealInstance();
  const known = await requestLink({ email: ADDRESS });
  const knownBody = await known.text();
  await env.DB.prepare("DELETE FROM outbox").run();

  const unknown = await requestLink({ email: "nobody@marquee.example" });
  expect(unknown.status).toBe(known.status);
  expect(await unknown.text()).toBe(knownBody);
  expect(await outboxRows()).toHaveLength(0);
});

test("CONTRACT · MRQ-133 · an org with no event at all mints nothing and still says the same sentence", async () => {
  await env.DB.batch([
    env.DB.prepare("INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, 'Bare', 'bare', 1, 1)").bind(ORG),
    env.DB.prepare(
      `INSERT INTO people (id, org_id, email, name, is_demo, last_write_source, created_at, updated_at)
       VALUES (?, ?, ?, 'Owner', 0, 'marquee', 1, 1)`,
    ).bind(PERSON, ORG, ADDRESS),
  ]);
  const response = await requestLink({ email: ADDRESS });
  expect(await response.json()).toEqual({ ok: true, message: ACKNOWLEDGEMENT });
  expect(await outboxRows()).toHaveLength(0);
  expect(await loginLinks()).toHaveLength(0);
});

test("CONTRACT · MRQ-133 · demo mode returns the link on screen", async () => {
  await seedDemoFixture();
  const response = await requestLink({ email: "organizer@demo.marquee.example" });
  const body = await response.json<{ message: string; magic_link?: string }>();
  expect(body.message).toBe(ACKNOWLEDGEMENT);
  expect(body.magic_link).toMatch(/\/api\/v1\/auth\/exchange\?token=/);
});

/**
 * The takeover this door would otherwise open.
 *
 * A claim-created owner is a `people` row inside the SAME organization as the
 * demo event — `resolveOrganization` reuses the oldest org — and holds an
 * org-wide membership with a null event, so the attribution fallback resolves
 * them to the demo event. Keying the on-screen link on the event alone would
 * hand a real owner's fifteen-minute sign-in link to anyone who knows their
 * address, from the public form this ticket builds.
 */
test("CONTRACT · MRQ-133 · a real person in the demo org never gets a link on screen", async () => {
  await seedDemoFixture();
  const demoOrgId = await env.DB
    .prepare("SELECT org_id FROM events WHERE demo_mode = 1 LIMIT 1")
    .first<{ org_id: string }>();
  await env.DB.prepare(
    `INSERT INTO people (id, org_id, email, name, is_demo, last_write_source, created_at, updated_at)
     VALUES ('per_real_owner', ?, 'owner@real.example', 'Real Owner', 0, 'marquee', 1, 1)`,
  ).bind(demoOrgId?.org_id).run();
  await env.DB.prepare(
    `INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at)
     VALUES ('mem_real_owner', ?, NULL, 'per_real_owner', 'owner', 1, 1)`,
  ).bind(demoOrgId?.org_id).run();

  const response = await requestLink({ email: "owner@real.example" });
  const body = await response.json<{ message: string; magic_link?: string }>();
  expect(body.message).toBe(ACKNOWLEDGEMENT);
  expect(body.magic_link).toBeUndefined();
  // The mail is still enqueued — the owner gets their link by email, as designed.
  expect(await outboxRows()).toHaveLength(1);
});

test("CONTRACT · MRQ-133 · a demo persona is exempt from the cooldown, because the screen is its only channel", async () => {
  await seedDemoFixture();
  const first = await requestLink({ email: "organizer@demo.marquee.example" });
  const second = await requestLink({ email: "organizer@demo.marquee.example" });
  expect((await first.json<{ magic_link?: string }>()).magic_link).toBeDefined();
  expect((await second.json<{ magic_link?: string }>()).magic_link).toBeDefined();
});

test("CONTRACT · MRQ-133 · a second request inside the cooldown does not send a second mail", async () => {
  await seedRealInstance();
  await requestLink({ email: ADDRESS });
  const second = await requestLink({ email: ADDRESS });
  expect(await second.json()).toEqual({ ok: true, message: ACKNOWLEDGEMENT });
  expect(await outboxRows()).toHaveLength(1);
  expect(await loginLinks()).toHaveLength(1);
});

test("CONTRACT · MRQ-133 · a hostile ?next= never becomes the redirect", async () => {
  await seedRealInstance();
  await requestLink({ email: ADDRESS, redirect_to: "//evil.example/steal" });
  expect(await loginLinks()).toEqual([{ redirect_to: "/reviewer" }]);
});

test("CONTRACT · MRQ-133 · a browser opening a spent link lands on the door, not on JSON", async () => {
  const response = await app.request("/api/v1/auth/exchange?token=long-since-spent", {
    headers: {
      accept: "text/html,application/xhtml+xml",
      cookie: "mq_session=dead",
    },
  }, env);
  expect(response.status).toBe(302);
  expect(response.headers.get("location")).toBe("/signin?reason=expired");
  // The dead cookie is HttpOnly, so this response is the only chance to drop it.
  expect(response.headers.get("set-cookie")).toMatch(/mq_session=/);
});

test("CONTRACT · MRQ-133 · an API client opening a spent link still gets the 401 envelope", async () => {
  const response = await app.request("/api/v1/auth/exchange?token=long-since-spent", {
    headers: { accept: "application/json" },
  }, env);
  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({
    error: {
      code: "magic_link_invalid",
      message: "This sign-in link has expired or was already used",
    },
  });
});

test("CONTRACT · MRQ-133 · a link minted through the door exchanges into a session", async () => {
  await seedRealInstance();
  const minted = await mintMagicLink(env.DB, {
    personId: PERSON,
    purpose: "login",
    redirectTo: "/reviewer",
  });
  const response = await app.request(`/api/v1/auth/exchange?token=${minted.token}`, {
    headers: { accept: "text/html" },
  }, env);
  expect(response.status).toBe(302);
  expect(response.headers.get("location")).toBe("/reviewer");
  expect(response.headers.get("set-cookie")).toMatch(/mq_session=/);
});

async function signinPage(init: RequestInit = {}, overrides: Record<string, unknown> = {}): Promise<string> {
  const response = await app.request("/signin", init, { ...env, ...overrides });
  expect(response.status).toBe(200);
  return response.text();
}

test("CONTRACT · MRQ-133 · the anonymous page offers the form, and says so honestly when mail is unconfigured", async () => {
  const unconfigured = await signinPage();
  expect(unconfigured).toContain('id="signin-form"');
  expect(unconfigured).toContain("This deployment cannot send mail yet.");
  expect(unconfigured).toContain("npx wrangler secret put RESEND_API_KEY");

  const configured = await signinPage({}, { RESEND_API_KEY: "re_live_example" });
  expect(configured).toContain('id="signin-form"');
  expect(configured).not.toContain("This deployment cannot send mail yet.");
});

test("CONTRACT · MRQ-133 · a demo instance additionally opens its three doors", async () => {
  await seedDemoFixture();
  const page = await signinPage();
  expect(page).toContain('data-signin-demo="organizer"');
  expect(page).toContain('data-signin-demo="reviewer"');
  expect(page).toContain('data-signin-demo="speaker"');
});

test("CONTRACT · MRQ-133 · a signed-in visitor is not shown a login form", async () => {
  await seedDemoFixture();
  const session = await createSession(env.DB, {
    personId: DEMO_ORGANIZER_PERSON_ID,
    userAgent: "test",
  });
  const page = await signinPage({ headers: { cookie: `mq_session=${session.id}` } });
  expect(page).not.toContain('id="signin-form"');
  expect(page).toContain("Demo Organizer");
  expect(page).toContain("organizer@demo.marquee.example");
  // An org-wide owner continues into the organizer shell at its organization
  // home — the same destination the magic-link exchange and the landing's demo
  // door use, because all three read `ROLE_HOME`.
  expect(page).toContain('href="/org/home"');
});

test("CONTRACT · MRQ-133 · the reason banner states why the visitor is here", async () => {
  const response = await app.request("/signin?reason=expired", {}, env);
  expect(await response.text()).toContain("Link expired");
});

test("CONTRACT · MRQ-133 · /login and /sign-in are the same page", async () => {
  for (const path of ["/login", "/sign-in"]) {
    const response = await app.request(path, {}, env);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('id="signin-form"');
  }
});
