/**
 * MRQ-107 · reviewer provisioning, end to end (eval §T-A).
 *
 * The invariant under test is that one organizer action produces a reviewer who
 * can actually work: person, event-scoped reviewer membership, committee seat,
 * and track responsibilities — and that the resulting queue is exactly the
 * assigned work inside those responsibilities, never a track over.
 */
import { SELF } from "cloudflare:test";
import { beforeEach, describe, expect, test } from "vitest";

import {
  DEMO_EVENT_ID,
  DEMO_ORGANIZATION_ID,
  DEMO_ORGANIZER_PERSON_ID,
  demoFixtureRows,
} from "../../../src/lib/reset-demo/demo-fixture";
import { applyMigrations, env } from "../apply-migrations";

const EVENT_ID = DEMO_EVENT_ID;
const ORGANIZER_ID = DEMO_ORGANIZER_PERSON_ID;
const ORGANIZER_SESSION = "sess-mrq107-organizer";
const TRACK_AGENTS = "track-mrq107-agents";
const TRACK_SECURITY = "track-mrq107-security";
const SUBMISSION_IN_SCOPE = "submission-mrq107-agents";
const SUBMISSION_OUT_OF_SCOPE = "submission-mrq107-security";
const PLAN_ID = "plan-mrq107";
const ROUND_ID = "round-mrq107";
const COMMITTEE_ID = "committee-mrq107";
const OUTSIDER_ID = "person-mrq107-outsider";

const ORIGIN = "https://marquee.example";

async function request(path: string, init: RequestInit = {}, cookie = `mq_session=${ORGANIZER_SESSION}`): Promise<Response> {
  const headers = new Headers(init.headers);
  if (cookie) headers.set("cookie", cookie);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  return SELF.fetch(`${ORIGIN}${path}`, { ...init, headers });
}

async function json<T>(response: Response): Promise<T> {
  return response.json() as Promise<T>;
}

function submission(id: string, title: string, now: number): D1PreparedStatement {
  return env.DB.prepare(`
    INSERT INTO submissions (id, event_id, kind, bypass_evaluation, title, abstract, status, origin, submitter_person_id, submitted_at, last_saved_at, search_blob, created_at, updated_at)
    VALUES (?, ?, 'abstract', 0, ?, ?, 'in_review', 'public', ?, ?, ?, ?, ?, ?)
  `).bind(id, EVENT_ID, title, `${title} abstract.`, ORGANIZER_ID, now, now, title.toLowerCase(), now, now);
}

async function seedFixture(): Promise<void> {
  await applyMigrations();
  const now = Date.now();
  for (const row of demoFixtureRows(now)) await env.DB.prepare(row.statement).bind(...row.bindings).run();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO auth_sessions (id, person_id, role_hint, expires_at, user_agent_hash, revoked_at, created_at, updated_at) VALUES (?, ?, 'organizer', ?, 'fixture', NULL, ?, ?)")
      .bind(ORGANIZER_SESSION, ORGANIZER_ID, now + 86_400_000, now, now),
    env.DB.prepare("INSERT INTO people (id, org_id, email, name, social_links, is_demo, last_write_source, created_at, updated_at) VALUES (?, ?, ?, ?, '[]', 1, 'marquee', ?, ?)")
      .bind(OUTSIDER_ID, DEMO_ORGANIZATION_ID, "outsider@example.org", "Kit Alarcon", now, now),
    env.DB.prepare("INSERT INTO tracks (id, event_id, name, color, position, created_at, updated_at) VALUES (?, ?, 'Agents', '#db4c3f', 0, ?, ?)").bind(TRACK_AGENTS, EVENT_ID, now, now),
    env.DB.prepare("INSERT INTO tracks (id, event_id, name, color, position, created_at, updated_at) VALUES (?, ?, 'Security', '#be185d', 1, ?, ?)").bind(TRACK_SECURITY, EVENT_ID, now, now),
    submission(SUBMISSION_IN_SCOPE, "Agents in production", now),
    submission(SUBMISSION_OUT_OF_SCOPE, "Security only", now),
    env.DB.prepare("INSERT INTO submission_tracks (id, submission_id, track_id, is_primary, created_at, updated_at) VALUES ('st-mrq107-a', ?, ?, 1, ?, ?)").bind(SUBMISSION_IN_SCOPE, TRACK_AGENTS, now, now),
    env.DB.prepare("INSERT INTO submission_tracks (id, submission_id, track_id, is_primary, created_at, updated_at) VALUES ('st-mrq107-b', ?, ?, 1, ?, ?)").bind(SUBMISSION_OUT_OF_SCOPE, TRACK_SECURITY, now, now),
    env.DB.prepare("INSERT INTO evaluation_plans (id, event_id, name, instructions, scale_min, scale_max, status, created_at, updated_at) VALUES (?, ?, 'Program review', 'Read it, then recommend.', 1, 5, 'open', ?, ?)").bind(PLAN_ID, EVENT_ID, now, now),
    env.DB.prepare("INSERT INTO evaluation_rounds (id, plan_id, position, name, mode, anonymized, target_reviews_per_submission, created_at, updated_at) VALUES (?, ?, 0, 'Initial screen', 'scorecard', 1, 1, ?, ?)").bind(ROUND_ID, PLAN_ID, now, now),
    env.DB.prepare("INSERT INTO committees (id, event_id, name, created_at, updated_at) VALUES (?, ?, 'Program reviewers', ?, ?)").bind(COMMITTEE_ID, EVENT_ID, now, now),
    // Committee-level assignments: both submissions are the committee's work, so
    // the only thing that can narrow an invited reviewer's queue is their scope.
    env.DB.prepare("INSERT INTO round_assignments (id, round_id, submission_id, reviewer_person_id, committee_id, status, created_at, updated_at) VALUES ('ra-mrq107-a', ?, ?, NULL, ?, 'assigned', ?, ?)").bind(ROUND_ID, SUBMISSION_IN_SCOPE, COMMITTEE_ID, now, now),
    env.DB.prepare("INSERT INTO round_assignments (id, round_id, submission_id, reviewer_person_id, committee_id, status, created_at, updated_at) VALUES ('ra-mrq107-b', ?, ?, NULL, ?, 'assigned', ?, ?)").bind(ROUND_ID, SUBMISSION_OUT_OF_SCOPE, COMMITTEE_ID, now, now),
  ]);
}

interface InviteResponse {
  invite_sent: boolean;
  magic_link?: string;
  person: { email: string; id: string; name: string };
  person_created: boolean;
  track_ids: string[];
}

async function invite(body: Record<string, unknown>): Promise<Response> {
  return request(`/api/v1/events/${EVENT_ID}/committees/${COMMITTEE_ID}/invites`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

async function sessionCookieFromLink(magicLink: string): Promise<string> {
  const exchange = await SELF.fetch(magicLink, { redirect: "manual" });
  expect(exchange.status).toBe(302);
  const setCookie = exchange.headers.get("set-cookie") ?? "";
  const session = /mq_session=([^;]+)/.exec(setCookie)?.[1];
  expect(session).toBeTruthy();
  return `mq_session=${session}`;
}

describe("MRQ-107 reviewer provisioning", () => {
  beforeEach(seedFixture, 15_000);

  test("MRQ-107 · one invite writes person, reviewer membership, committee seat, and track scope", async () => {
    const response = await invite({ name: "Nora Vale", email: "Nora@Example.org", company: "Mosaic Relay", track_ids: [TRACK_AGENTS] });
    expect(response.status).toBe(201);
    const body = await json<InviteResponse>(response);
    expect(body.person_created).toBe(true);
    expect(body.person.email).toBe("nora@example.org");
    expect(body.track_ids).toEqual([TRACK_AGENTS]);

    const person = await env.DB.prepare("SELECT id, name, company FROM people WHERE org_id = ? AND email = ?")
      .bind(DEMO_ORGANIZATION_ID, "nora@example.org").first<{ company: string; id: string; name: string }>();
    expect(person?.name).toBe("Nora Vale");
    expect(person?.company).toBe("Mosaic Relay");

    const membership = await env.DB.prepare("SELECT COUNT(*) AS n FROM memberships WHERE event_id = ? AND person_id = ? AND role = 'reviewer'")
      .bind(EVENT_ID, body.person.id).first<{ n: number }>();
    expect(Number(membership?.n)).toBe(1);

    const seat = await env.DB.prepare("SELECT COUNT(*) AS n FROM committee_members WHERE committee_id = ? AND person_id = ?")
      .bind(COMMITTEE_ID, body.person.id).first<{ n: number }>();
    expect(Number(seat?.n)).toBe(1);

    const scopes = await env.DB.prepare("SELECT track_id FROM reviewer_track_scopes WHERE event_id = ? AND person_id = ?")
      .bind(EVENT_ID, body.person.id).all<{ track_id: string }>();
    expect(scopes.results.map((row) => row.track_id)).toEqual([TRACK_AGENTS]);

    const audit = await env.DB.prepare("SELECT action, entity_id FROM audit_log WHERE event_id = ? AND action = 'reviewer_invited'")
      .bind(EVENT_ID).first<{ action: string; entity_id: string }>();
    expect(audit?.entity_id).toBe(body.person.id);
  });

  test("MRQ-107 · the invited reviewer's queue is exactly their assigned work inside their tracks", async () => {
    const body = await json<InviteResponse>(await invite({ name: "Nora Vale", email: "nora@example.org", track_ids: [TRACK_AGENTS] }));
    expect(body.magic_link).toBeTruthy();

    const cookie = await sessionCookieFromLink(body.magic_link!);
    const me = await json<{ memberships: Array<{ role: string }>; person_id: string }>(
      await request("/api/v1/auth/me", {}, cookie),
    );
    expect(me.person_id).toBe(body.person.id);
    expect(me.memberships.map((membership) => membership.role)).toEqual(["reviewer"]);

    const queue = await request(`/api/v1/events/${EVENT_ID}/reviewer/queue`, {}, cookie);
    expect(queue.status).toBe(200);
    const payload = await json<{ data: Array<{ id: string }>; scopes: Array<{ id: string }> }>(queue);
    expect(payload.data.map((row) => row.id)).toEqual([SUBMISSION_IN_SCOPE]);
    expect(payload.scopes.map((scope) => scope.id)).toEqual([TRACK_AGENTS]);
  });

  test("MRQ-107 · a reviewer-only seat cannot reach the organizer's evaluation plan", async () => {
    const body = await json<InviteResponse>(await invite({ name: "Nora Vale", email: "nora@example.org", track_ids: [TRACK_AGENTS] }));
    const cookie = await sessionCookieFromLink(body.magic_link!);
    const plans = await request(`/api/v1/events/${EVENT_ID}/plans`, {}, cookie);
    expect(plans.status).toBe(403);
  });

  test("MRQ-107 · re-inviting the same address keeps one seat and replaces the responsibilities", async () => {
    const first = await json<InviteResponse>(await invite({ name: "Nora Vale", email: "nora@example.org", track_ids: [TRACK_AGENTS] }));
    const second = await json<InviteResponse>(await invite({ name: "Nora Vale", email: "nora@example.org", track_ids: [TRACK_SECURITY] }));
    expect(second.person.id).toBe(first.person.id);
    expect(second.person_created).toBe(false);

    const counts = await env.DB.prepare(`
      SELECT
        (SELECT COUNT(*) FROM memberships WHERE event_id = ? AND person_id = ? AND role = 'reviewer') AS memberships,
        (SELECT COUNT(*) FROM committee_members WHERE committee_id = ? AND person_id = ?) AS seats
    `).bind(EVENT_ID, first.person.id, COMMITTEE_ID, first.person.id).first<{ memberships: number; seats: number }>();
    expect(Number(counts?.memberships)).toBe(1);
    expect(Number(counts?.seats)).toBe(1);

    const scopes = await env.DB.prepare("SELECT track_id FROM reviewer_track_scopes WHERE event_id = ? AND person_id = ?")
      .bind(EVENT_ID, first.person.id).all<{ track_id: string }>();
    expect(scopes.results.map((row) => row.track_id)).toEqual([TRACK_SECURITY]);
  });

  test("MRQ-107 · an invitation is refused before it can create an unassignable reviewer", async () => {
    expect((await invite({ name: "Nora Vale", email: "nora@example.org", track_ids: [] })).status).toBe(400);
    expect((await invite({ name: "Nora Vale", email: "nora@example.org", track_ids: ["track-from-another-conference"] })).status).toBe(422);
    expect((await invite({ name: "Nora Vale", email: "not-an-address", track_ids: [TRACK_AGENTS] })).status).toBe(422);
    const people = await env.DB.prepare("SELECT COUNT(*) AS n FROM people WHERE email = 'nora@example.org'").first<{ n: number }>();
    expect(Number(people?.n)).toBe(0);
  });

  test("MRQ-107 · adding an existing person to a committee grants the reviewer role instead of refusing them", async () => {
    const response = await request(`/api/v1/events/${EVENT_ID}/committees/${COMMITTEE_ID}/reviewers`, {
      method: "POST",
      body: JSON.stringify({ person_id: OUTSIDER_ID }),
    });
    expect(response.status).toBe(201);
    const membership = await env.DB.prepare("SELECT COUNT(*) AS n FROM memberships WHERE event_id = ? AND person_id = ? AND role = 'reviewer'")
      .bind(EVENT_ID, OUTSIDER_ID).first<{ n: number }>();
    expect(Number(membership?.n)).toBe(1);

    const repeat = await request(`/api/v1/events/${EVENT_ID}/committees/${COMMITTEE_ID}/reviewers`, {
      method: "POST",
      body: JSON.stringify({ person_id: OUTSIDER_ID }),
    });
    expect(repeat.status).toBe(409);
  });

  test("MRQ-107 · an anonymous caller cannot provision a reviewer", async () => {
    const response = await request(`/api/v1/events/${EVENT_ID}/committees/${COMMITTEE_ID}/invites`, {
      method: "POST",
      body: JSON.stringify({ name: "Nora Vale", email: "nora@example.org", track_ids: [TRACK_AGENTS] }),
    }, "");
    expect([401, 403]).toContain(response.status);
  });
});
