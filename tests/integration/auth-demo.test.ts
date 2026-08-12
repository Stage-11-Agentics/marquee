import { beforeEach, expect, test } from "vitest";

import { app } from "../../src/index";
import { createSession, SESSION_TTL_MS } from "../../src/lib/auth/auth-sessions";
import { consumeMagicLink, mintMagicLink } from "../../src/lib/auth/magic-links";
import {
  DEMO_EVENT_ID,
  DEMO_ORGANIZATION_ID,
  DEMO_ORGANIZER_PERSON_ID,
  DEMO_SPEAKER_PERSON_ID,
  demoFixtureRows,
} from "../../src/lib/reset-demo/demo-fixture";
import { applyMigrations, env } from "./apply-migrations";

beforeEach(async () => {
  await applyMigrations();
});

async function authSessionCount(): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM auth_sessions").first<{ n: number }>();
  return Number(row?.n ?? 0);
}

async function seedDemoFixture(): Promise<void> {
  const now = Date.now();
  for (const row of demoFixtureRows(now)) {
    await env.DB.prepare(row.statement).bind(...row.bindings).run();
  }
}

test("AC-2 · POST /api/v1/auth/demo 403s and sets no session cookie when demo_mode=0", async () => {
  const before = await authSessionCount();
  const response = await app.request("/api/v1/auth/demo", {
    method: "POST",
    body: JSON.stringify({ role: "organizer" }),
    headers: { "content-type": "application/json" },
  }, env);
  expect(response.status).toBe(403);
  expect((await response.json<{ error: { code: string } }>()).error.code).toBe("demo_disabled");
  expect(response.headers.get("set-cookie")).toBeNull();
  expect(await authSessionCount()).toBe(before);
});

test("AC-2 · POST /api/v1/auth/demo 200s and sets a session cookie when demo_mode=1", async () => {
  await seedDemoFixture();
  const before = await authSessionCount();
  const response = await app.request("/api/v1/auth/demo", {
    method: "POST",
    body: JSON.stringify({ role: "organizer" }),
    headers: { "content-type": "application/json" },
  }, env);
  expect(response.status).toBe(200);
  const setCookie = response.headers.get("set-cookie");
  expect(setCookie).toMatch(/mq_session=/);
  const body = await response.json<{ person: { id: string } }>();
  expect(body.person.id).toBe(DEMO_ORGANIZER_PERSON_ID);
  expect(await authSessionCount()).toBe(before + 1);
});

test("CONTRACT · demo session cookie has the complete narrow security policy", async () => {
  await seedDemoFixture();
  const response = await app.request("https://marquee.example/api/v1/auth/demo", {
    method: "POST",
    body: JSON.stringify({ role: "speaker" }),
    headers: { "content-type": "application/json" },
  }, env);
  const setCookie = response.headers.get("set-cookie") ?? "";
  expect(setCookie).toMatch(/HttpOnly/i);
  expect(setCookie).toMatch(/Secure/i);
  expect(setCookie).toMatch(/SameSite=Lax/i);
  expect(setCookie).toMatch(/Path=\//i);
  expect(setCookie).not.toMatch(/Domain=/i);
});

// Safari and WKWebView refuse a Secure cookie on an http:// origin, so the
// plain-HTTP local recipe needs this opt-out or the UI 401s after a 200 login.
// The flag ships only in .dev.vars.example, never in a deployed Worker.
test("CONTRACT · INSECURE_LOCAL_COOKIES=1 omits Secure so the local HTTP recipe keeps its session", async () => {
  await seedDemoFixture();
  const response = await app.request("https://marquee.example/api/v1/auth/demo", {
    method: "POST",
    body: JSON.stringify({ role: "speaker" }),
    headers: { "content-type": "application/json" },
  }, { ...env, INSECURE_LOCAL_COOKIES: "1" });
  const setCookie = response.headers.get("set-cookie") ?? "";
  expect(setCookie).toMatch(/mq_session=/);
  expect(setCookie).toMatch(/HttpOnly/i);
  expect(setCookie).toMatch(/SameSite=Lax/i);
  expect(setCookie).not.toMatch(/Secure/i);
});

// Exactly "1" opts out; every other value keeps Secure. Written as one test over
// the table rather than `test.each`, because the AC tracer reads the first
// argument of any `test(...)` call as a title and `test.each([...])` puts the
// table there — a static-analysis limitation, not a reason to weaken the check.
test("CONTRACT · session cookie stays Secure for every INSECURE_LOCAL_COOKIES value but 1", async () => {
  await seedDemoFixture();
  for (const flag of [undefined, "0", "true", ""]) {
    const response = await app.request("https://marquee.example/api/v1/auth/demo", {
      method: "POST",
      body: JSON.stringify({ role: "speaker" }),
      headers: { "content-type": "application/json" },
    }, { ...env, INSECURE_LOCAL_COOKIES: flag });
    expect(response.headers.get("set-cookie") ?? "", `flag=${String(flag)}`).toMatch(/Secure/i);
  }
});

test("CONTRACT · magic-link request enqueues an outbox row and returns the on-screen link only in demo mode", async () => {
  await seedDemoFixture();
  const before = await authSessionCount();
  const response = await app.request("/api/v1/auth/magic-link", {
    method: "POST",
    body: JSON.stringify({
      email: "organizer@demo.marquee.example",
      event_id: DEMO_EVENT_ID,
    }),
    headers: { "content-type": "application/json" },
  }, env);
  expect(response.status).toBe(200);
  const body = await response.json<{ magic_link?: string }>();
  expect(body.magic_link).toContain("/api/v1/auth/exchange?token=");

  const outboxRow = await env.DB.prepare(
    "SELECT * FROM outbox WHERE person_id = ? AND template_key = 'magic_link_login'",
  )
    .bind(DEMO_ORGANIZER_PERSON_ID)
    .first<{ status: string }>();
  expect(outboxRow).not.toBeNull();
  expect(outboxRow?.status).toBe("queued");
  expect(await authSessionCount()).toBe(before);
});

test("CONTRACT · magic link is single-use and rejects a second exchange", async () => {
  await seedDemoFixture();
  const link = await mintMagicLink(env.DB, { personId: DEMO_ORGANIZER_PERSON_ID, purpose: "login" });
  const first = await consumeMagicLink(env.DB, link.token);
  expect(first).not.toBeNull();
  const second = await consumeMagicLink(env.DB, link.token);
  expect(second).toBeNull();
});

test("CONTRACT · magic link is rejected once past its expiry", async () => {
  await seedDemoFixture();
  const now = Date.now();
  const link = await mintMagicLink(env.DB, { personId: DEMO_ORGANIZER_PERSON_ID, purpose: "login", now });
  const expired = await consumeMagicLink(env.DB, link.token, now + 16 * 60_000);
  expect(expired).toBeNull();
});

test("CONTRACT · exchange mints one session and rejects replayed or expired links without another row", async () => {
  await seedDemoFixture();
  const now = Date.now();
  const link = await mintMagicLink(env.DB, {
    personId: DEMO_ORGANIZER_PERSON_ID,
    purpose: "login",
    now,
  });
  const before = await authSessionCount();

  const first = await app.request(
    `/api/v1/auth/exchange?token=${encodeURIComponent(link.token)}`,
    { redirect: "manual" },
    env,
  );
  expect(first.status).toBe(302);
  expect(first.headers.get("set-cookie")).toMatch(/mq_session=/);
  expect(await authSessionCount()).toBe(before + 1);

  const replay = await app.request(
    `/api/v1/auth/exchange?token=${encodeURIComponent(link.token)}`,
    { redirect: "manual" },
    env,
  );
  expect(replay.status).toBe(401);
  expect((await replay.json<{ error: { code: string } }>()).error.code).toBe("magic_link_invalid");
  expect(replay.headers.get("set-cookie")).toBeNull();
  expect(await authSessionCount()).toBe(before + 1);

  const expiredLink = await mintMagicLink(env.DB, {
    personId: DEMO_ORGANIZER_PERSON_ID,
    purpose: "login",
    now: now - 16 * 60_000,
  });
  const expired = await app.request(
    `/api/v1/auth/exchange?token=${encodeURIComponent(expiredLink.token)}`,
    { redirect: "manual" },
    env,
  );
  expect(expired.status).toBe(401);
  expect((await expired.json<{ error: { code: string } }>()).error.code).toBe("magic_link_invalid");
  expect(expired.headers.get("set-cookie")).toBeNull();
  expect(await authSessionCount()).toBe(before + 1);
});

test("CONTRACT · demo login rejects a role with no matching demo persona", async () => {
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(DEMO_ORGANIZATION_ID, "Marquee Demo", "marquee-demo", now, now)
    .run();
  await env.DB.prepare(
    `INSERT INTO events (id, org_id, name, slug, tagline, starts_on, ends_on, timezone, venue, status, demo_mode, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'live', 1, ?, ?)`,
  )
    .bind(
      DEMO_EVENT_ID,
      DEMO_ORGANIZATION_ID,
      "AIE NYC 2026",
      "aie-nyc-2026",
      "The demo conference",
      "2026-10-19",
      "2026-10-21",
      "America/New_York",
      "Javits Center",
      now,
      now,
    )
    .run();
  // No demo persona/membership rows exist for this event.
  const response = await app.request("/api/v1/auth/demo", {
    method: "POST",
    body: JSON.stringify({ role: "speaker" }),
    headers: { "content-type": "application/json" },
  }, env);
  expect(response.status).toBe(403);
  expect(response.headers.get("set-cookie")).toBeNull();
});

// --- Regression: a public route must never 401 on a bad credential ---------
//
// A browser holding a dead `mq_session` — one minted by another instance, or
// left behind by a demo reset — was rejected at credential resolution, before
// the route's `public` policy was ever consulted. Sign-in and sign-out both
// 401'd, and the cookie is HttpOnly, so the page had no way to clear it: the
// browser was locked out of the product with no escape but devtools.

const DEAD_SESSION_COOKIE = "mq_session=sess_from_a_reset_demo";

test("CONTRACT · demo login succeeds for a browser holding a dead session cookie", async () => {
  await seedDemoFixture();
  const before = await authSessionCount();
  const response = await app.request("/api/v1/auth/demo", {
    method: "POST",
    body: JSON.stringify({ role: "organizer" }),
    headers: { "content-type": "application/json", cookie: DEAD_SESSION_COOKIE },
  }, env);

  expect(response.status).toBe(200);
  // The dead cookie is not merely tolerated — it is replaced by a live one.
  expect(response.headers.get("set-cookie")).toMatch(/mq_session=[^;\s]+/);
  const body = await response.json<{ person: { id: string } }>();
  expect(body.person.id).toBe(DEMO_ORGANIZER_PERSON_ID);
  expect(await authSessionCount()).toBe(before + 1);
});

test("CONTRACT · an expired session cookie does not block demo login", async () => {
  await seedDemoFixture();
  const expired = await createSession(env.DB, {
    personId: DEMO_ORGANIZER_PERSON_ID,
    userAgent: "stale-session-regression",
    now: Date.now() - SESSION_TTL_MS - 1,
  });
  const response = await app.request("/api/v1/auth/demo", {
    method: "POST",
    body: JSON.stringify({ role: "organizer" }),
    headers: { "content-type": "application/json", cookie: `mq_session=${expired.id}` },
  }, env);

  expect(response.status).toBe(200);
});

test("CONTRACT · logout is reachable with a dead session cookie and clears it", async () => {
  // Logout is the escape hatch, and it is public — the same defect blocked the
  // one route that could have unblocked the browser.
  const response = await app.request("/api/v1/auth/logout", {
    method: "POST",
    headers: { cookie: DEAD_SESSION_COOKIE },
  }, env);

  expect(response.status).toBe(200);
  expect(response.headers.get("set-cookie")).toMatch(/mq_session=;/);
});

test("CONTRACT · a failed demo login drops the dead cookie so the browser recovers", async () => {
  // Demo mode is off here, so sign-in cannot replace the cookie itself. The
  // browser must still leave without a corpse in its jar.
  const response = await app.request("/api/v1/auth/demo", {
    method: "POST",
    body: JSON.stringify({ role: "organizer" }),
    headers: { "content-type": "application/json", cookie: DEAD_SESSION_COOKIE },
  }, env);

  expect(response.status).toBe(403);
  expect(response.headers.get("set-cookie")).toMatch(/mq_session=;/);
});

test("CONTRACT · degrading to anonymous is scoped to public routes only", async () => {
  // The security property the resolver's 401 exists for is unchanged: a route
  // that requires a principal still rejects a present-but-invalid credential.
  await seedDemoFixture();
  const response = await app.request("/api/v1/auth/me", {
    headers: { cookie: DEAD_SESSION_COOKIE },
  }, env);

  expect(response.status).toBe(401);
  expect((await response.json<{ error: { code: string } }>()).error.code).toBe("unauthenticated");
});

// KYS-2. The demo hands out an owner session and a speaker session from the
// same landing page onto the same cookie, and the admin shell showed neither a
// name nor a way out. Identity has to come from the server for the shell to
// render it, and sign-out has to actually end the session — a menu entry that
// leaves the cookie alive is worse than no menu entry.

async function demoSessionCookie(role: string): Promise<string> {
  const response = await app.request("/api/v1/auth/demo", {
    method: "POST",
    body: JSON.stringify({ role }),
    headers: { "content-type": "application/json" },
  }, env);
  expect(response.status).toBe(200);
  return (response.headers.get("set-cookie") ?? "").split(";")[0];
}

async function readMe(cookie: string) {
  const response = await app.request("/api/v1/auth/me", { headers: { cookie } }, env);
  return { status: response.status, body: await response.json<{
    person_id?: string;
    demo_event_name?: string | null;
    person_name?: string | null;
    person_email?: string | null;
    memberships?: { role: string }[];
  }>() };
}

test("CONTRACT · /auth/me names the person behind a session, not just their id", async () => {
  await seedDemoFixture();
  const { status, body } = await readMe(await demoSessionCookie("organizer"));

  expect(status).toBe(200);
  expect(body.person_id).toBe(DEMO_ORGANIZER_PERSON_ID);
  // An id is not an answer to "which hat am I wearing".
  expect(body.person_name).toBe("Demo Organizer");
  expect(body.person_email).toBe("organizer@demo.marquee.example");
  expect(body.demo_event_name).toBe("AIE NYC 2026");
  expect(body.memberships?.[0]?.role).toBe("owner");
});

test("CONTRACT · the two demo personas are distinguishable from /auth/me alone", async () => {
  await seedDemoFixture();
  const organizer = await readMe(await demoSessionCookie("organizer"));
  const speaker = await readMe(await demoSessionCookie("speaker"));

  expect(speaker.status).toBe(200);
  expect(speaker.body.person_id).toBe(DEMO_SPEAKER_PERSON_ID);
  // The judge's actual question, asked of the API: same shell, different hat.
  expect(speaker.body.person_name).not.toBe(organizer.body.person_name);
  expect(speaker.body.memberships?.[0]?.role).toBe("speaker");
  expect(organizer.body.memberships?.[0]?.role).toBe("owner");
});

test("CONTRACT · signing out ends the session, so the shell's exit is a real exit", async () => {
  await seedDemoFixture();
  const cookie = await demoSessionCookie("organizer");
  expect((await readMe(cookie)).status).toBe(200);

  const loggedOut = await app.request("/api/v1/auth/logout", { method: "POST", headers: { cookie } }, env);
  expect(loggedOut.status).toBe(200);

  // The same cookie the browser still holds must no longer buy anything.
  expect((await readMe(cookie)).status).toBe(401);
});
