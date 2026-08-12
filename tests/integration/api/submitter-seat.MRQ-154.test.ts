/**
 * MRQ-154 · CFP-05 is not satisfied by a successful magic-link exchange alone.
 *
 * A public submitter has no speaker membership before a decision. Their
 * participation is the only authority that can locate the conference, and it
 * must expose only that submitter's own abstract. This is intentionally an
 * independent walk of the public-form -> magic-link -> portal chain, so the
 * status answer cannot regress behind a friendly 200 response.
 */
import { beforeEach, describe, expect, test } from "vitest";
import { SELF } from "cloudflare:test";

import { applyMigrations, env } from "../apply-migrations";

const ORIGIN = "https://marquee.stage11.dev";
const EVENT_ID = "evt_mrq154_submitter_seat";
const ORG_ID = "org_mrq154_submitter_seat";
const FORM_ID = "form_mrq154_submitter_seat";
const NOW = Date.UTC(2026, 7, 20, 16, 0, 0);

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has("content-type")) headers.set("content-type", "application/json");
  return SELF.fetch(`${ORIGIN}${path}`, { ...init, headers, redirect: "manual" });
}

async function seed(): Promise<void> {
  await applyMigrations();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .bind(ORG_ID, "MRQ-154 CFP Org", "mrq-154-cfp", NOW, NOW),
    env.DB.prepare(`INSERT INTO events (id, org_id, name, slug, starts_on, ends_on, timezone, status, demo_mode, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'live', 1, ?, ?)`)
      .bind(EVENT_ID, ORG_ID, "CFP-05 Conference", "cfp-05-conference", "2026-10-12", "2026-10-14", "America/New_York", NOW, NOW),
    env.DB.prepare("INSERT INTO formats (id, event_id, name, default_duration_min, min_duration_min, max_duration_min, position, created_at, updated_at) VALUES (?, ?, ?, 20, 15, 30, 0, ?, ?)")
      .bind("format_mrq154_stage", EVENT_ID, "Stage Talk", NOW, NOW),
    env.DB.prepare("INSERT INTO tracks (id, event_id, name, color, position, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)")
      .bind("track_mrq154_agents", EVENT_ID, "Agents", "#0b6a72", NOW, NOW),
    env.DB.prepare(`INSERT INTO forms
      (id, event_id, name, slug, kind, status, opens_at, closes_at, welcome_md,
       per_submitter_limit, min_speakers, max_speakers, max_sponsors,
       admin_notify_person_ids, turnstile_required, created_at, updated_at)
      VALUES (?, ?, 'Call for Speakers', 'mrq-154-cfp', 'abstract', 'open', ?, ?, '', 3, 1, 4, 0, '[]', 0, ?, ?)`)
      .bind(FORM_ID, EVENT_ID, 0, Date.UTC(2099, 0, 1), NOW, NOW),
    env.DB.prepare(`INSERT INTO form_fields
      (id, form_id, key, label, help_text, type, required, position, config, condition, created_at, updated_at)
      VALUES
      ('field_mrq154_title', ?, 'title', 'Session title', NULL, 'short_text', 1, 0, '{"maxLength":80}', NULL, ?, ?),
      ('field_mrq154_name', ?, 'speaker_name', 'Primary speaker name', NULL, 'short_text', 1, 1, '{}', NULL, ?, ?),
      ('field_mrq154_email', ?, 'speaker_email', 'Primary speaker email', NULL, 'email', 1, 2, '{}', NULL, ?, ?),
      ('field_mrq154_tracks', ?, 'tracks', 'Tracks', NULL, 'multi_select', 1, 3, ?, NULL, ?, ?)`)
      .bind(
        FORM_ID, NOW, NOW,
        FORM_ID, NOW, NOW,
        FORM_ID, NOW, NOW,
        FORM_ID, JSON.stringify({ options: ["Agents"] }), NOW, NOW,
      ),
  ]);
}

async function submitAndExchange(input: { title: string; name: string; email: string }): Promise<string> {
  const submitted = await request("/api/v1/public/forms/mrq-154-cfp/submissions", {
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
  const confirmation = await submitted.json<{ confirmation: { portal_url: string | null } | null }>();
  const portalUrl = confirmation.confirmation?.portal_url ?? "";
  expect(portalUrl).toContain("/api/v1/auth/exchange?token=");

  const exchangeUrl = new URL(portalUrl);
  const exchanged = await request(`${exchangeUrl.pathname}${exchangeUrl.search}`);
  expect(exchanged.status).toBe(302);
  expect(exchanged.headers.get("location")).toBe("/portal");
  const cookie = (exchanged.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  expect(cookie).toContain("mq_session=");
  return cookie;
}

describe.sequential("CONTRACT · MRQ-154 · CFP-05 submitter seat", () => {
  beforeEach(async () => {
    await seed();
  });

  test("CONTRACT · MRQ-154 · participation alone resolves one submitter's own proposal and nothing else", async () => {
    const firstTitle = "The proposal that belongs to Avery";
    const secondTitle = "The proposal that must stay private";
    const firstCookie = await submitAndExchange({ title: firstTitle, name: "Avery Submitter", email: "avery@example.com" });
    const secondCookie = await submitAndExchange({ title: secondTitle, name: "Briar Submitter", email: "briar@example.com" });

    const firstPortal = await request("/api/v1/me/portal", { headers: { cookie: firstCookie } });
    expect(firstPortal.status).toBe(200);
    const firstSnapshot = await firstPortal.json<{
      seat: string;
      submissions: Array<{ title: string; status: string }>;
    }>();
    expect(firstSnapshot.seat).toBe("submitter");
    expect(firstSnapshot.submissions).toEqual([{ title: firstTitle, status: "submitted" }]);
    expect(JSON.stringify(firstSnapshot)).not.toContain(secondTitle);

    const secondPortal = await request("/api/v1/me/portal", { headers: { cookie: secondCookie } });
    expect(secondPortal.status).toBe(200);
    const secondSnapshot = await secondPortal.json<{ submissions: Array<{ title: string; status: string }> }>();
    expect(secondSnapshot.submissions).toEqual([{ title: secondTitle, status: "submitted" }]);

    const memberships = await env.DB
      .prepare("SELECT COUNT(*) AS total FROM memberships WHERE event_id = ? AND role = 'speaker'")
      .bind(EVENT_ID)
      .first<{ total: number }>();
    expect(Number(memberships?.total ?? 0)).toBe(0);
  });
});
