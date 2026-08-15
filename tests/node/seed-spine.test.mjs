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

test("AC-252 · the seed defines the Sheraton and Marriott building trio and every room belongs to one", () => {
  const buildings = table("buildings");
  assert.deepEqual(buildings.map((row) => row.name), [
    "Sheraton New York Times Square",
    "New York Marriott Marquis",
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

test("AC-255 · seeded physical venues carry verified coordinates, access, and building notes while Online stays virtual", () => {
  const geography = table("buildings").map((row) => [
    row.name,
    row.lat,
    row.lng,
    row.access_minutes,
    row.access_note,
  ]);
  assert.deepEqual(geography, [
    ["Sheraton New York Times Square", 40.7625188, -73.9814528, 0, "Photo ID required at the main entrance. Allow ten minutes for building security."],
    ["New York Marriott Marquis", 40.7585971, -73.9861935, 3, "Use the Broadway lobby for conference access. Allow three minutes for building security."],
    ["Online", null, null, 0, null],
  ]);
  assert.ok(table("rooms").some((room) => JSON.parse(room.av_capabilities).length > 0), "seeded rooms need AV capabilities");
  for (const room of table("rooms")) {
    assert.doesNotMatch(room.notes ?? "", /door|photo.?id|entrance|security/i);
  }
});

test("CONTRACT · the accepted core is exactly 60 accepted records over at least 75 people", () => {
  // The accepted CORE is the real, checkable Feb-2025 program (SPEC §6 Option
  // A'). Sponsor Sessions are also accepted, and they are fabricated by design —
  // counting them here would let a fabricated row satisfy an assertion whose
  // entire subject is "every record real and checkable", so they are excluded and
  // asserted separately below.
  const submissions = table("submissions").filter((row) => row.status === "accepted" && !row.sponsorship_id);
  assert.equal(submissions.length, 60);
  assert.equal(submissions.filter((row) => row.status === "accepted").length, 60);
  assert.equal(submissions.filter((row) => row.kind === "session").length, 30);
  assert.equal(submissions.filter((row) => row.kind === "abstract").length, 30);
  assert.equal(submissions.filter((row) => row.kind === "session" && row.bypass_evaluation === 1).length, 30);
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

/**
 * The two assertions above exclude sponsor Sessions. This is what is true of them
 * instead — so "excluded" never quietly means "unchecked".
 */
test("CONTRACT · seeded sponsor Sessions are guaranteed placements, not competitive ones", () => {
  const people = byId("people");
  const formats = byId("formats");
  const sponsored = table("submissions").filter((row) => row.sponsorship_id);
  const sponsorships = new Set(table("sponsorships").map((row) => row.id));
  assert.ok(sponsored.length >= 3, `expected the Gold/Silver demo Sessions, found ${sponsored.length}`);

  const tracks = byId("tracks");
  const primaryTracks = table("submission_tracks").filter((row) => row.is_primary === 1);
  for (const submission of sponsored) {
    assert.ok(sponsorships.has(submission.sponsorship_id), `${submission.id} names no seeded sponsorship`);
    assert.equal(submission.kind, "session");
    assert.equal(submission.bypass_evaluation, 1, `${submission.id} must bypass the competitive path`);
    assert.equal(submission.status, "accepted");
    // Never in a decision batch, and never decided against criteria: a guaranteed
    // Session has no wave and no decision row, and inventing either would be a
    // fabricated verdict on the record.
    assert.equal(submission.wave_id, null, `${submission.id} must not sit in a decision wave`);
    assert.ok(formats.has(submission.format_id));
    assert.ok(people.has(submission.submitter_person_id));
    // The taxonomy and date invariants the competitive assertions above no longer
    // cover for these rows. `decided_at` is an instant, not an ordering: a
    // guaranteed placement is decided the moment it is sold, so `submitted_at`
    // EQUALS it rather than preceding it — which is exactly why the competitive
    // `submitted_at < decided_at` check cannot be reused here.
    assert.ok(tracks.has(submission.primary_track_id), `${submission.id} has no primary track`);
    assert.equal(
      primaryTracks.filter((row) => row.submission_id === submission.id).length,
      1,
      `${submission.id} must carry exactly one primary track row`,
    );
    assert.ok(Number.isInteger(submission.decided_at), `${submission.id} is accepted but undecided`);
    assert.ok(
      submission.submitted_at <= submission.decided_at,
      `${submission.id} was decided before it existed`,
    );
  }
  const sponsoredIds = new Set(sponsored.map((row) => row.id));
  assert.equal(
    table("submission_decisions").filter((row) => sponsoredIds.has(row.submission_id)).length,
    0,
    "a sponsor Session must carry no decision row",
  );

  // Only real speakers hold a participation. A sponsor contact is the submitter
  // of record — the column — and holding a `speaker` row would publish their name
  // as the person on stage.
  const contacts = new Set(table("sponsorship_contacts").map((row) => row.person_id));
  for (const participation of table("participations").filter((row) => sponsoredIds.has(row.submission_id))) {
    assert.equal(participation.role, "speaker");
    assert.ok(!contacts.has(participation.person_id), `${participation.person_id} is a contact, not a speaker`);
  }

  // One Session with nobody named yet, so the portal's "Speaker not named yet"
  // state and the name-your-speaker write path are both demonstrable.
  const named = new Set(table("participations").filter((row) => sponsoredIds.has(row.submission_id)).map((row) => row.submission_id));
  assert.ok(sponsored.some((row) => !named.has(row.id)), "one sponsor Session must have no speaker named");
  assert.ok(sponsored.some((row) => named.has(row.id)), "one sponsor Session must have a speaker named");

  // Every named sponsor speaker holds the membership and the required task set
  // every other accepted speaker holds (SPEC §6).
  const speakerMembers = new Set(table("memberships").filter((row) => row.role === "speaker").map((row) => row.person_id));
  const requiredTitles = ["Hotel and Travel Reservations", "Presentation Upload"];
  for (const submissionId of named) {
    for (const participation of table("participations").filter((row) => row.submission_id === submissionId)) {
      assert.ok(speakerMembers.has(participation.person_id), `${participation.person_id} lacks speaker authority`);
      const required = table("speaker_tasks").filter((row) =>
        row.person_id === participation.person_id && requiredTitles.includes(row.title));
      assert.equal(required.length, 2, `${participation.person_id} is missing the required task set`);
    }
  }
});

test("CONTRACT · every accepted submission resolves its taxonomy, decision and speakers", () => {
  const people = byId("people");
  const formats = byId("formats");
  const tracks = byId("tracks");
  const waves = byId("waves");
  const submissions = table("submissions").filter((row) => row.status === "accepted" && !row.sponsorship_id);
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
  // participants after it, and contiguous positions. The agenda deliberately
  // carries one multi-role confirmation fixture: a confirmed moderator and a
  // declined speaker role for the same person, plus one pending co-speaker.
  const wavesById = new Map(submissions.map((row) => [row.id, row.wave_id]));
  const bySubmission = new Map();
  const confirmationExceptions = [];
  for (const participation of table("participations").filter(
    (row) => submissionIds.has(row.submission_id),
  )) {
    assert.ok(people.has(participation.person_id), `unknown person ${participation.person_id}`);
    assert.ok(submissionIds.has(participation.submission_id));
    const expected = wavesById.get(participation.submission_id) === "wav_wave-1"
      ? "confirmed"
      : "pending";
    if (participation.confirmation_status !== expected) confirmationExceptions.push(participation);
    const group = bySubmission.get(participation.submission_id) ?? [];
    group.push(participation);
    bySubmission.set(participation.submission_id, group);
  }
  assert.deepEqual(
    confirmationExceptions.map((row) => row.confirmation_status).sort(),
    ["declined", "declined", "pending"],
  );
  const exceptionSubmissionIds = new Set(confirmationExceptions.map((row) => row.submission_id));
  assert.equal(exceptionSubmissionIds.size, 2, "confirmation exceptions should be on scheduled agenda Sessions");
  const exceptionSubmissionId = [...exceptionSubmissionIds][0];
  assert.equal(bySubmission.size, 60);
  for (const [submissionId, group] of bySubmission) {
    const ordered = [...group].sort((left, right) => left.position - right.position);
    assert.deepEqual(ordered.map((row) => row.position), ordered.map((_, index) => index));
    assert.equal(ordered[0].role, "speaker", `${submissionId} has no speaker of record`);
    for (const participant of ordered.slice(1)) {
      assert.ok(
        ["co_speaker", "moderator", "chairperson"].includes(participant.role)
          || (participant.role === "speaker" && submissionId === exceptionSubmissionId),
      );
    }
    const personCounts = new Map();
    for (const participant of ordered) personCounts.set(participant.person_id, (personCounts.get(participant.person_id) ?? 0) + 1);
    const duplicatePeople = [...personCounts].filter(([, count]) => count > 1);
    if (submissionId === exceptionSubmissionId) {
      assert.equal(duplicatePeople.length, 1);
      const duplicateId = duplicatePeople[0][0];
      const duplicateRoles = ordered.filter((row) => row.person_id === duplicateId);
      assert.deepEqual(new Set(duplicateRoles.map((row) => row.role)), new Set(["moderator", "speaker"]));
      assert.equal(duplicateRoles.find((row) => row.confirmation_status === "declined")?.role, "speaker");
    } else {
      assert.equal(duplicatePeople.length, 0, `${submissionId} lists the same person twice`);
    }
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
  const submissionFiles = table("attachments").filter((row) => row.owner_type === "submission_file");
  assert.ok(submissionFiles.length >= 40, "the spine seeds reviewer submission files");
  for (const file of submissionFiles) {
    assert.equal(file.status, "ready");
    assert.ok(file.r2_etag, `${file.id} must carry a provider completion tag`);
  }
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
