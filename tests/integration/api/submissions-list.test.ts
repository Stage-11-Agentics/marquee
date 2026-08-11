import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, test } from "vitest";

import type { SubmissionListItem } from "../../../src/api/submissions";
import {
  DEFAULT_SUBMISSION_COLUMNS,
  SUBMISSION_COLUMN_REGISTRY,
  submissionKindLabel,
} from "../../../src/lib/submission-columns";
import { selectionCount } from "../../../src/ui/submissions/selection";

const ORIGIN = "https://marquee.stage11.dev";
const EVENT_ID = "evt-ugly-list";

interface ListEnvelope {
  data: SubmissionListItem[];
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
}

async function buildFixture(): Promise<void> {
  const fixtureSql = `
    CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, timezone TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS formats (id TEXT PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS submissions (
      id TEXT PRIMARY KEY, event_id TEXT NOT NULL, kind TEXT NOT NULL,
      title TEXT NOT NULL, status TEXT NOT NULL, format_id TEXT,
      origin TEXT NOT NULL, submitted_at INTEGER, updated_at INTEGER NOT NULL,
      search_blob TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS people (id TEXT PRIMARY KEY, name TEXT NOT NULL, company TEXT);
    CREATE TABLE IF NOT EXISTS participations (id TEXT PRIMARY KEY, submission_id TEXT NOT NULL, person_id TEXT NOT NULL, position INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS tracks (id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL, position INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS submission_tracks (id TEXT PRIMARY KEY, submission_id TEXT NOT NULL, track_id TEXT NOT NULL, is_primary INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS evaluations (id TEXT PRIMARY KEY, submission_id TEXT NOT NULL, score REAL);
    CREATE TABLE IF NOT EXISTS buildings (id TEXT PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS rooms (id TEXT PRIMARY KEY, building_id TEXT NOT NULL, name TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS agenda_items (
      id TEXT PRIMARY KEY, submission_id TEXT, kind TEXT NOT NULL,
      starts_at INTEGER NOT NULL, duration_min INTEGER NOT NULL,
      room_id TEXT NOT NULL, is_published INTEGER NOT NULL
    );
    DELETE FROM agenda_items; DELETE FROM evaluations; DELETE FROM submission_tracks;
    DELETE FROM tracks; DELETE FROM participations; DELETE FROM people;
    DELETE FROM submissions; DELETE FROM formats; DELETE FROM rooms;
    DELETE FROM buildings; DELETE FROM events;
    INSERT INTO events VALUES ('${EVENT_ID}', 'America/New_York');
    INSERT INTO formats VALUES ('fmt-stage', 'Stage Talk');
    INSERT INTO people VALUES ('person-zoe', 'Zoë Łukaszewicz-García', 'Société Générale');
    INSERT INTO tracks VALUES ('track-agents', 'Agents', '#db4c3f', 1), ('track-evals', 'Evals', '#0d9488', 2);
    INSERT INTO buildings VALUES ('building-main', 'Sheraton New York Times Square');
    INSERT INTO rooms VALUES ('room-liberty', 'building-main', 'Liberty 3');
    WITH RECURSIVE seq(n) AS (VALUES(1) UNION ALL SELECT n + 1 FROM seq WHERE n < 1000)
    INSERT INTO submissions (id, event_id, kind, title, status, format_id, origin, submitted_at, updated_at, search_blob)
    SELECT
      printf('sub-%04d', n), '${EVENT_ID}',
      CASE WHEN n % 10 = 0 THEN 'session' ELSE 'abstract' END,
      CASE WHEN n = 1000 THEN 'Željko and María build a deliberately overlong title that truncates without moving the table geometry across the full one-thousand-row register' ELSE printf('Submission %04d', n) END,
      CASE n % 7 WHEN 0 THEN 'draft' WHEN 1 THEN 'submitted' WHEN 2 THEN 'in_review' WHEN 3 THEN 'accepted' WHEN 4 THEN 'waitlisted' WHEN 5 THEN 'rejected' ELSE 'withdrawn' END,
      'fmt-stage', 'public', 1700000000000 + n, 1700000000000 + n, printf('submission %04d zoë łukaszewicz-garcía société générale', n)
    FROM seq;
    INSERT INTO participations
      SELECT 'par-' || id, id, 'person-zoe', 0 FROM submissions;
    INSERT INTO submission_tracks
      SELECT 'st-' || id, id, CASE WHEN CAST(substr(id, 5) AS INTEGER) % 2 = 0 THEN 'track-evals' ELSE 'track-agents' END, 1 FROM submissions;
    INSERT INTO agenda_items VALUES
      ('agenda-scheduled', 'sub-0999', 'session', 1791815400000, 30, 'room-liberty', 0),
      ('agenda-published', 'sub-0998', 'session', 1791819000000, 30, 'room-liberty', 1);
  `;
  // D1 exec treats newlines as statement boundaries; flatten before splitting
  // the fixture into complete statements (same pattern as the upload suites).
  const flattened = fixtureSql.replaceAll(/\s+/g, " ");
  for (const statement of flattened.split(";").map((item) => item.trim()).filter(Boolean)) {
    await env.DB.exec(statement);
  }
}

async function request(query = ""): Promise<ListEnvelope> {
  const response = await SELF.fetch(`${ORIGIN}/api/v1/events/${EVENT_ID}/submissions${query}`);
  expect(response.status).toBe(200);
  return response.json<ListEnvelope>();
}

describe.sequential("MRQ-9 submissions list", () => {
  beforeAll(buildFixture, 10_000);

  test("CONTRACT · MRQ-60 guard keeps the admin list explicitly public only until credential resolution lands", async () => {
    // This credential-free 200 is deliberate temporary behavior, not an
    // accidental omission. MRQ-60 must flip this assertion to 401/403 when it
    // changes the route policy to authenticated admin scope.
    const response = await SELF.fetch(`${ORIGIN}/api/v1/events/${EVENT_ID}/submissions?per_page=1`);
    expect(response.status).toBe(200);
  });

  test("AC-23 · the running mixed list renders textual Abstract and Session markers", async () => {
    const envelope = await request("?page=1&per_page=50");
    expect(envelope.total).toBe(1000);
    expect(envelope.data).toHaveLength(50);
    const labels = new Set(envelope.data.map((item) => submissionKindLabel(item.kind)));
    expect(labels).toEqual(new Set(["Abstract", "Session"]));
    expect(envelope.data.some((item) => item.title.includes("Željko and María"))).toBe(true);
  });

  test("CONTRACT · list filtering, stable sorting, and the 50-row envelope stay server-side", async () => {
    const sessions = await request("?kind=session&status=accepted&track=track-evals&sort=title&page=1&per_page=50");
    expect(sessions.data.every((item) => item.kind === "session" && item.status === "accepted")).toBe(true);
    expect(sessions.data.every((item) => item.tracks.some((track) => track.id === "track-evals"))).toBe(true);
    expect(sessions.per_page).toBe(50);
    expect(sessions.data.map((item) => item.title)).toEqual([...sessions.data.map((item) => item.title)].sort());
    const outOfRange = await request("?q=Zo%C3%AB&page=999&per_page=50");
    expect(outOfRange.total).toBe(1000);
    expect(outOfRange.data).toEqual([]);
  });

  test("CONTRACT · scheduled metadata distinguishes private and published agenda slots", async () => {
    const scheduled = await request("?status=scheduled");
    expect(scheduled.data).toHaveLength(1);
    expect(scheduled.data[0]?.slot).toMatchObject({ room: "Liberty 3", is_published: false });
    const published = await request("?status=published");
    expect(published.data).toHaveLength(1);
    expect(published.data[0]?.slot).toMatchObject({ room: "Liberty 3", is_published: true });
  });

  test("CONTRACT · the fixed column registry is complete and Title cannot be removed", () => {
    expect(SUBMISSION_COLUMN_REGISTRY.map((column) => column.label)).toEqual([
      "Type", "ID", "Title", "Speakers", "Status", "Tracks", "Score",
      "Submitted", "Last updated", "Origin", "Missing fields",
    ]);
    expect(SUBMISSION_COLUMN_REGISTRY.find((column) => column.id === "title")?.required).toBe(true);
    expect(DEFAULT_SUBMISSION_COLUMNS).toContain("title");
  });

  test("CONTRACT · select-all-matching counts the authoritative match set, not the visible page", () => {
    expect(selectionCount(new Set(["sub-0001", "sub-0002"]), false, 1000)).toBe(2);
    expect(selectionCount(new Set(["sub-0001", "sub-0002"]), true, 1000)).toBe(1000);
  });
});
