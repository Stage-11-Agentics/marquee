import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const migrationDirectory = join(repositoryRoot, "migrations");
const migration0030 = "0030_submission_reference_codes.sql";

/**
 * MRQ-259 regression. 0030 backfills `submissions.reference_code` and then
 * builds a unique index over it, so the backfill has to be correct on a table
 * that already holds rows.
 *
 * The local flow hides that: migrations run against an empty database and the
 * seed inserts its own codes afterwards, so the backfill only ever ranked zero
 * rows. Production is the opposite -- the data predates the migration -- and
 * the original statement re-read `reference_code` while writing it, assigning
 * one code to hundreds of rows. Three submissions in one event are enough to
 * reproduce it, so this test is cheap and still catches the whole class.
 */
function migrateTo0030() {
  const database = new DatabaseSync(":memory:");
  const earlier = readdirSync(migrationDirectory)
    .filter((name) => /^\d+_.+\.sql$/.test(name) && name < migration0030)
    .sort();
  for (const name of earlier) database.exec(readFileSync(join(migrationDirectory, name), "utf8"));
  return database;
}

function seedSubmissions(database, { eventId, count, startedAt }) {
  database
    .prepare(
      "INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    )
    .run(`org_${eventId}`, "Reference Conference", `ref-${eventId}`, startedAt, startedAt);
  database
    .prepare(
      "INSERT INTO events (id, org_id, name, slug, starts_on, ends_on, timezone, status, demo_mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'live', 0, ?, ?)",
    )
    .run(
      eventId,
      `org_${eventId}`,
      "Reference Conference",
      `ref-${eventId}`,
      "2026-09-01",
      "2026-09-02",
      "America/New_York",
      startedAt,
      startedAt,
    );
  database
    .prepare(
      "INSERT INTO people (id, org_id, email, name, is_demo, last_write_source, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 'marquee', ?, ?)",
    )
    .run(
      `person_${eventId}`,
      `org_${eventId}`,
      `submitter@${eventId}.example.com`,
      "Submitter",
      startedAt,
      startedAt,
    );
  const insert = database.prepare(
    "INSERT INTO submissions (id, event_id, kind, title, abstract, status, origin, submitter_person_id, created_at, updated_at) VALUES (?, ?, 'session', ?, ?, 'submitted', 'public', ?, ?, ?)",
  );
  for (let index = 0; index < count; index += 1) {
    // Distinct created_at values make the intended ordering unambiguous.
    const at = startedAt + index * 1000;
    insert.run(
      `sub_${eventId}_${index}`,
      eventId,
      `Session ${index}`,
      "Abstract",
      `person_${eventId}`,
      at,
      at,
    );
  }
}

test("MRQ-259 · 0030 backfills a populated submissions table without colliding", () => {
  const database = migrateTo0030();
  const startedAt = Date.parse("2026-08-16T12:00:00.000Z");
  seedSubmissions(database, { eventId: "evt_ref", count: 25, startedAt });

  database.exec(readFileSync(join(migrationDirectory, migration0030), "utf8"));

  const rows = database
    .prepare("SELECT id, reference_code FROM submissions ORDER BY created_at, id")
    .all();
  assert.equal(rows.length, 25);
  assert.equal(
    new Set(rows.map((row) => row.reference_code)).size,
    25,
    "every submission must receive a distinct reference code",
  );
  // Deterministic and gap-free, ordered by the immutable creation tuple.
  assert.deepEqual(
    rows.map((row) => row.reference_code),
    Array.from({ length: 25 }, (_, index) => `SUB-${index + 1}`),
  );
});

test("MRQ-259 · 0030 numbers each conference independently", () => {
  const database = migrateTo0030();
  const startedAt = Date.parse("2026-08-16T12:00:00.000Z");
  seedSubmissions(database, { eventId: "evt_one", count: 4, startedAt });
  seedSubmissions(database, { eventId: "evt_two", count: 3, startedAt });

  database.exec(readFileSync(join(migrationDirectory, migration0030), "utf8"));

  const codesFor = (eventId) =>
    database
      .prepare("SELECT reference_code FROM submissions WHERE event_id = ? ORDER BY created_at, id")
      .all(eventId)
      .map((row) => row.reference_code);
  assert.deepEqual(codesFor("evt_one"), ["SUB-1", "SUB-2", "SUB-3", "SUB-4"]);
  assert.deepEqual(codesFor("evt_two"), ["SUB-1", "SUB-2", "SUB-3"]);
});

test("MRQ-259 · 0030 seeds the reference ledger floor from the backfill", () => {
  const database = migrateTo0030();
  const startedAt = Date.parse("2026-08-16T12:00:00.000Z");
  seedSubmissions(database, { eventId: "evt_one", count: 4, startedAt });
  seedSubmissions(database, { eventId: "evt_two", count: 3, startedAt });

  database.exec(readFileSync(join(migrationDirectory, migration0030), "utf8"));

  // node:sqlite rows have a null prototype, so compare plain projections.
  const ledger = database
    .prepare("SELECT event_id, last_sequence FROM submission_reference_ledger ORDER BY event_id")
    .all()
    .map((row) => `${row.event_id}=${row.last_sequence}`);
  assert.deepEqual(ledger, ["evt_one=4", "evt_two=3"]);
});

test("MRQ-259 · 0030 leaves no backfill scaffolding behind", () => {
  const database = migrateTo0030();
  const startedAt = Date.parse("2026-08-16T12:00:00.000Z");
  seedSubmissions(database, { eventId: "evt_ref", count: 3, startedAt });

  database.exec(readFileSync(join(migrationDirectory, migration0030), "utf8"));

  const leftovers = database
    .prepare("SELECT name FROM sqlite_master WHERE name LIKE '%reference_backfill%'")
    .all()
    .map((row) => row.name);
  assert.deepEqual(leftovers, []);
});
