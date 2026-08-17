import { SELF } from "cloudflare:test";
import { beforeAll, describe, expect, test } from "vitest";

import { createSession } from "../../../src/lib/auth/auth-sessions";
import { readMagicLink } from "../../../src/lib/auth/magic-links";
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
    expect(Number((await env.DB.prepare("SELECT COUNT(*) AS count FROM outbox WHERE event_id = ? AND template_key = 'portal_invite'").bind(EVENT_ID).first<{ count: number }>())?.count)).toBe(4);
    expect(Number((await env.DB.prepare("SELECT COUNT(*) AS count FROM magic_links WHERE person_id IN (?, ?)").bind(PRIYA_ID, MARCUS_ID).first<{ count: number }>())?.count)).toBe(4);
    const stored = await env.DB.prepare("SELECT purpose, created_at, expires_at, used_at FROM magic_links WHERE person_id = ? ORDER BY created_at DESC LIMIT 1").bind(PRIYA_ID).first<{ purpose: string; created_at: number; expires_at: number; used_at: number | null }>();
    expect(stored).toMatchObject({ purpose: "portal_invite", used_at: null, expires_at: expect.any(Number), created_at: expect.any(Number) });
    expect(stored!.expires_at - stored!.created_at).toBe(15 * 24 * 60 * 60_000);
    const token = new URL(result.invites[0].magic_link!).searchParams.get("token");
    expect(token).toBeTruthy();
    const firstExchange = await request(`/api/v1/auth/exchange?token=${encodeURIComponent(token!)}`, { redirect: "manual" }, "");
    const secondExchange = await request(`/api/v1/auth/exchange?token=${encodeURIComponent(token!)}`, { redirect: "manual" }, "");
    expect(firstExchange.status).toBe(302);
    expect(secondExchange.status).toBe(302);
    expect(Number((await env.DB.prepare("SELECT COUNT(*) AS count FROM magic_links WHERE purpose = 'portal_invite' AND used_at IS NOT NULL").first<{ count: number }>())?.count)).toBe(0);
    expect(await readMagicLink(env.DB, token!, stored!.expires_at, { purposes: ["portal_invite"] })).toMatchObject({ status: "expired" });
    const invitationMail = await env.DB.prepare("SELECT subject, text FROM outbox WHERE template_key = 'portal_invite' ORDER BY created_at DESC LIMIT 1").first<{ subject: string; text: string }>();
    expect(invitationMail).toMatchObject({ subject: "Your Marquee speaker portal invitation" });
    expect(invitationMail?.text).toContain("valid for 15 days");
    expect(invitationMail?.text).toContain("opened again");
  });

  /**
   * MRQ-277 D6. One ineligible recipient used to abort the whole batch, with a
   * sentence naming neither the person nor the cause: an organizer who ticked
   * forty speakers and one sponsor contact sent nothing and was not told why.
   */
  test("CONTRACT · MRQ-277 · one ineligible recipient does not cancel the batch, and is named with the reason", async () => {
    const before = Number((await env.DB.prepare("SELECT COUNT(*) AS count FROM outbox WHERE template_key = 'portal_invite'").first<{ count: number }>())?.count);
    const response = await request(`/api/v1/events/${EVENT_ID}/speakers/invite`, {
      method: "POST",
      body: JSON.stringify({ person_ids: [PRIYA_ID, OUTSIDER_ID, "person_mrq113_unknown"] }),
    });
    expect(response.status).toBe(200);
    const result = await response.json<{
      message: string;
      invites: Array<{ person_id: string }>;
      skipped: Array<{ person_id: string; name: string; reason: string }>;
    }>();

    // The eligible recipient was still invited.
    expect(result.invites.map((invite) => invite.person_id)).toEqual([PRIYA_ID]);
    expect(Number((await env.DB.prepare("SELECT COUNT(*) AS count FROM outbox WHERE template_key = 'portal_invite'").first<{ count: number }>())?.count)).toBe(before + 1);

    // And every recipient it could not reach is named, with a cause.
    expect(result.skipped.map((entry) => entry.person_id).sort()).toEqual([OUTSIDER_ID, "person_mrq113_unknown"].sort());
    const outsider = result.skipped.find((entry) => entry.person_id === OUTSIDER_ID);
    expect(outsider?.name).toBe("Other event speaker");
    expect(outsider?.reason).toContain("no speaker seat at this conference");
    expect(result.skipped.find((entry) => entry.person_id === "person_mrq113_unknown")?.reason)
      .toContain("not in this organization");
    // The operator-facing sentence carries both halves, not just the count.
    expect(result.message).toContain("1 portal invitation");
    expect(result.message).toContain("Other event speaker");
  });

  test("AC-282 + AC-283 · unauthenticated and cross-event speaker requests are refused without writes", async () => {
    const before = Number((await env.DB.prepare("SELECT COUNT(*) AS count FROM outbox").first<{ count: number }>())?.count);
    expect((await request(`/api/v1/events/${EVENT_ID}/speakers/invite`, { method: "POST", body: JSON.stringify({ person_ids: [PRIYA_ID] }) }, "")).status).toBe(401);
    expect((await request(`/api/v1/events/${EVENT_ID}/speakers/invite`, { method: "POST", body: JSON.stringify({ person_ids: [OUTSIDER_ID] }) })).status).toBe(404);
    expect(Number((await env.DB.prepare("SELECT COUNT(*) AS count FROM outbox").first<{ count: number }>())?.count)).toBe(before);
  });
});
