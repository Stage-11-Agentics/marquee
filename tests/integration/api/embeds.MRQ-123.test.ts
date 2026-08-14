import { beforeEach, expect, test } from "vitest";

import { app } from "../../../src/index";
import { applyMigrations, env } from "../apply-migrations";

const ORIGIN = "https://marquee.stage11.dev";
const EVENT_ID = "evt_saved_embeds_mrq123";
const SESSION_ID = "session_saved_embeds_mrq123";
const PERSON_ID = "person_saved_embeds_mrq123";
const COOKIE = `mq_session=${SESSION_ID}`;

async function request(path: string, init: RequestInit = {}, cookie = COOKIE): Promise<Response> {
  return app.request(`${ORIGIN}${path}`, { ...init, headers: { cookie, ...(init.headers ?? {}) } }, env);
}

beforeEach(async () => {
  await applyMigrations();
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").bind("org_saved_embeds_mrq123", "Saved embeds", "saved-embeds-mrq123", now, now),
    env.DB.prepare(`INSERT INTO events (id, org_id, name, slug, tagline, starts_on, ends_on, timezone, venue, status, demo_mode, created_at, updated_at)
      VALUES (?, 'org_saved_embeds_mrq123', 'Saved embeds conference', 'saved-embeds-mrq123', NULL, '2026-10-12', '2026-10-14', 'America/New_York', NULL, 'live', 1, ?, ?)`).bind(EVENT_ID, now, now),
    env.DB.prepare(`INSERT INTO people (id, org_id, email, name, title, company, bio, headshot_attachment_id, social_links, is_demo, last_write_source, created_at, updated_at)
      VALUES (?, 'org_saved_embeds_mrq123', 'operator@example.com', 'Embed Operator', NULL, NULL, NULL, NULL, '[]', 1, 'marquee', ?, ?)`).bind(PERSON_ID, now, now),
    env.DB.prepare("INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at) VALUES ('membership_saved_embeds_mrq123', 'org_saved_embeds_mrq123', ?, ?, 'program_lead', ?, ?)").bind(EVENT_ID, PERSON_ID, now, now),
    env.DB.prepare(`INSERT INTO auth_sessions (id, person_id, role_hint, expires_at, user_agent_hash, revoked_at, created_at, updated_at)
      VALUES (?, ?, 'program_lead', ?, 'saved-embeds-mrq123', NULL, ?, ?)`).bind(SESSION_ID, PERSON_ID, now + 3_600_000, now, now),
  ]);
});

test("CONTRACT · EMB-15 · the HTML snippet a saved embed hands over carries a height", async () => {
  // sbek round 11, manual: the generated iframe carried width and border and no
  // height, so pasted onto a third-party page it rendered at the browser
  // default 150px — the visitor saw the header and the filter bar and
  // essentially none of the programme. Content was never the problem; setting a
  // height by hand revealed the whole correct widget.
  const created = await request(`/api/v1/events/${EVENT_ID}/embeds`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Main site agenda", kind: "agenda", output_format: "html", track: null, status: null, layout: null, accent: null }),
  });
  expect(created.status).toBe(201);
  const { data } = await created.json() as { data: { snippet: string } };

  expect(data.snippet).toContain("<iframe");
  // Twice: measured, a host CSP that permits the frame and blocks inline styles
  // reverts the style-only frame to the 150px default while the attribute holds.
  // Neither survives a host `iframe { height: … !important }` rule, and the
  // snippet does not claim to.
  expect(data.snippet).toMatch(/ height="\d+"/);
  expect(data.snippet).toMatch(/style="[^"]*height:\d+px/);
  // The two it always had are still there.
  expect(data.snippet).toContain("width:100%");
  expect(data.snippet).toContain("border:0");
  expect(data.snippet).not.toContain('style="width:100%;border:0"');
});

test("CONTRACT · EMB-15 · saved embeds require organizer grants and return named, toggleable code", async () => {
  const unauthenticated = await request(`/api/v1/events/${EVENT_ID}/embeds`, {}, "");
  expect(unauthenticated.status).toBe(401);

  const created = await request(`/api/v1/events/${EVENT_ID}/embeds`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Main site agenda", kind: "agenda", output_format: "json", track: "track-main", status: null, layout: null, accent: "#0b6a72" }),
  });
  expect(created.status).toBe(201);
  const createdBody = await created.json() as { data: { id: string; name: string; slug: string; enabled: boolean; snippet: string } };
  expect(createdBody.data).toMatchObject({ name: "Main site agenda", enabled: true });
  expect(createdBody.data.slug).toMatch(/^embed-[0-9a-z]+$/);
  expect(createdBody.data.snippet).toContain(`/api/v1/public/embeds/${createdBody.data.slug}`);

  const disabled = await request(`/api/v1/events/${EVENT_ID}/embeds/${createdBody.data.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ enabled: false }),
  });
  expect(disabled.status).toBe(200);
  expect((await disabled.json() as { data: { enabled: boolean } }).data.enabled).toBe(false);
  const resolved = await env.DB.prepare("SELECT enabled FROM embeds WHERE id = ?").bind(createdBody.data.id).first<{ enabled: number }>();
  expect(resolved?.enabled).toBe(0);
  const hidden = await request(`/api/v1/public/embeds/${createdBody.data.slug}`, {}, "");
  expect(hidden.status).toBe(404);

  const listed = await request(`/api/v1/events/${EVENT_ID}/embeds`);
  expect(listed.status).toBe(200);
  expect((await listed.json() as { data: Array<{ name: string; enabled: boolean }> }).data).toEqual([
    expect.objectContaining({ name: "Main site agenda", enabled: false }),
  ]);
});

test("CONTRACT · EMB-15 · XML is advertised in saved embeds and invalid output is rejected", async () => {
  const response = await request(`/api/v1/events/${EVENT_ID}/embeds`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "XML program feed", kind: "agenda", output_format: "xml", fields: ["title", "location"] }),
  });
  expect(response.status).toBe(201);
  const created = await response.json() as { data: { output_format: string; fields: string[]; snippet: string } };
  expect(created.data.output_format).toBe("xml");
  expect(created.data.fields).toEqual(["title", "location"]);
  expect(created.data.snippet).toContain("/api/v1/public/embeds/");
  expect(created.data.snippet).toContain("/xml");

  const invalid = await request(`/api/v1/events/${EVENT_ID}/embeds`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "RSS should stay out", kind: "agenda", output_format: "rss" }),
  });
  expect(invalid.status).toBe(400);
});
