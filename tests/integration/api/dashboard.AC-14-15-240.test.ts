import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, test } from "vitest";

import type { DashboardCount, DashboardSnapshot, DashboardWave } from "../../../src/api/dashboard";
import type { SubmissionListItem } from "../../../src/api/submissions";
import { DASHBOARD_REVALIDATE_MS } from "../../../src/ui/dashboard/dashboard-constants";
import { sha256Hex } from "../../../src/lib/auth/random-token";

const ORIGIN = "https://marquee.stage11.dev";
const EVENT_ID = "evt-dashboard";
const TOKEN = "mq_dashboard-read-token";

interface ListEnvelope {
  data: SubmissionListItem[];
  total: number;
}

async function buildFixture(): Promise<void> {
  const now = Date.now();
  const sql = `
    CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, timezone TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS api_tokens (id TEXT PRIMARY KEY, org_id TEXT NOT NULL, event_id TEXT, token_hash TEXT NOT NULL, scopes TEXT NOT NULL, revoked_at INTEGER, last_used_at INTEGER);
    CREATE TABLE IF NOT EXISTS formats (id TEXT PRIMARY KEY, event_id TEXT NOT NULL, name TEXT NOT NULL, position INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS tracks (id TEXT PRIMARY KEY, event_id TEXT NOT NULL, name TEXT NOT NULL, color TEXT NOT NULL, position INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS waves (id TEXT PRIMARY KEY, event_id TEXT NOT NULL, name TEXT NOT NULL, decision_on TEXT NOT NULL, target_count INTEGER NOT NULL, sent_at INTEGER, position INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS submissions (id TEXT PRIMARY KEY, event_id TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL, format_id TEXT, wave_id TEXT, origin TEXT NOT NULL, submitted_at INTEGER, updated_at INTEGER NOT NULL, search_blob TEXT NOT NULL DEFAULT '');
    CREATE TABLE IF NOT EXISTS people (id TEXT PRIMARY KEY, name TEXT NOT NULL, company TEXT);
    CREATE TABLE IF NOT EXISTS participations (id TEXT PRIMARY KEY, submission_id TEXT NOT NULL, person_id TEXT NOT NULL, position INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS submission_tracks (id TEXT PRIMARY KEY, submission_id TEXT NOT NULL, track_id TEXT NOT NULL, is_primary INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS evaluations (id TEXT PRIMARY KEY, submission_id TEXT NOT NULL, score REAL);
    CREATE TABLE IF NOT EXISTS buildings (id TEXT PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS rooms (id TEXT PRIMARY KEY, building_id TEXT NOT NULL, name TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS agenda_items (id TEXT PRIMARY KEY, submission_id TEXT, kind TEXT NOT NULL, starts_at INTEGER NOT NULL, duration_min INTEGER NOT NULL, room_id TEXT NOT NULL, is_published INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS speaker_tasks (id TEXT PRIMARY KEY, event_id TEXT NOT NULL, person_id TEXT NOT NULL, submission_id TEXT, title TEXT NOT NULL, due_at INTEGER NOT NULL, status TEXT NOT NULL);
    DELETE FROM speaker_tasks; DELETE FROM agenda_items; DELETE FROM evaluations; DELETE FROM submission_tracks; DELETE FROM tracks; DELETE FROM participations; DELETE FROM people; DELETE FROM submissions; DELETE FROM waves; DELETE FROM formats; DELETE FROM rooms; DELETE FROM buildings; DELETE FROM events; DELETE FROM api_tokens;
    INSERT INTO events VALUES ('${EVENT_ID}', 'America/New_York');
    INSERT INTO formats VALUES ('fmt-stage', '${EVENT_ID}', 'Stage Talk', 0), ('fmt-workshop', '${EVENT_ID}', 'Workshop', 1);
    INSERT INTO tracks VALUES ('track-agents', '${EVENT_ID}', 'Agents', '#db4c3f', 0), ('track-evals', '${EVENT_ID}', 'Evals', '#0d9488', 1);
    INSERT INTO waves VALUES ('wave-1', '${EVENT_ID}', 'Wave 1', '2026-08-15', 1, ${now - 86_400_000}, 0), ('wave-2', '${EVENT_ID}', 'Wave 2', '2026-09-01', 2, NULL, 1);
    INSERT INTO people VALUES ('person-1', 'Amara van der Meer', 'Marquee Systems');
    INSERT INTO buildings VALUES ('building-1', 'Sheraton');
    INSERT INTO rooms VALUES ('room-1', 'building-1', 'Liberty 3');
    INSERT INTO submissions VALUES
      ('sub-submitted', '${EVENT_ID}', 'abstract', 'Submitted work', 'submitted', 'fmt-stage', NULL, 'public', ${now}, ${now}, 'submitted work'),
      ('sub-review', '${EVENT_ID}', 'abstract', 'Review work', 'in_review', 'fmt-stage', NULL, 'public', ${now}, ${now}, 'review work'),
      ('sub-unplaced', '${EVENT_ID}', 'abstract', 'Unplaced accepted work', 'accepted', 'fmt-stage', 'wave-1', 'public', ${now}, ${now}, 'unplaced work'),
      ('sub-scheduled', '${EVENT_ID}', 'abstract', 'Private scheduled work', 'accepted', 'fmt-stage', 'wave-2', 'public', ${now}, ${now}, 'private scheduled work'),
      ('sub-published', '${EVENT_ID}', 'session', 'Published work', 'accepted', 'fmt-stage', 'wave-2', 'admin', ${now}, ${now}, 'published work'),
      ('sub-rejected', '${EVENT_ID}', 'abstract', 'Workshop rejected work', 'rejected', 'fmt-workshop', NULL, 'public', ${now}, ${now}, 'rejected work');
    INSERT INTO participations SELECT 'par-' || id, id, 'person-1', 0 FROM submissions;
    INSERT INTO submission_tracks VALUES
      ('st-submitted', 'sub-submitted', 'track-agents', 1),
      ('st-review', 'sub-review', 'track-agents', 1),
      ('st-unplaced', 'sub-unplaced', 'track-evals', 1),
      ('st-scheduled', 'sub-scheduled', 'track-evals', 1),
      ('st-published', 'sub-published', 'track-agents', 1),
      ('st-rejected', 'sub-rejected', 'track-evals', 1);
    INSERT INTO agenda_items VALUES
      ('agenda-private', 'sub-scheduled', 'session', ${now}, 30, 'room-1', 0),
      ('agenda-public', 'sub-published', 'session', ${now}, 30, 'room-1', 1);
    INSERT INTO speaker_tasks VALUES
      ('task-overdue', '${EVENT_ID}', 'person-1', 'sub-unplaced', 'Speaker agreement', ${now - 86_400_000}, 'open'),
      ('task-future', '${EVENT_ID}', 'person-1', 'sub-scheduled', 'Headshot', ${now + 86_400_000}, 'open');
  `;
  for (const statement of sql.replaceAll(/\s+/g, " ").split(";").map((item) => item.trim()).filter(Boolean)) {
    await env.DB.exec(statement);
  }
  await env.DB.prepare(
    "INSERT INTO api_tokens (id, org_id, event_id, token_hash, scopes, revoked_at, last_used_at) VALUES (?, ?, NULL, ?, ?, NULL, NULL)",
  ).bind(
    "tok-dashboard",
    "org-dashboard",
    await sha256Hex(TOKEN),
    JSON.stringify({ permissions: ["program:read"], event_ids: [EVENT_ID] }),
  ).run();
}

async function dashboard(): Promise<DashboardSnapshot> {
  const response = await SELF.fetch(`${ORIGIN}/api/v1/events/${EVENT_ID}/dashboard`, { headers: { authorization: `Bearer ${TOKEN}` } });
  expect(response.status).toBe(200);
  return response.json<DashboardSnapshot>();
}

async function listTotal(href: string): Promise<number> {
  const response = await SELF.fetch(`${ORIGIN}/api/v1/events/${EVENT_ID}${href}`, { headers: { authorization: `Bearer ${TOKEN}` } });
  expect(response.status).toBe(200);
  return (await response.json<ListEnvelope>()).total;
}

function countById(items: readonly DashboardCount[], id: string): number {
  return items.find((item) => item.id === id)?.count ?? -1;
}

function countLinkPairs(snapshot: DashboardSnapshot): DashboardCount[] {
  const waves: DashboardCount[] = snapshot.waves.map((wave: DashboardWave) => ({
    id: wave.id,
    label: wave.name,
    count: wave.accepted_count,
    href: wave.href,
    note: "wave",
  }));
  return [...snapshot.pipeline, ...snapshot.format_mix, ...snapshot.track_pressure, ...waves, ...snapshot.metrics];
}

describe.sequential("MRQ-11 program dashboard", () => {
  beforeAll(buildFixture, 10_000);

  test("AC-14 · a fresh dashboard snapshot follows status, format, and track mutations without a manual refresh", async () => {
    const initial = await dashboard();
    expect(countById(initial.pipeline, "submitted")).toBe(1);
    expect(countById(initial.pipeline, "in_review")).toBe(1);
    expect(countById(initial.format_mix, "fmt-stage")).toBe(5);
    expect(countById(initial.format_mix, "fmt-workshop")).toBe(1);
    expect(countById(initial.track_pressure, "track-agents")).toBe(2);
    expect(countById(initial.track_pressure, "track-evals")).toBe(0);

    await env.DB.batch([
      env.DB.prepare("UPDATE submissions SET status = 'in_review', format_id = 'fmt-workshop' WHERE id = 'sub-submitted'"),
      env.DB.prepare("UPDATE submission_tracks SET track_id = 'track-evals' WHERE id = 'st-submitted'"),
    ]);

    const refreshed = await dashboard();
    expect(countById(refreshed.pipeline, "submitted")).toBe(0);
    expect(countById(refreshed.pipeline, "in_review")).toBe(2);
    expect(countById(refreshed.format_mix, "fmt-stage")).toBe(4);
    expect(countById(refreshed.format_mix, "fmt-workshop")).toBe(2);
    expect(countById(refreshed.track_pressure, "track-agents")).toBe(1);
    expect(countById(refreshed.track_pressure, "track-evals")).toBe(1);
    expect(DASHBOARD_REVALIDATE_MS).toBe(5_000);
  });

  test("AC-15 · every dashboard number opens a submissions filter with the same result cardinality", async () => {
    const snapshot = await dashboard();
    for (const item of countLinkPairs(snapshot).filter((item) => item.href.startsWith("/submissions"))) {
      expect(await listTotal(item.href), `${item.label} must preserve its displayed count`).toBe(item.count);
    }
  });

  test("AC-240 · Scheduled and Published use the exact clarifying stage copy", async () => {
    const snapshot = await dashboard();
    expect(snapshot.pipeline.find((item) => item.id === "scheduled")?.note).toBe("placed on the working agenda");
    expect(snapshot.pipeline.find((item) => item.id === "published")?.note).toBe("live on the public site");
  });
});
