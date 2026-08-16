import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const migrationDirectory = join(repositoryRoot, "migrations");
const migration0026 = "0026_calendar_truth.sql";

test("AC-321 · migration 0026 backfills a legacy request snapshot and seeds its sequence floor", () => {
  const database = new DatabaseSync(":memory:");
  const migrations = readdirSync(migrationDirectory)
    .filter((name) => /^\d+_.+\.sql$/.test(name) && name < migration0026)
    .sort();
  for (const name of migrations) database.exec(readFileSync(join(migrationDirectory, name), "utf8"));

  const now = Date.parse("2026-08-16T12:00:00.000Z");
  database.prepare(
    "INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
  ).run("org_backfill", "Backfill Conference", "backfill", now, now);
  database.prepare(
    "INSERT INTO events (id, org_id, name, slug, starts_on, ends_on, timezone, status, demo_mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'live', 0, ?, ?)",
  ).run("event_backfill", "org_backfill", "Backfill Conference", "backfill", "2026-09-01", "2026-09-02", "America/New_York", now, now);
  database.prepare(
    "INSERT INTO people (id, org_id, email, name, is_demo, last_write_source, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 'marquee', ?, ?)",
  ).run("person_backfill", "org_backfill", "legacy@example.com", "Legacy Speaker", now, now);
  database.prepare(
    "INSERT INTO buildings (id, event_id, name, address, position, lat, lng, access_minutes, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?, 0, ?, ?)",
  ).run("building_backfill", "event_backfill", "Backfill Building", "1 Main Street", 40.1, -73.9, now, now);
  database.prepare(
    "INSERT INTO rooms (id, event_id, building_id, name, capacity, position, created_at, updated_at) VALUES (?, ?, ?, ?, 100, 0, ?, ?)",
  ).run("room_backfill", "event_backfill", "building_backfill", "Room 1", now, now);
  database.prepare(
    "INSERT INTO submissions (id, event_id, kind, title, abstract, status, origin, submitter_person_id, created_at, updated_at) VALUES (?, ?, 'session', ?, ?, 'accepted', 'admin', ?, ?, ?)",
  ).run("submission_backfill", "event_backfill", "Legacy calendar session", "The live abstract", "person_backfill", now, now);
  database.prepare(
    "INSERT INTO participations (id, submission_id, person_id, role, position, created_at, updated_at) VALUES (?, ?, ?, 'speaker', 0, ?, ?)",
  ).run("participation_backfill", "submission_backfill", "person_backfill", now, now);
  database.prepare(
    "INSERT INTO agenda_items (id, event_id, submission_id, kind, starts_at, duration_min, room_id, created_at, updated_at) VALUES (?, ?, ?, 'session', ?, 45, ?, ?, ?)",
  ).run("agenda_backfill", "event_backfill", "submission_backfill", Date.parse("2026-09-01T15:00:00.000Z"), "room_backfill", now, now);
  database.prepare(
    "INSERT INTO calendar_invites (id, submission_id, person_id, uid, sequence, last_method, last_sent_at, status, created_at, updated_at) VALUES (?, ?, ?, ?, 3, 'REQUEST', ?, 'active', ?, ?)",
  ).run("invite_backfill", "submission_backfill", "person_backfill", "submission_backfill.person_backfill@marquee.stage11.dev", now, now, now);

  database.exec(readFileSync(join(migrationDirectory, migration0026), "utf8"));

  const invite = database.prepare(
    "SELECT request_snapshot, organizer_email FROM calendar_invites WHERE id = ?",
  ).get("invite_backfill");
  assert.equal(invite.organizer_email, "marquee@stage11.systems");
  const snapshot = JSON.parse(invite.request_snapshot);
  assert.deepEqual(snapshot, {
    attendee: { email: "legacy@example.com", name: "Legacy Speaker" },
    description: "The live abstract",
    duration_min: 45,
    geo: { lat: 40.1, lng: -73.9 },
    location: "Room 1, Backfill Building, 1 Main Street",
    organizer: { email: "marquee@stage11.systems", name: "Marquee" },
    starts_at: Date.parse("2026-09-01T15:00:00.000Z"),
    timezone: "America/New_York",
    title: "Legacy calendar session",
    url: "https://marquee.stage11.dev/s/submission_backfill",
  });
  assert.deepEqual(
    {
      ...database.prepare("SELECT last_sequence, updated_at FROM calendar_sequence_ledger WHERE uid = ?").get("submission_backfill.person_backfill@marquee.stage11.dev"),
    },
    { last_sequence: 3, updated_at: now },
  );
  database.close();
});
