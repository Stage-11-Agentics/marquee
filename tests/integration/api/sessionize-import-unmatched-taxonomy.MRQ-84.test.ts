import { SELF } from "cloudflare:test";
import { beforeAll, describe, expect, test } from "vitest";

import sessionsCsv from "../../../fixtures/sessionize/sessions.csv?raw";
import speakersCsv from "../../../fixtures/sessionize/speakers.csv?raw";
import { createSession } from "../../../src/lib/auth/auth-sessions";
import { applyMigrations, env } from "../apply-migrations";

const ORIGIN = "https://marquee.stage11.dev";
const EVENT_ID = "evt_mrq84_taxonomy";
const ORG_ID = "org_mrq84_taxonomy";
const OWNER_ID = "person_mrq84_owner";

let ownerCookie = "";

/**
 * The point of this fixture is the mismatch. `fixtures/sessionize/sessions.csv`
 * carries tracks Platform/Operations and formats Talk/Workshop; this event is
 * configured with tracks Agents/Security and formats Lightning/Workshop, the way
 * a real organizer's Marquee configuration differs from their Sessionize export.
 * Only `Workshop` overlaps, which is what lets one row prove the matched half
 * stays silent while the unmatched half speaks.
 */
async function seedFixture(): Promise<void> {
  await applyMigrations();
  const now = Date.parse("2026-08-11T12:00:00.000Z");
  await env.DB.batch([
    env.DB.prepare("INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").bind(ORG_ID, "MRQ-84 Taxonomy", "mrq-84-taxonomy", now, now),
    env.DB.prepare("INSERT INTO events (id, org_id, name, slug, starts_on, ends_on, timezone, status, demo_mode, created_at, updated_at) VALUES (?, ?, 'Taxonomy Conference', 'mrq-84-taxonomy', '2026-10-01', '2026-10-03', 'UTC', 'live', 0, ?, ?)").bind(EVENT_ID, ORG_ID, now, now),
    env.DB.prepare("INSERT INTO formats (id, event_id, name, default_duration_min, min_duration_min, max_duration_min, position, created_at, updated_at) VALUES ('format_mrq84_lightning', ?, 'Lightning', 15, 5, 30, 0, ?, ?), ('format_mrq84_workshop', ?, 'Workshop', 90, 30, 180, 1, ?, ?)").bind(EVENT_ID, now, now, EVENT_ID, now, now),
    env.DB.prepare("INSERT INTO tracks (id, event_id, name, color, position, created_at, updated_at) VALUES ('track_mrq84_agents', ?, 'Agents', '#0d9488', 0, ?, ?), ('track_mrq84_security', ?, 'Security', '#d97706', 1, ?, ?)").bind(EVENT_ID, now, now, EVENT_ID, now, now),
    env.DB.prepare("INSERT INTO people (id, org_id, email, name, title, company, bio, headshot_attachment_id, social_links, is_demo, last_write_source, created_at, updated_at) VALUES (?, ?, 'owner@mrq84.test', 'MRQ-84 Owner', NULL, NULL, NULL, NULL, '[]', 0, 'marquee', ?, ?)").bind(OWNER_ID, ORG_ID, now, now),
    env.DB.prepare("INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at) VALUES ('membership_mrq84_owner', ?, ?, ?, 'program_lead', ?, ?)").bind(ORG_ID, EVENT_ID, OWNER_ID, now, now),
  ]);
  ownerCookie = `mq_session=${(await createSession(env.DB, { personId: OWNER_ID, roleHint: "program_lead", userAgent: "mrq84-test", now })).id}`;
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("cookie", ownerCookie);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  return SELF.fetch(`${ORIGIN}${path}`, { ...init, headers });
}

interface RunResult {
  counts: Record<string, number>;
  rows: Array<{ entity: string; outcome: string; reason: string | null }>;
}

async function runImport(): Promise<RunResult> {
  const uploaded = await request(`/api/v1/events/${EVENT_ID}/imports`, { method: "POST", body: JSON.stringify({ source: "sessionize", sessions_csv: sessionsCsv, speakers_csv: speakersCsv }) });
  expect(uploaded.status).toBe(201);
  const uploadBody = await uploaded.json<{ id: string; mapping: unknown }>();
  const mapped = await request(`/api/v1/events/${EVENT_ID}/imports/${uploadBody.id}/mapping`, { method: "POST", body: JSON.stringify(uploadBody.mapping) });
  expect(mapped.status).toBe(200);
  const run = await request(`/api/v1/events/${EVENT_ID}/imports/${uploadBody.id}/run`, { method: "POST" });
  expect(run.status).toBe(200);
  return run.json<RunResult>();
}

function sessionReasons(result: RunResult): string[] {
  return result.rows.filter((row) => row.entity === "session").map((row) => row.reason ?? "");
}

describe.sequential("MRQ-84 unmatched Sessionize taxonomy", () => {
  beforeAll(seedFixture, 20_000);

  test("AC-110 · a row whose track and format this event does not use still imports, and says so", async () => {
    const result = await runImport();
    const reasons = sessionReasons(result);

    // The silent drop this ticket exists for: the row succeeds, the
    // categorization is gone, and nothing said a word.
    expect(reasons.some((reason) => reason.includes('track "Platform" not recognized, left unset'))).toBe(true);
    expect(reasons.some((reason) => reason.includes('format "Talk" not recognized, left unset'))).toBe(true);

    // The resolution behaviour itself is unchanged: an unrecognized name must
    // still import the row rather than fail it, or the importer's
    // duplicate-safety story breaks.
    expect(result.counts.created).toBeGreaterThan(0);
    const dropped = await env.DB.prepare("SELECT primary_track_id, format_id FROM submissions WHERE event_id = ? AND external_ref = 'sess-trust-101'").bind(EVENT_ID).first<{ primary_track_id: string | null; format_id: string | null }>();
    expect(dropped).toMatchObject({ primary_track_id: null, format_id: null });
  }, 20_000);

  test("AC-110 · a format this event does use is never mentioned, so the note stays signal", async () => {
    // sess-trust-102 is Track "Operations" (unmatched) + Format "Workshop"
    // (matched). If the matched half also warned, the message would fire on
    // every row of every import and mean nothing.
    const row = await env.DB.prepare("SELECT reason FROM import_rows WHERE entity = 'session' AND reason LIKE '%Operations%' ORDER BY row_index LIMIT 1").first<{ reason: string }>();
    expect(row?.reason).toContain('track "Operations" not recognized');
    expect(row?.reason).not.toContain("Workshop");
    const kept = await env.DB.prepare("SELECT format_id FROM submissions WHERE event_id = ? AND external_ref = 'sess-trust-102'").bind(EVENT_ID).first<{ format_id: string | null }>();
    expect(kept?.format_id).toBe("format_mrq84_workshop");
  }, 20_000);

  test("AC-110 · the same export re-imported still reports the miss on the skipped path", async () => {
    // A row that reports `skipped` is the case an operator is most likely to
    // scroll past, and it is exactly where an unexplained missing track would
    // stay unexplained forever.
    const result = await runImport();
    expect(result.counts.skipped).toBeGreaterThan(0);
    const skipped = result.rows.filter((row) => row.entity === "session" && row.outcome === "skipped");
    expect(skipped.some((row) => row.reason?.includes('track "Platform" not recognized'))).toBe(true);
  }, 20_000);
});
