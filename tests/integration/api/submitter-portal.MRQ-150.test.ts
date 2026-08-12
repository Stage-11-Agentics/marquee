/**
 * MRQ-150 · The public CFP's confirmation link must not dead-end.
 *
 * The walkthrough's most-demoed action ends on a confirmation page that offers a
 * link into the portal. Every portal test before this one authenticated a person
 * the fixture had already granted `memberships.role = 'speaker'`, so the portal
 * always resolved a conference and the dead end was invisible: a person who
 * arrives through the public form holds a `participations` row with role
 * `submitter` and no membership at all.
 *
 * So this file refuses the shortcut. It submits through the real public form,
 * follows the real magic link the confirmation page hands back, and asks the
 * portal what that session sees — the exact sequence a judge clicks. SPEC §10
 * (Amendment 15) rules the answer: one honest empty state for the submitter
 * seat, not a speaker membership granted behind their back.
 */
import { beforeEach, describe, expect, test } from "vitest";
import { SELF } from "cloudflare:test";

import { applyMigrations, env } from "../apply-migrations";

const ORIGIN = "https://marquee.stage11.dev";
const EVENT_ID = "evt_submitter_portal";
const ORG_ID = "org_submitter_portal";
const FORM_ID = "form_submitter_cfp";
const NOW = Date.UTC(2026, 7, 20, 16, 0, 0);

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has("content-type")) headers.set("content-type", "application/json");
  return SELF.fetch(`${ORIGIN}${path}`, { ...init, headers, redirect: "manual" });
}

async function json<T>(response: Response): Promise<T> {
  return response.json<T>();
}

async function seed(): Promise<void> {
  await applyMigrations();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .bind(ORG_ID, "Submitter Portal Org", "submitter-portal", NOW, NOW),
    // demo_mode = 1 is what makes the confirmation page offer the portal link at
    // all, so the fixture must carry it or this test would prove nothing.
    env.DB.prepare(`INSERT INTO events (id, org_id, name, slug, starts_on, ends_on, timezone, status, demo_mode, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'live', 1, ?, ?)`)
      .bind(EVENT_ID, ORG_ID, "Walkthrough Conference", "walkthrough-conference", "2026-10-12", "2026-10-14", "America/New_York", NOW, NOW),
    env.DB.prepare("INSERT INTO formats (id, event_id, name, default_duration_min, min_duration_min, max_duration_min, position, created_at, updated_at) VALUES (?, ?, ?, 20, 15, 30, 0, ?, ?)")
      .bind("format_stage", EVENT_ID, "Stage Talk", NOW, NOW),
    env.DB.prepare("INSERT INTO tracks (id, event_id, name, color, position, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)")
      .bind("track_agents", EVENT_ID, "Agents", "#db4c3f", NOW, NOW),
    env.DB.prepare(`INSERT INTO waves (id, event_id, name, decision_on, target_count, sent_at, position, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NULL, 0, ?, ?)`)
      .bind("wave_submitter_next", EVENT_ID, "Wave 1", "2026-09-21", 20, NOW, NOW),
    env.DB.prepare(`INSERT INTO forms
      (id, event_id, name, slug, kind, status, opens_at, closes_at, welcome_md,
       per_submitter_limit, min_speakers, max_speakers, max_sponsors,
       admin_notify_person_ids, turnstile_required, created_at, updated_at)
      VALUES (?, ?, 'Call for Speakers', 'submitter-cfp', 'abstract', 'open', ?, ?, '', 3, 1, 4, 0, '[]', 0, ?, ?)`)
      .bind(FORM_ID, EVENT_ID, 0, Date.UTC(2099, 0, 1), NOW, NOW),
    env.DB.prepare(`INSERT INTO form_fields
      (id, form_id, key, label, help_text, type, required, position, config, condition, created_at, updated_at)
      VALUES
      ('field_sp_title', ?, 'title', 'Session title', NULL, 'short_text', 1, 0, '{"maxLength":80}', NULL, ?, ?),
      ('field_sp_name', ?, 'speaker_name', 'Primary speaker name', NULL, 'short_text', 1, 1, '{}', NULL, ?, ?),
      ('field_sp_email', ?, 'speaker_email', 'Primary speaker email', NULL, 'email', 1, 2, '{}', NULL, ?, ?),
      ('field_sp_tracks', ?, 'tracks', 'Tracks', NULL, 'multi_select', 1, 3, ?, NULL, ?, ?)`)
      .bind(
        FORM_ID, NOW, NOW,
        FORM_ID, NOW, NOW,
        FORM_ID, NOW, NOW,
        FORM_ID, JSON.stringify({ options: ["Agents"] }), NOW, NOW,
      ),
  ]);
}

/** Walk the public form exactly as the confirmation page's visitor does. */
async function submitAndFollowPortalLink(input: { title: string; name: string; email: string }): Promise<{ cookie: string; portalUrl: string }> {
  const submitted = await request("/api/v1/public/forms/submitter-cfp/submissions", {
    method: "POST",
    body: JSON.stringify({
      answers: {
        title: input.title,
        speaker_name: input.name,
        speaker_email: input.email,
        tracks: ["Agents"],
      },
    }),
  });
  expect(submitted.status).toBe(201);
  const body = await json<{ confirmation: { portal_url: string | null } | null }>(submitted);
  const portalUrl = body.confirmation?.portal_url ?? "";
  expect(portalUrl).toContain("/api/v1/auth/exchange?token=");

  const exchanged = await request(new URL(portalUrl).pathname + new URL(portalUrl).search);
  expect(exchanged.status).toBe(302);
  expect(exchanged.headers.get("location")).toBe("/portal");
  const setCookie = exchanged.headers.get("set-cookie") ?? "";
  expect(setCookie).toContain("mq_session=");
  return { cookie: setCookie.split(";")[0], portalUrl };
}

describe.sequential("MRQ-150 the submitter's portal", () => {
  beforeEach(async () => {
    await seed();
  });

  test("CONTRACT · MRQ-150 · the confirmation link lands on a real portal, not a 404", async () => {
    const { cookie } = await submitAndFollowPortalLink({
      title: "Shipping agents that answer the phone",
      name: "Avery Example",
      email: "avery@example.com",
    });

    const portal = await request("/api/v1/me/portal", { headers: { cookie } });
    // The defect: this answered 404 "conference not found" because the person
    // holds no speaker membership. Assert the status *and* a body, so a future
    // regression cannot pass by returning an empty 200.
    expect(portal.status).toBe(200);
    const snapshot = await json<{
      seat: string;
      event: { name: string };
      person: { name: string; email: string };
      submissions: Array<{ title: string; status: string; role: string; wave_decision_on: string | null }>;
    }>(portal);
    expect(snapshot.seat).toBe("submitter");
    expect(snapshot.event.name).toBe("Walkthrough Conference");
    expect(snapshot.person.email).toBe("avery@example.com");
    expect(snapshot.submissions).toHaveLength(1);
    expect(snapshot.submissions[0].title).toBe("Shipping agents that answer the phone");
    expect(snapshot.submissions[0].status).toBe("submitted");
    expect(snapshot.submissions[0].role).toBe("submitter");
  });

  test("CONTRACT · MRQ-150 · the empty state names the date a decision arrives, so the next step is real", async () => {
    const { cookie } = await submitAndFollowPortalLink({
      title: "Evaluations that survive contact with production",
      name: "Robin Example",
      email: "robin@example.com",
    });

    const snapshot = await json<{ submissions: Array<{ wave_name: string | null; wave_decision_on: string | null }> }>(
      await request("/api/v1/me/portal", { headers: { cookie } }),
    );
    // The abstract carries no wave of its own yet, so the portal falls back to
    // the next unsent wave — the same promise the speaker portal makes.
    expect(snapshot.submissions[0].wave_name).toBe("Wave 1");
    expect(snapshot.submissions[0].wave_decision_on).toBe("2026-09-21");
  });

  test("CONTRACT · MRQ-150 · the submitter seat carries no speaker surface, and no speaker membership is invented", async () => {
    const { cookie } = await submitAndFollowPortalLink({
      title: "Retrieval without the vector database",
      name: "Sam Example",
      email: "sam@example.com",
    });

    const snapshot = await json<{ seat: string; tasks: unknown[]; handbook: { markdown: string } }>(
      await request("/api/v1/me/portal", { headers: { cookie } }),
    );
    expect(snapshot.seat).toBe("submitter");
    expect(snapshot.tasks).toEqual([]);
    expect(snapshot.handbook.markdown).toBe("");

    // SPEC §10 keeps the two seats distinct. The fix must not quietly promote a
    // submitter into a speaker — that is the state-model change it rules out.
    const membership = await env.DB
      .prepare("SELECT COUNT(*) AS total FROM memberships WHERE event_id = ? AND role = 'speaker'")
      .bind(EVENT_ID)
      .first<{ total: number }>();
    expect(Number(membership?.total ?? 0)).toBe(0);

    // And the seat stays read-only: profile editing belongs to a speaker.
    const profile = await request("/api/v1/me/profile", {
      method: "PATCH",
      headers: { cookie },
      body: JSON.stringify({ bio: "should not apply" }),
    });
    expect(profile.status).toBe(404);
  });

  test("CONTRACT · MRQ-150 · a session with neither a speaker role nor a submission still gets the honest 404", async () => {
    const { cookie } = await submitAndFollowPortalLink({
      title: "The talk that will be withdrawn",
      name: "Jordan Example",
      email: "jordan@example.com",
    });
    // Strip the one thing that gave this person a seat. Nothing else changes.
    await env.DB.prepare("DELETE FROM participations").run();

    const portal = await request("/api/v1/me/portal", { headers: { cookie } });
    expect(portal.status).toBe(404);
    expect((await json<{ error: { message: string } }>(portal)).error.message).toBe("conference not found");
  });

  test("CONTRACT · MRQ-150 · one submitter never sees another submitter's abstract", async () => {
    const first = await submitAndFollowPortalLink({
      title: "Avery's abstract",
      name: "Avery Example",
      email: "avery@example.com",
    });
    const second = await submitAndFollowPortalLink({
      title: "Robin's abstract",
      name: "Robin Example",
      email: "robin@example.com",
    });

    const seen = async (cookie: string) =>
      (await json<{ submissions: Array<{ title: string }> }>(await request("/api/v1/me/portal", { headers: { cookie } })))
        .submissions.map((submission) => submission.title);

    expect(await seen(first.cookie)).toEqual(["Avery's abstract"]);
    expect(await seen(second.cookie)).toEqual(["Robin's abstract"]);
  });
});
