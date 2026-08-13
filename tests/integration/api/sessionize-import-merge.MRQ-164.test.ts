/**
 * MRQ-164 Part 3 — the Sessionize import is an import, never an erase.
 *
 * A blank CSV cell means "this export does not carry that field", not "delete
 * what the speaker wrote in their portal". A filled cell that disagrees is
 * last-write-wins, and the row reason says which fields moved and which stayed.
 */
import { SELF } from "cloudflare:test";
import { beforeAll, describe, expect, test } from "vitest";

import { createSession } from "../../../src/lib/auth/auth-sessions";
import { applyMigrations, env } from "../apply-migrations";

const ORIGIN = "https://marquee.stage11.dev";
const EVENT_ID = "evt_mrq164_import";
const ORG_ID = "org_mrq164_import";
const OWNER_ID = "person_mrq164_owner";
const EXISTING_ID = "person_mrq164_existing";
const PORTAL_BIO = "A careful, speaker-written biography that took an afternoon to get right.";

const SPEAKERS_CSV = [
  "Speaker ID,Name,Email,Job Title,Company,Bio,Photo URL",
  // Blank bio, blank company; a title that disagrees with what is stored.
  "speaker-priya,Priya Raman,priya@mrq164.test,Staff Engineer,,,",
].join("\n");

const SESSIONS_CSV = [
  "Session ID,Title,Description,Status,Speaker Ids,Session format,Track",
  "sess-mrq164,Taming 40-Minute CI,An import fixture.,Accepted,speaker-priya,Talk,Platform",
].join("\n");

let ownerCookie = "";

async function seedFixture(): Promise<void> {
  await applyMigrations();
  const now = Date.parse("2026-08-13T12:00:00.000Z");
  await env.DB.batch([
    env.DB.prepare("INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").bind(ORG_ID, "MRQ-164 Import", "mrq-164-import", now, now),
    env.DB.prepare("INSERT INTO events (id, org_id, name, slug, starts_on, ends_on, timezone, status, demo_mode, created_at, updated_at) VALUES (?, ?, 'Merge Conference', 'mrq-164-import', '2026-10-01', '2026-10-03', 'UTC', 'live', 0, ?, ?)").bind(EVENT_ID, ORG_ID, now, now),
    env.DB.prepare("INSERT INTO formats (id, event_id, name, default_duration_min, min_duration_min, max_duration_min, position, created_at, updated_at) VALUES ('format_mrq164_talk', ?, 'Talk', 45, 15, 90, 0, ?, ?)").bind(EVENT_ID, now, now),
    env.DB.prepare("INSERT INTO tracks (id, event_id, name, color, position, created_at, updated_at) VALUES ('track_mrq164_platform', ?, 'Platform', '#0d9488', 0, ?, ?)").bind(EVENT_ID, now, now),
    env.DB.prepare("INSERT INTO people (id, org_id, email, name, title, company, bio, headshot_attachment_id, social_links, is_demo, last_write_source, created_at, updated_at) VALUES (?, ?, 'owner@mrq164.test', 'MRQ-164 Owner', NULL, NULL, NULL, NULL, '[]', 0, 'marquee', ?, ?)").bind(OWNER_ID, ORG_ID, now, now),
    env.DB.prepare("INSERT INTO people (id, org_id, email, name, title, company, bio, headshot_attachment_id, social_links, is_demo, last_write_source, created_at, updated_at) VALUES (?, ?, 'priya@mrq164.test', 'Priya Raman', 'Principal Engineer', 'Northwind Data', ?, NULL, '[]', 0, 'marquee', ?, ?)").bind(EXISTING_ID, ORG_ID, PORTAL_BIO, now, now),
    env.DB.prepare("INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at) VALUES ('membership_mrq164_owner', ?, ?, ?, 'program_lead', ?, ?)").bind(ORG_ID, EVENT_ID, OWNER_ID, now, now),
  ]);
  ownerCookie = `mq_session=${(await createSession(env.DB, { personId: OWNER_ID, roleHint: "program_lead", userAgent: "mrq164-test", now })).id}`;
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("cookie", ownerCookie);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  return SELF.fetch(`${ORIGIN}${path}`, { ...init, headers });
}

describe.sequential("MRQ-164 Sessionize import merge", () => {
  beforeAll(seedFixture, 20_000);

  test("a blank CSV cell keeps the stored value while a filled one wins, and the row says which", async () => {
    const uploaded = await request(`/api/v1/events/${EVENT_ID}/imports`, {
      method: "POST",
      body: JSON.stringify({ source: "sessionize", sessions_csv: SESSIONS_CSV, speakers_csv: SPEAKERS_CSV }),
    });
    expect(uploaded.status).toBe(201);
    const uploadBody = await uploaded.json<{ id: string; mapping: Record<string, Record<string, string | null>> }>();
    expect((await request(`/api/v1/events/${EVENT_ID}/imports/${uploadBody.id}/mapping`, { method: "POST", body: JSON.stringify(uploadBody.mapping) })).status).toBe(200);

    const run = await request(`/api/v1/events/${EVENT_ID}/imports/${uploadBody.id}/run`, { method: "POST" });
    expect(run.status).toBe(200);
    const result = await run.json<{ rows: Array<{ entity: string; outcome: string; reason: string | null }> }>();

    const person = await env.DB.prepare("SELECT title, company, bio FROM people WHERE id = ?").bind(EXISTING_ID).first<{ title: string | null; company: string | null; bio: string | null }>();
    // The speaker's own words survive an export that never carried them.
    expect(person?.bio).toBe(PORTAL_BIO);
    expect(person?.company).toBe("Northwind Data");
    // A filled cell that disagrees is last-write-wins.
    expect(person?.title).toBe("Staff Engineer");

    const speakerRow = result.rows.find((row) => row.entity === "speaker");
    expect(speakerRow?.outcome).toBe("updated");
    expect(speakerRow?.reason).toContain("matched by normalized email");
    expect(speakerRow?.reason).toContain("overwrote title");
    expect(speakerRow?.reason).toContain("kept company, bio (blank in CSV)");
  });

  test("a created row does not claim it matched an existing person", async () => {
    const csv = [
      "Speaker ID,Name,Email,Job Title,Company,Bio,Photo URL",
      "speaker-newcomer,Dana Kowalski,dana@mrq164.test,Researcher,Cloudreach,Writes about evaluation.,",
    ].join("\n");
    const sessions = [
      "Session ID,Title,Description,Status,Speaker Ids,Session format,Track",
      "sess-mrq164-two,Evaluating agents,An import fixture.,Accepted,speaker-newcomer,Talk,Platform",
    ].join("\n");
    const uploaded = await request(`/api/v1/events/${EVENT_ID}/imports`, {
      method: "POST",
      body: JSON.stringify({ source: "sessionize", sessions_csv: sessions, speakers_csv: csv }),
    });
    const uploadBody = await uploaded.json<{ id: string; mapping: Record<string, Record<string, string | null>> }>();
    await request(`/api/v1/events/${EVENT_ID}/imports/${uploadBody.id}/mapping`, { method: "POST", body: JSON.stringify(uploadBody.mapping) });
    const result = await (await request(`/api/v1/events/${EVENT_ID}/imports/${uploadBody.id}/run`, { method: "POST" })).json<{ rows: Array<{ entity: string; outcome: string; reason: string | null }> }>();

    const speakerRow = result.rows.find((row) => row.entity === "speaker");
    expect(speakerRow?.outcome).toBe("created");
    expect(speakerRow?.reason).not.toContain("matched");
  });
});
