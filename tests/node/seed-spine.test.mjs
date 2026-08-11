/**
 * Seed spine — assertions over the SQL the generator actually builds.
 *
 * These run under `node --test` rather than vitest because the vitest suite
 * executes in the Cloudflare Workers pool, where `readFileSync` of a real path
 * throws (`no such file or directory, readAll`). The seed is a plain Node
 * build-time script that reads the captured program off disk and is never
 * imported by the Worker, so `tests/node` is where it can be exercised on the
 * runtime it actually ships on. `npm test` runs this file.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { buildSeedRows, buildSeedSql, discoverSeedFiles } from "../../scripts/seed/index.ts";

const rows = await buildSeedRows();

function table(name) {
  return rows.filter((row) => row.table === name).map((row) => row.row);
}

function byId(name) {
  return new Map(table(name).map((row) => [row.id, row]));
}

test("AC-8 · the seed defines the four SPEC §6 formats with their exact duration ranges", () => {
  const formats = table("formats").map((row) => [
    row.name,
    row.min_duration_min,
    row.default_duration_min,
    row.max_duration_min,
  ]);
  assert.deepEqual(formats, [
    ["Stage Talk", 15, 20, 20],
    ["Workshop", 60, 90, 120],
    ["Lightning", 5, 10, 10],
    ["Online", 5, 25, 55],
  ]);
  for (const format of table("formats")) {
    assert.equal(format.event_id, "evt_aie-ny-2026");
    assert.ok(format.min_duration_min <= format.default_duration_min);
    assert.ok(format.default_duration_min <= format.max_duration_min);
  }
});

test("AC-252 · the seed defines the Sheraton-coherent building trio and every room belongs to one", () => {
  const buildings = table("buildings");
  assert.deepEqual(buildings.map((row) => row.name), [
    "Sheraton New York Times Square",
    "Workshop Annex — Lower Conference Level",
    "Online",
  ]);
  for (const building of buildings) {
    assert.equal(building.event_id, "evt_aie-ny-2026");
    assert.ok(building.address.length > 0, `${building.name} has no address`);
  }

  const buildingIds = new Set(buildings.map((row) => row.id));
  const rooms = table("rooms");
  assert.ok(rooms.length > 0, "the seed defines no rooms");
  for (const room of rooms) {
    assert.ok(
      buildingIds.has(room.building_id),
      `room ${room.name} points at unknown building ${room.building_id}`,
    );
    assert.equal(room.event_id, "evt_aie-ny-2026");
  }
  // Every building is used, or the trio is decoration rather than a model.
  assert.deepEqual(
    [...new Set(rooms.map((room) => room.building_id))].sort(),
    [...buildingIds].sort(),
  );
});

test("CONTRACT · the accepted core is exactly 60 accepted abstracts over at least 75 people", () => {
  const submissions = table("submissions").filter((row) => row.status === "accepted");
  assert.equal(submissions.length, 60);
  assert.equal(submissions.filter((row) => row.status === "accepted").length, 60);
  assert.equal(submissions.filter((row) => row.kind === "abstract").length, 60);
  assert.ok(table("people").length >= 75, `expected >=75 people, got ${table("people").length}`);

  // Provenance is unique and traceable back to the published 2025 program.
  const refs = submissions.map((row) => row.external_ref);
  assert.equal(new Set(refs).size, 60);
  for (const ref of refs) assert.match(ref, /^aie-2025:\d+$/);

  // 32 dispatched, 28 decided-not-sent: the demo still has a batch to accept.
  const waves = new Map();
  for (const row of submissions) waves.set(row.wave_id, (waves.get(row.wave_id) ?? 0) + 1);
  assert.deepEqual([...waves].sort(), [["wav_wave-1", 32], ["wav_wave-2", 28]]);
});

test("CONTRACT · every accepted submission resolves its taxonomy, decision and speakers", () => {
  const people = byId("people");
  const formats = byId("formats");
  const tracks = byId("tracks");
  const waves = byId("waves");
  const submissions = table("submissions").filter((row) => row.status === "accepted");
  const submissionIds = new Set(submissions.map((row) => row.id));

  for (const submission of submissions) {
    assert.ok(formats.has(submission.format_id), `${submission.id} has no format`);
    assert.ok(tracks.has(submission.primary_track_id), `${submission.id} has no primary track`);
    assert.ok(waves.has(submission.wave_id), `${submission.id} has no wave`);
    assert.ok(people.has(submission.submitter_person_id), `${submission.id} has no submitter`);
    assert.ok(Number.isInteger(submission.decided_at), `${submission.id} is accepted but undecided`);
    assert.ok(submission.submitted_at < submission.decided_at);
  }

  // Exactly one primary track row per submission, matching the denormalization.
  const primary = table("submission_tracks").filter(
    (row) => row.is_primary === 1 && submissionIds.has(row.submission_id),
  );
  assert.equal(primary.length, 60);
  const primaryBySubmission = new Map(primary.map((row) => [row.submission_id, row.track_id]));
  for (const submission of submissions) {
    assert.equal(primaryBySubmission.get(submission.id), submission.primary_track_id);
  }

  // One approve decision per accepted submission.
  const decisions = table("submission_decisions").filter((row) => submissionIds.has(row.submission_id));
  assert.equal(decisions.length, 60);
  for (const decision of decisions) {
    assert.equal(decision.decision, "approve");
    assert.equal(decision.resulting_status, "accepted");
    assert.ok(people.has(decision.decided_by_person_id));
    assert.ok(submissionIds.has(decision.submission_id));
  }

  // Participations: one speaker of record per submission, additional accepted
  // participants after it, contiguous positions, and no duplicate person.
  // M-04b deliberately adds moderators to create live agenda conflicts.
  const wavesById = new Map(submissions.map((row) => [row.id, row.wave_id]));
  const bySubmission = new Map();
  for (const participation of table("participations").filter(
    (row) => submissionIds.has(row.submission_id),
  )) {
    assert.ok(people.has(participation.person_id), `unknown person ${participation.person_id}`);
    assert.ok(submissionIds.has(participation.submission_id));
    const expected = wavesById.get(participation.submission_id) === "wav_wave-1"
      ? "confirmed"
      : "pending";
    assert.equal(participation.confirmation_status, expected);
    const group = bySubmission.get(participation.submission_id) ?? [];
    group.push(participation);
    bySubmission.set(participation.submission_id, group);
  }
  assert.equal(bySubmission.size, 60);
  for (const [submissionId, group] of bySubmission) {
    const ordered = [...group].sort((left, right) => left.position - right.position);
    assert.deepEqual(ordered.map((row) => row.position), ordered.map((_, index) => index));
    assert.equal(ordered[0].role, "speaker", `${submissionId} has no speaker of record`);
    for (const participant of ordered.slice(1)) {
      assert.ok(["co_speaker", "moderator", "chairperson"].includes(participant.role));
    }
    assert.equal(
      new Set(ordered.map((row) => row.person_id)).size,
      ordered.length,
      `${submissionId} lists the same person twice`,
    );
  }
});

test("CONTRACT · no seeded address can ever deliver and no headshot is seeded", () => {
  const people = table("people");
  const offenders = people.filter((row) => !String(row.email).endsWith("@example.com"));
  assert.deepEqual(offenders.map((row) => row.email), []);
  assert.equal(new Set(people.map((row) => row.email)).size, people.length, "duplicate emails");
  for (const person of people) {
    assert.equal(person.headshot_attachment_id, null, `${person.name} carries a headshot`);
    assert.equal(person.is_demo, 1, `${person.name} is outside reset:demo's scope`);
  }
  assert.equal(table("attachments").length, 0, "the spine seeds no attachments");
});

test("CONTRACT · rebuilding the seed produces byte-identical SQL", async () => {
  const first = await buildSeedSql();
  const second = await buildSeedSql();
  assert.equal(first, second);
  assert.ok(first.includes("ON CONFLICT(id) DO UPDATE SET"));
  assert.equal(
    first.split("\n").filter((line) => line.startsWith("INSERT INTO")).length,
    rows.length,
  );
});

test("CONTRACT · the orchestrator discovers seeders by glob, not by name", () => {
  const discovered = discoverSeedFiles();
  assert.ok(discovered.includes("event.ts"));
  assert.ok(discovered.includes("accepted-core.ts"));
  assert.ok(!discovered.includes("index.ts"), "the orchestrator would import itself");
  assert.ok(!discovered.some((name) => name.startsWith("_")), "helpers are not seeders");
});
