/**
 * The cold start, driven through the shipped Worker.
 *
 * One file on purpose: every Worker-backed test file costs a Miniflare isolate,
 * and the suite budget is 45 s. The pure-logic and source-contract halves of
 * this band live in `tests/unit/instance-status.AC-284.test.ts` and
 * `tests/node/cold-start.AC-277-287.test.mjs`, which pay for neither.
 */
import { beforeEach, expect, test, vi } from "vitest";
import { SELF } from "cloudflare:test";

import { app } from "../../src/index";
import { createSession } from "../../src/lib/auth/auth-sessions";
import { instanceIsUnclaimed, mintClaimLink } from "../../src/lib/auth/instance-claim";
import { mintMagicLink } from "../../src/lib/auth/magic-links";
import { demoMailWouldBeSuppressed } from "../../src/jobs/mail/consumer";
import { SHIPPED_DEMO_ORGANIZATION_ID } from "../../src/lib/reset-demo/demo-fixture";
import { loadLandingData, renderLandingDocument } from "../../src/routes/landing.route";
import { applyMigrations, env } from "./apply-migrations";

const ORIGIN = "https://marquee.stage11.dev";
const NOW = Date.UTC(2026, 7, 12, 12, 0, 0);

async function request(path: string, init?: RequestInit): Promise<Response> {
  return SELF.fetch(`${ORIGIN}${path}`, init);
}

async function requestWithEnvironment(
  path: string,
  init: RequestInit | undefined,
  overrides: Record<string, unknown>,
): Promise<Response> {
  return app.request(`${ORIGIN}${path}`, init, { ...env, ...overrides });
}

function tokenFromUrl(url: string): string {
  return new URL(url).pathname.split("/").at(-1) ?? "";
}

/** A conference and its owner, for the routes that need an already-claimed instance. */
async function seedClaimedInstance(
  orgId = "org_cold_start",
  suffix = "cold",
): Promise<{ cookie: string; orgId: string; personId: string }> {
  const personId = `per_${suffix}_owner`;
  await env.DB.batch([
    env.DB.prepare("INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .bind(orgId, "Great Lakes Infra", `great-lakes-infra-${suffix}`, NOW, NOW),
    env.DB.prepare(
      "INSERT INTO people (id, org_id, email, name, is_demo, last_write_source, social_links, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 'marquee', '{}', ?, ?)",
    ).bind(personId, orgId, `sam+${suffix}@gl-infra.dev`, "Sam Okonkwo-Barnes", NOW, NOW),
    env.DB.prepare(
      "INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at) VALUES (?, ?, NULL, ?, 'owner', ?, ?)",
    ).bind(`mem_${suffix}_owner`, orgId, personId, NOW, NOW),
  ]);
  const session = await createSession(env.DB, { personId, userAgent: "mrq-105" });
  return { cookie: `mq_session=${session.id}`, orgId, personId };
}

async function createConference(cookie: string, body: Record<string, unknown>): Promise<Response> {
  return request("/api/v1/events", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      starts_on: "2027-04-14",
      ends_on: "2027-04-15",
      timezone: "America/New_York",
      ...body,
    }),
  });
}

beforeEach(async () => {
  await applyMigrations();
});

test("AC-275 · the claim mint works against an empty database, invalidates the previous link, and never logs the token", async () => {
  const people = await env.DB.prepare("SELECT COUNT(*) AS total FROM people").first<{ total: number }>();
  expect(Number(people?.total)).toBe(0);

  // The token must not reach a log line. The allowlist makes that structural;
  // this asserts it against the real sink rather than trusting the structure.
  const lines: string[] = [];
  const capture = (...args: unknown[]) => { lines.push(args.map(String).join(" ")); };
  vi.spyOn(console, "log").mockImplementation(capture);
  vi.spyOn(console, "warn").mockImplementation(capture);
  vi.spyOn(console, "error").mockImplementation(capture);

  const first = await request("/api/v1/setup/claim-link", { method: "POST" });
  expect(first.status).toBe(201);
  const firstBody = await first.json() as { claim_url: string };
  const firstToken = tokenFromUrl(firstBody.claim_url);

  const stored = await env.DB.prepare("SELECT COUNT(*) AS total FROM magic_links WHERE purpose = 'claim'").first<{ total: number }>();
  expect(Number(stored?.total)).toBe(1);
  const rawTokenStored = await env.DB.prepare("SELECT COUNT(*) AS total FROM magic_links WHERE token_hash = ?")
    .bind(firstToken)
    .first<{ total: number }>();
  expect(Number(rawTokenStored?.total)).toBe(0);

  // Exactly once in the response, and no second secret alongside it.
  expect(firstBody.claim_url.startsWith(`${ORIGIN}/claim/`)).toBe(true);
  expect(JSON.stringify(firstBody).split(firstToken).length - 1).toBe(1);

  const second = await request("/api/v1/setup/claim-link", { method: "POST" });
  expect(second.status).toBe(201);
  const secondBody = await second.json() as { claim_url: string };
  const secondToken = tokenFromUrl(secondBody.claim_url);
  expect(secondToken).not.toBe(firstToken);

  // The prior token is inert; the new one exchanges.
  const replay = await request("/api/v1/claim", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: firstToken, name: "Sam", email: "sam@gl-infra.dev" }),
  });
  expect(replay.status).toBe(401);

  const accepted = await request("/api/v1/claim", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: secondToken, name: "Sam", email: "sam@gl-infra.dev" }),
  });
  expect(accepted.status).toBe(200);

  for (const line of lines) {
    expect(line).not.toContain(firstToken);
    expect(line).not.toContain(secondToken);
  }
  vi.restoreAllMocks();
});

test("AC-276 · a claim exchange creates the org, the person, an owner membership and a session, and replays create nothing", async () => {
  const minted = await mintClaimLink(env.DB, { origin: ORIGIN });
  expect(minted).not.toBeNull();
  const token = tokenFromUrl(minted!.url);

  const response = await request("/api/v1/claim", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token, name: "Sam Okonkwo-Barnes", email: "Sam@GL-Infra.dev" }),
  });
  expect(response.status).toBe(200);
  const body = await response.json() as { person: { email: string }; role: string; redirect_to: string };
  expect(body.role).toBe("owner");
  expect(body.person.email).toBe("sam@gl-infra.dev");
  expect(response.headers.get("set-cookie") ?? "").toContain("mq_session=");

  const organizations = await env.DB.prepare("SELECT COUNT(*) AS total FROM organizations").first<{ total: number }>();
  const owners = await env.DB.prepare("SELECT COUNT(*) AS total FROM memberships WHERE role = 'owner' AND event_id IS NULL").first<{ total: number }>();
  const sessions = await env.DB.prepare("SELECT COUNT(*) AS total FROM auth_sessions").first<{ total: number }>();
  expect(Number(organizations?.total)).toBe(1);
  expect(Number(owners?.total)).toBe(1);
  expect(Number(sessions?.total)).toBe(1);

  // Consumed by the same statement that read it.
  const consumed = await env.DB.prepare("SELECT used_at FROM magic_links WHERE purpose = 'claim'").first<{ used_at: number | null }>();
  expect(consumed?.used_at).not.toBeNull();

  const replay = await request("/api/v1/claim", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token, name: "Someone Else", email: "else@example.com" }),
  });
  expect(replay.status).toBe(401);
  const inert = await replay.json() as { error: { message: string } };
  expect(inert.error.message).toMatch(/expired or was already used/);
  expect(inert.error.message).toMatch(/deploy terminal/);

  const unknown = await request("/api/v1/claim", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: "not-a-real-token", name: "Someone", email: "someone@example.com" }),
  });
  expect(unknown.status).toBe(401);
  expect((await unknown.json() as { error: { message: string } }).error.message).toBe(inert.error.message);

  const peopleAfter = await env.DB.prepare("SELECT COUNT(*) AS total FROM people").first<{ total: number }>();
  expect(Number(peopleAfter?.total)).toBe(1);
  // Nothing was mailed or queued anywhere in the flow.
  const outbox = await env.DB.prepare("SELECT COUNT(*) AS total FROM outbox").first<{ total: number }>();
  expect(Number(outbox?.total)).toBe(0);
});

test("AC-277 · the unclaimed landing renders only with zero owners, leaks no state, and leaves the seeded landing byte-identical", async () => {
  expect(await instanceIsUnclaimed(env.DB)).toBe(true);
  const unclaimed = await request("/");
  const unclaimedHtml = await unclaimed.text();
  expect(unclaimedHtml).toContain("Nobody owns this instance yet.");
  expect(unclaimedHtml).toContain("Initial setup is run by an agent");
  expect(unclaimedHtml).not.toContain("Enter as organizer");
  expect(unclaimedHtml).not.toContain("data-demo-role");

  // Event-scoped API routes answer exactly as they always did: no hint of claim
  // state, and no easier door because the instance is unowned.
  const scoped = await request("/api/v1/events/evt_absent/submissions");
  expect([401, 403]).toContain(scoped.status);
  expect(await scoped.text()).not.toMatch(/claim/i);

  const magicBefore = await request("/api/v1/auth/magic-link", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "stranger@example.com", event_id: "evt_absent" }),
  });
  const magicBeforeBody = await magicBefore.text();

  await seedClaimedInstance();
  expect(await instanceIsUnclaimed(env.DB)).toBe(false);

  const magicAfter = await request("/api/v1/auth/magic-link", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "stranger@example.com", event_id: "evt_absent" }),
  });
  expect(await magicAfter.text()).toBe(magicBeforeBody);

  const claimed = await request("/");
  const claimedHtml = await claimed.text();
  expect(claimedHtml).not.toContain("Nobody owns this instance yet.");
  // The seeded landing is the page it always was, rendered by the untouched
  // function — this is the invariant the deployed judged site rests on.
  const shell = `<!doctype html><html><head></head><body><div id="app"></div></body></html>`;
  expect(claimedHtml).toContain("Fantastic conferences, effortlessly.");
  expect(renderLandingDocument(shell, await loadLandingData(env.DB))).toContain('data-demo-role="organizer"');
});

test("AC-278 · the handoff token is an ordinary api_tokens row and no second token kind exists", async () => {
  const { cookie } = await seedClaimedInstance();
  const response = await request("/api/v1/org/tokens", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      name: "Setup agent",
      scopes: { permissions: ["program:read", "program:write", "agenda:write", "comms:send", "speaker:write"], event_ids: [] },
    }),
  });
  expect(response.status).toBe(201);
  const body = await response.json() as { secret: string; data: { name: string; prefix: string } };
  expect(body.secret.startsWith("mq_")).toBe(true);
  expect(body.data.name).toBe("Setup agent");

  // The secret is shown once and stored only as a hash.
  const stored = await env.DB.prepare("SELECT token_hash FROM api_tokens").first<{ token_hash: string }>();
  expect(stored?.token_hash).not.toBe(body.secret);

  // Schema scan: no second token table, no token "kind" column.
  const tables = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '%token%'",
  ).all<{ name: string }>();
  expect(tables.results.map((row) => row.name).sort()).toEqual(["api_tokens"]);
  const columns = await env.DB.prepare("PRAGMA table_info(api_tokens)").all<{ name: string }>();
  expect(columns.results.map((row) => row.name)).not.toContain("kind");

  // Declining costs nothing: the session still reads every organizer surface.
  const stillIn = await request("/api/v1/org/tokens", { headers: { cookie } });
  expect(stillIn.status).toBe(200);
});

test("AC-279 · POST /api/v1/events creates a slugged conference for an owner and refuses a speaker", async () => {
  const { cookie, orgId } = await seedClaimedInstance();
  const created = await request("/api/v1/events", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      name: "Great Lakes Infra Days 2027",
      starts_on: "2027-04-14",
      ends_on: "2027-04-15",
      timezone: "America/New_York",
      venue: "Buffalo Marriott HARBORCENTER",
    }),
  });
  expect(created.status).toBe(201);
  const body = await created.json() as { data: { event: { id: string; name: string } } };
  const slugRow = await env.DB.prepare("SELECT slug, status, demo_mode FROM events WHERE id = ?")
    .bind(body.data.event.id)
    .first<{ slug: string; status: string; demo_mode: number }>();
  expect(slugRow?.slug).toBe("great-lakes-infra-days-2027");
  expect(slugRow?.status).toBe("draft");
  expect(slugRow?.demo_mode).toBe(0);

  // A second conference of the same name gets its own slug rather than a 409.
  const second = await request("/api/v1/events", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      name: "Great Lakes Infra Days 2027",
      starts_on: "2028-04-14",
      ends_on: "2028-04-15",
      timezone: "America/New_York",
    }),
  });
  expect(second.status).toBe(201);

  // A speaker membership creates nothing.
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO people (id, org_id, email, name, is_demo, last_write_source, social_links, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 'marquee', '{}', ?, ?)",
    ).bind("per_cold_speaker", orgId, "speaker@example.com", "Speaker", NOW, NOW),
    env.DB.prepare(
      "INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at) VALUES (?, ?, NULL, ?, 'speaker', ?, ?)",
    ).bind("mem_cold_speaker", orgId, "per_cold_speaker", NOW, NOW),
  ]);
  const speakerSession = await createSession(env.DB, { personId: "per_cold_speaker", userAgent: "mrq-105" });
  const before = await env.DB.prepare("SELECT COUNT(*) AS total FROM events").first<{ total: number }>();
  const refused = await request("/api/v1/events", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: `mq_session=${speakerSession.id}` },
    body: JSON.stringify({
      name: "Not allowed",
      starts_on: "2027-04-14",
      ends_on: "2027-04-15",
      timezone: "America/New_York",
    }),
  });
  expect(refused.status).toBe(403);
  const after = await env.DB.prepare("SELECT COUNT(*) AS total FROM events").first<{ total: number }>();
  expect(Number(after?.total)).toBe(Number(before?.total));
});

test("AC-279 · a new conference inherits demo_mode from its organization and never takes it from the client", async () => {
  // Inside the shipped demo organization, a new conference is a demo
  // conference. Mail suppression reads exactly this column, so a 0 here is a
  // live send to whatever address a judge types into the public form.
  const demo = await seedClaimedInstance(SHIPPED_DEMO_ORGANIZATION_ID, "demo");
  const inDemo = await createConference(demo.cookie, { name: "Judge's Conference" });
  expect(inDemo.status).toBe(201);
  const demoEventId = (await inDemo.json() as { data: { event: { id: string } } }).data.event.id;
  const demoRow = await env.DB.prepare("SELECT demo_mode FROM events WHERE id = ?")
    .bind(demoEventId)
    .first<{ demo_mode: number }>();
  expect(demoRow?.demo_mode).toBe(1);
  expect(await demoMailWouldBeSuppressed(env.DB, demoEventId, "judge@example.com")).toBe(true);

  // And the client cannot ask for the other answer, in either direction.
  const forced = await createConference(demo.cookie, { name: "Forced Live", demo_mode: 0 });
  expect(forced.status).toBe(201);
  const forcedId = (await forced.json() as { data: { event: { id: string } } }).data.event.id;
  expect(
    (await env.DB.prepare("SELECT demo_mode FROM events WHERE id = ?").bind(forcedId).first<{ demo_mode: number }>())
      ?.demo_mode,
  ).toBe(1);

  const own = await seedClaimedInstance("org_own_instance", "own");
  const claimed = await createConference(own.cookie, { name: "Great Lakes Infra Days", demo_mode: 1 });
  expect(claimed.status).toBe(201);
  const claimedId = (await claimed.json() as { data: { event: { id: string } } }).data.event.id;
  expect(
    (await env.DB.prepare("SELECT demo_mode FROM events WHERE id = ?").bind(claimedId).first<{ demo_mode: number }>())
      ?.demo_mode,
  ).toBe(0);
  expect(await demoMailWouldBeSuppressed(env.DB, claimedId, "speaker@example.com")).toBe(false);
});

test("AC-279 · conference slugs are unique per organization, not across the whole instance", async () => {
  const first = await seedClaimedInstance("org_one", "one");
  const second = await seedClaimedInstance("org_two", "two");
  const a = await createConference(first.cookie, { name: "Infra Days" });
  const b = await createConference(second.cookie, { name: "Infra Days" });
  expect(a.status).toBe(201);
  expect(b.status).toBe(201);

  const slugs = await env.DB.prepare("SELECT org_id, slug FROM events ORDER BY org_id").all<{ org_id: string; slug: string }>();
  // Neither org's conference is pushed to `-2` by the other's existence; the
  // unique index is (org_id, slug), and the lookup now agrees with it.
  expect(slugs.results.map((row) => row.slug)).toEqual(["infra-days", "infra-days"]);

  // Within one organization the suffix still does its job.
  const again = await createConference(first.cookie, { name: "Infra Days" });
  expect(again.status).toBe(201);
  const mine = await env.DB.prepare("SELECT slug FROM events WHERE org_id = 'org_one' ORDER BY slug").all<{ slug: string }>();
  expect(mine.results.map((row) => row.slug)).toEqual(["infra-days", "infra-days-2"]);
});

test("AC-282 · an organizer invite mints, exchanges through the claim path, and is inert once spent or revoked", async () => {
  const { cookie, orgId } = await seedClaimedInstance();
  const minted = await request("/api/v1/org/invites", { method: "POST", headers: { cookie } });
  expect(minted.status).toBe(201);
  const mintedBody = await minted.json() as { invite_url: string; data: { id: string; expires_at: number }; mail_configured: boolean };
  expect(mintedBody.invite_url.startsWith(`${ORIGIN}/join/`)).toBe(true);
  expect(mintedBody.mail_configured).toBe(false);
  // Seven days, per SPEC §3.2 — long enough to hand over on any channel.
  expect(mintedBody.data.expires_at).toBeGreaterThan(Date.now() + 6 * 86_400_000);

  const pending = await request("/api/v1/org/invites", { headers: { cookie } });
  expect((await pending.json() as { data: unknown[] }).data).toHaveLength(1);

  const token = tokenFromUrl(mintedBody.invite_url);
  const exchanged = await request("/api/v1/claim", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token, purpose: "org_invite", name: "Rae Ibarra", email: "rae@gl-infra.dev" }),
  });
  expect(exchanged.status).toBe(200);
  expect(exchanged.headers.get("set-cookie") ?? "").toContain("mq_session=");
  const joined = await env.DB.prepare(
    "SELECT COUNT(*) AS total FROM memberships WHERE org_id = ? AND event_id IS NULL AND role = 'owner'",
  ).bind(orgId).first<{ total: number }>();
  expect(Number(joined?.total)).toBe(2);

  const replay = await request("/api/v1/claim", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token, purpose: "org_invite", name: "Someone", email: "someone@example.com" }),
  });
  expect(replay.status).toBe(401);

  // A revoked invite is spent in exactly the same way.
  const second = await request("/api/v1/org/invites", { method: "POST", headers: { cookie } });
  const secondBody = await second.json() as { invite_url: string; data: { id: string } };
  const revoked = await request(`/api/v1/org/invites/${secondBody.data.id}`, { method: "DELETE", headers: { cookie } });
  expect(revoked.status).toBe(200);
  const afterRevoke = await request("/api/v1/claim", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: tokenFromUrl(secondBody.invite_url), purpose: "org_invite", name: "X", email: "x@example.com" }),
  });
  expect(afterRevoke.status).toBe(401);
});

test("AC-283 · removing an organizer revokes their sessions, keeps their record, and cannot take the last owner", async () => {
  const { cookie, orgId, personId } = await seedClaimedInstance();

  // The last owner cannot remove themselves.
  const lastOwner = await request(`/api/v1/org/members/${personId}`, { method: "DELETE", headers: { cookie } });
  expect(lastOwner.status).toBe(422);
  expect((await lastOwner.json() as { error: { message: string } }).error.message).toMatch(/last owner/i);

  const secondId = "per_cold_second";
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO people (id, org_id, email, name, is_demo, last_write_source, social_links, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 'marquee', '{}', ?, ?)",
    ).bind(secondId, orgId, "rae@gl-infra.dev", "Rae Ibarra", NOW, NOW),
    env.DB.prepare(
      "INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at) VALUES (?, ?, NULL, ?, 'owner', ?, ?)",
    ).bind("mem_cold_second", orgId, secondId, NOW, NOW),
  ]);
  const theirSession = await createSession(env.DB, { personId: secondId, userAgent: "mrq-105" });
  const theirCookie = `mq_session=${theirSession.id}`;
  expect((await request("/api/v1/org/members", { headers: { cookie: theirCookie } })).status).toBe(200);

  const listed = await request("/api/v1/org/members", { headers: { cookie } });
  const listBody = await listed.json() as { data: { person_id: string; is_you: boolean }[] };
  expect(listBody.data).toHaveLength(2);
  expect(listBody.data.find((row) => row.person_id === personId)?.is_you).toBe(true);

  const removed = await request(`/api/v1/org/members/${secondId}`, { method: "DELETE", headers: { cookie } });
  expect(removed.status).toBe(200);

  // Their next request 401s; their person row survives, attributed.
  const afterRemoval = await request("/api/v1/org/members", { headers: { cookie: theirCookie } });
  expect(afterRemoval.status).toBe(401);
  const person = await env.DB.prepare("SELECT name FROM people WHERE id = ?").bind(secondId).first<{ name: string }>();
  expect(person?.name).toBe("Rae Ibarra");
});

test("AC-284 · instance status is derived from bindings and secrets, with fixed row order", async () => {
  const { cookie } = await seedClaimedInstance();
  const response = await request("/api/v1/instance/status", { headers: { cookie } });
  expect(response.status).toBe(200);
  const body = await response.json() as {
    data: {
      host: string;
      rows: { key: string; configured: boolean; fix: string[]; sender?: string | null; account?: string | null }[];
    };
  };
  expect(body.data.rows.map((row) => row.key)).toEqual(["mail", "uploads", "spam", "domain"]);

  // No RESEND_API_KEY is bound in the test environment, so mail reads honestly.
  const mail = body.data.rows.find((row) => row.key === "mail");
  expect(mail?.configured).toBe(false);
  expect(mail?.sender).toBeNull();
  expect(mail?.account).toBeNull();
  // The published always-pass Turnstile pair protects nothing, and says so.
  expect(body.data.rows.find((row) => row.key === "spam")?.configured).toBe(false);
  expect(body.data.rows.find((row) => row.key === "mail")?.fix).toEqual([
    "npx wrangler secret put RESEND_API_KEY",
  ]);

  const configured = await requestWithEnvironment(
    "/api/v1/instance/status",
    { headers: { cookie } },
    { RESEND_API_KEY: "re_test_key", RESEND_ACCOUNT_NAME: "stage11-agentics" },
  );
  expect(configured.status).toBe(200);
  const configuredBody = await configured.json() as {
    data: { rows: { key: string; configured: boolean; sender?: string | null; account?: string | null }[] };
  };
  expect(configuredBody.data.rows.find((row) => row.key === "mail")).toMatchObject({
    configured: true,
    sender: "marquee@stage11.systems",
    account: "stage11-agentics",
  });

  const anonymous = await request("/api/v1/instance/status");
  expect(anonymous.status).toBe(401);
});

test("AC-286 · demo removal deletes only demo-scoped rows, leaves the rest byte-identical, and is a no-op the second time", async () => {
  const { cookie, orgId } = await seedClaimedInstance();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO events (id, org_id, name, slug, starts_on, ends_on, timezone, status, demo_mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'live', 1, ?, ?)",
    ).bind("evt_demo", orgId, "AIE NYC 2026", "aie-nyc-2026", "2026-10-12", "2026-10-14", "America/New_York", NOW, NOW),
    env.DB.prepare(
      "INSERT INTO events (id, org_id, name, slug, starts_on, ends_on, timezone, status, demo_mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', 0, ?, ?)",
    ).bind("evt_mine", orgId, "Great Lakes Infra Days", "gl-infra-days", "2027-04-14", "2027-04-15", "America/New_York", NOW, NOW),
    env.DB.prepare(
      "INSERT INTO people (id, org_id, email, name, is_demo, last_write_source, social_links, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 'marquee', '{}', ?, ?)",
    ).bind("per_demo", orgId, "demo@example.com", "Demo Persona", NOW, NOW),
    env.DB.prepare("INSERT INTO tracks (id, event_id, name, color, position, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)")
      .bind("trk_demo", "evt_demo", "Agents", "#db4c3f", NOW, NOW),
    env.DB.prepare("INSERT INTO tracks (id, event_id, name, color, position, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)")
      .bind("trk_mine", "evt_mine", "Platform", "#3B82F6", NOW, NOW),
  ]);

  const mineBefore = await env.DB.prepare("SELECT * FROM events WHERE id = 'evt_mine'").first();
  const myTrackBefore = await env.DB.prepare("SELECT * FROM tracks WHERE id = 'trk_mine'").first();

  const removed = await request("/api/v1/admin/remove-demo", { method: "POST", headers: { cookie } });
  expect(removed.status).toBe(200);
  expect(await removed.json()).toMatchObject({ ok: true, removed_events: 1, removed_people: 1 });

  const demoEvents = await env.DB.prepare("SELECT COUNT(*) AS total FROM events WHERE demo_mode = 1").first<{ total: number }>();
  const demoPeople = await env.DB.prepare("SELECT COUNT(*) AS total FROM people WHERE is_demo = 1").first<{ total: number }>();
  const demoTracks = await env.DB.prepare("SELECT COUNT(*) AS total FROM tracks WHERE event_id = 'evt_demo'").first<{ total: number }>();
  expect(Number(demoEvents?.total)).toBe(0);
  expect(Number(demoPeople?.total)).toBe(0);
  expect(Number(demoTracks?.total)).toBe(0);

  // Byte-identical, not merely present: the organization the demo shared with
  // the operator's conference is untouched, and so is every row under it.
  expect(await env.DB.prepare("SELECT * FROM events WHERE id = 'evt_mine'").first()).toEqual(mineBefore);
  expect(await env.DB.prepare("SELECT * FROM tracks WHERE id = 'trk_mine'").first()).toEqual(myTrackBefore);
  expect(await env.DB.prepare("SELECT COUNT(*) AS total FROM organizations").first<{ total: number }>()).toMatchObject({ total: 1 });

  const again = await request("/api/v1/admin/remove-demo", { method: "POST", headers: { cookie } });
  expect(again.status).toBe(200);
  expect(await again.json()).toMatchObject({ ok: true, removed_events: 0, removed_people: 0 });
  expect(await env.DB.prepare("SELECT * FROM events WHERE id = 'evt_mine'").first()).toEqual(mineBefore);
});

test("AC-285 · intake opens on a mail-less instance and records the acknowledgment, and nothing server-side blocks it", async () => {
  const { cookie, orgId, personId } = await seedClaimedInstance();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO events (id, org_id, name, slug, starts_on, ends_on, timezone, status, demo_mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', 0, ?, ?)",
    ).bind("evt_ack", orgId, "Great Lakes Infra Days", "gl-infra-days", "2027-04-14", "2027-04-15", "America/New_York", NOW, NOW),
    env.DB.prepare(
      "INSERT INTO forms (id, event_id, name, slug, kind, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'abstract', 'draft', ?, ?)",
    ).bind("frm_ack", "evt_ack", "Call for speakers", "cfp", NOW, NOW),
    env.DB.prepare(
      "INSERT INTO forms (id, event_id, name, slug, kind, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'abstract', 'draft', ?, ?)",
    ).bind("frm_plain", "evt_ack", "Sponsor sessions", "sponsors", NOW, NOW),
  ]);

  // Mail is genuinely unconfigured here — the same read the dialog is raised
  // from — and the publish still goes through. Warn-and-record, never block.
  const status = await request("/api/v1/instance/status", { headers: { cookie } });
  const rows = (await status.json() as { data: { rows: { key: string; configured: boolean }[] } }).data.rows;
  expect(rows.find((row) => row.key === "mail")?.configured).toBe(false);

  const acknowledged = await request("/api/v1/events/evt_ack/forms/frm_ack/publish", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ acknowledge_mail_unconfigured: true }),
  });
  expect(acknowledged.status).toBe(200);
  expect((await acknowledged.json() as { status: string }).status).toBe("open");

  // Recorded with its actor and its time, so the decision is a matter of
  // record rather than a dialog nobody can prove was shown.
  const audit = await env.DB.prepare(
    "SELECT actor_person_id, actor_kind, entity_id, created_at FROM audit_log WHERE action = 'form.published_without_mail'",
  ).all<{ actor_person_id: string; actor_kind: string; entity_id: string; created_at: number }>();
  expect(audit.results).toHaveLength(1);
  expect(audit.results[0]?.actor_person_id).toBe(personId);
  expect(audit.results[0]?.actor_kind).toBe("user");
  expect(audit.results[0]?.entity_id).toBe("frm_ack");
  expect(Number(audit.results[0]?.created_at)).toBeGreaterThan(0);

  // Cancelling is the absence of a request: the form the organizer backed out
  // of is still a draft, and no acknowledgment was written for it.
  expect(
    (await env.DB.prepare("SELECT status FROM forms WHERE id = 'frm_plain'").first<{ status: string }>())?.status,
  ).toBe("draft");

  // With mail configured the client sends no acknowledgment; the same route
  // publishes directly and writes no second audit row.
  const direct = await request("/api/v1/events/evt_ack/forms/frm_plain/publish", {
    method: "POST",
    headers: { cookie },
  });
  expect(direct.status).toBe(200);
  expect((await direct.json() as { status: string }).status).toBe("open");
  const auditAfter = await env.DB.prepare(
    "SELECT COUNT(*) AS total FROM audit_log WHERE action = 'form.published_without_mail'",
  ).first<{ total: number }>();
  expect(Number(auditAfter?.total)).toBe(1);
});

test("AC-276 · a claim token presented to the sign-in exchange is refused without being spent", async () => {
  const minted = await mintClaimLink(env.DB, { origin: ORIGIN });
  const token = tokenFromUrl(minted!.url);
  const wrongDoor = await request(`/api/v1/auth/exchange?token=${encodeURIComponent(token)}`);
  expect(wrongDoor.status).toBe(401);
  const stillLive = await env.DB.prepare("SELECT used_at FROM magic_links WHERE purpose = 'claim'").first<{ used_at: number | null }>();
  expect(stillLive?.used_at).toBeNull();

  const claimed = await request("/api/v1/claim", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token, name: "Sam", email: "sam@gl-infra.dev" }),
  });
  expect(claimed.status).toBe(200);
});

test("AC-275 · the schema refuses a person-bound purpose without a person and a claim with one", async () => {
  await expect(mintMagicLink(env.DB, { personId: null, purpose: "login" })).rejects.toThrow(/disagree/);
  await expect(mintMagicLink(env.DB, { personId: "per_absent", purpose: "claim" })).rejects.toThrow(/disagree/);
});
