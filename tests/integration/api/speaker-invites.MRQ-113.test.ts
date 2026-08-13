import { SELF } from "cloudflare:test";
import { beforeAll, describe, expect, test } from "vitest";

import { createSession } from "../../../src/lib/auth/auth-sessions";
import { applyMigrations, env } from "../apply-migrations";

const ORIGIN = "https://marquee.stage11.dev";
const ORG_ID = "org_mrq113_invites";
const EVENT_ID = "evt_mrq113_invites";
const OTHER_EVENT_ID = "evt_mrq113_other";
const OWNER_ID = "person_mrq113_owner";
const PRIYA_ID = "person_mrq113_priya";
const MARCUS_ID = "person_mrq113_marcus";
const OUTSIDER_ID = "person_mrq113_outsider";
const PARTICIPATION_ID = "participation_mrq113_priya";
let ownerCookie = "";

async function seedFixture(): Promise<void> {
  await applyMigrations();
  const now = Date.parse("2026-08-12T12:00:00.000Z");
  await env.DB.batch([
    env.DB.prepare("INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").bind(ORG_ID, "MRQ-113 Invites", "mrq-113-invites", now, now),
    env.DB.prepare("INSERT INTO events (id, org_id, name, slug, starts_on, ends_on, timezone, status, demo_mode, created_at, updated_at) VALUES (?, ?, ?, ?, '2026-10-01', '2026-10-03', 'UTC', 'live', 1, ?, ?), (?, ?, ?, ?, '2026-11-01', '2026-11-03', 'UTC', 'live', 0, ?, ?)").bind(EVENT_ID, ORG_ID, "Invite Conference", "mrq-113-invites", now, now, OTHER_EVENT_ID, ORG_ID, "Other Conference", "mrq-113-other", now, now),
    env.DB.prepare("INSERT INTO people (id, org_id, email, name, title, company, bio, social_links, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, NULL, NULL, '[]', ?, ?), (?, ?, ?, ?, NULL, NULL, NULL, '[]', ?, ?), (?, ?, ?, ?, NULL, NULL, NULL, '[]', ?, ?), (?, ?, ?, ?, NULL, NULL, NULL, '[]', ?, ?)").bind(OWNER_ID, ORG_ID, "owner@mrq113.test", "Program owner", now, now, PRIYA_ID, ORG_ID, "priya@mrq113.test", "Priya Raman", now, now, MARCUS_ID, ORG_ID, "marcus@mrq113.test", "Marcus Okafor", now, now, OUTSIDER_ID, ORG_ID, "outsider@mrq113.test", "Other event speaker", now, now),
    env.DB.prepare("INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, 'program_lead', ?, ?), (?, ?, ?, ?, 'speaker', ?, ?), (?, ?, ?, ?, 'speaker', ?, ?), (?, ?, ?, ?, 'speaker', ?, ?)").bind("membership_mrq113_owner", ORG_ID, EVENT_ID, OWNER_ID, now, now, "membership_mrq113_priya", ORG_ID, EVENT_ID, PRIYA_ID, now, now, "membership_mrq113_marcus", ORG_ID, EVENT_ID, MARCUS_ID, now, now, "membership_mrq113_outsider", ORG_ID, OTHER_EVENT_ID, OUTSIDER_ID, now, now),
    env.DB.prepare("INSERT INTO submissions (id, event_id, kind, title, status, origin, submitter_person_id, created_at, updated_at) VALUES (?, ?, 'session', 'Priya session', 'accepted', 'admin', ?, ?, ?)").bind("submission_mrq113_priya", EVENT_ID, PRIYA_ID, now, now),
    env.DB.prepare("INSERT INTO participations (id, submission_id, person_id, role, position, confirmation_status, created_at, updated_at) VALUES (?, ?, ?, 'speaker', 0, 'pending', ?, ?)").bind(PARTICIPATION_ID, "submission_mrq113_priya", PRIYA_ID, now, now),
  ]);
  const session = await createSession(env.DB, { personId: OWNER_ID, roleHint: "program_lead", userAgent: "mrq113-test", now });
  ownerCookie = `mq_session=${session.id}`;
}

async function request(path: string, init: RequestInit = {}, cookie = ownerCookie): Promise<Response> {
  const headers = new Headers(init.headers);
  if (cookie) headers.set("cookie", cookie);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  return SELF.fetch(`${ORIGIN}${path}`, { ...init, headers });
}

describe.sequential("MRQ-113 portal invites", () => {
  beforeAll(seedFixture, 20_000);

  test("AC-282 + AC-283 · an organizer can invite one or many event speakers and sees demo links", async () => {
    expect((await request(`/api/v1/events/${EVENT_ID}/speakers/invite`, { method: "POST", body: JSON.stringify({ person_ids: [PRIYA_ID, MARCUS_ID] }) })).status).toBe(200);
    const result = await (await request(`/api/v1/events/${EVENT_ID}/speakers/invite`, { method: "POST", body: JSON.stringify({ person_ids: [PRIYA_ID, MARCUS_ID] }) })).json<{
      ok: boolean;
      message: string;
      invites: Array<{ person_id: string; outbox_id: string; magic_link?: string }>;
    }>();
    expect(result).toMatchObject({ ok: true, invites: [{ person_id: PRIYA_ID }, { person_id: MARCUS_ID }] });
    expect(result.message).toContain("queued");
    expect(result.invites.every((invite) => invite.magic_link?.includes("/api/v1/auth/exchange?token=") === true)).toBe(true);
    expect(await env.DB.prepare("SELECT invited_at FROM participations WHERE id = ?").bind(PARTICIPATION_ID).first<{ invited_at: number }>()).toMatchObject({ invited_at: expect.any(Number) });
    expect(Number((await env.DB.prepare("SELECT COUNT(*) AS count FROM outbox WHERE event_id = ? AND template_key = 'magic_link_login'").bind(EVENT_ID).first<{ count: number }>())?.count)).toBe(4);
    expect(Number((await env.DB.prepare("SELECT COUNT(*) AS count FROM magic_links WHERE person_id IN (?, ?)").bind(PRIYA_ID, MARCUS_ID).first<{ count: number }>())?.count)).toBe(4);
  });

  test("AC-282 + AC-283 · unauthenticated and cross-event speaker requests are refused without writes", async () => {
    const before = Number((await env.DB.prepare("SELECT COUNT(*) AS count FROM outbox").first<{ count: number }>())?.count);
    expect((await request(`/api/v1/events/${EVENT_ID}/speakers/invite`, { method: "POST", body: JSON.stringify({ person_ids: [PRIYA_ID] }) }, "")).status).toBe(401);
    expect((await request(`/api/v1/events/${EVENT_ID}/speakers/invite`, { method: "POST", body: JSON.stringify({ person_ids: [OUTSIDER_ID] }) })).status).toBe(404);
    expect(Number((await env.DB.prepare("SELECT COUNT(*) AS count FROM outbox").first<{ count: number }>())?.count)).toBe(before);
  });
});
