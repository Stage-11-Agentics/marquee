/** MRQ-5 seed-pool evidence over the generator's emitted rows. */

import assert from "node:assert/strict";
import test from "node:test";

import { buildSeedRows, buildSeedSql } from "../../scripts/seed/index.ts";
import { ORGANIZER_UNREVIEWED_ASSIGNMENTS, ROUND_ONE_ID } from "../../scripts/seed/evaluations.ts";
import { EVENT_ID, STAFF_PERSON_ID, TRACK_IDS } from "../../scripts/seed/event.ts";
import { CODE_2025_ROSTER, CODE_2025_ROSTER_COUNT } from "../../scripts/seed/pool.ts";

const rows = await buildSeedRows();

function table(name) {
  return rows.filter((row) => row.table === name).map((row) => row.row);
}

function groups(rowsToGroup, key) {
  const result = new Map();
  for (const row of rowsToGroup) {
    const group = result.get(row[key]) ?? [];
    group.push(row);
    result.set(row[key], group);
  }
  return result;
}

test("AC-3 · the seed has 1,000 submissions and a populated agenda", () => {
  const submissions = table("submissions");
  assert.equal(submissions.length, 1_000);
  assert.equal(submissions.filter((row) => row.status === "accepted").length, 60);
  assert.equal(table("agenda_items").filter((row) => row.kind === "session").length, 24);

  const acceptedSpeakers = new Set(
    table("memberships").filter((row) => row.role === "speaker").map((row) => row.person_id),
  );
  assert.ok(acceptedSpeakers.size >= 150, `expected >=150 accepted speakers, found ${acceptedSpeakers.size}`);
});

test("AC-3 · the 89-person CODE roster is real-only and deduplicated before identity allocation", () => {
  assert.equal(CODE_2025_ROSTER.length, CODE_2025_ROSTER_COUNT);
  assert.equal(new Set(CODE_2025_ROSTER.map(([name]) => name.trim())).size, CODE_2025_ROSTER_COUNT);

  const people = table("people");
  const peopleByName = groups(people, "name");
  assert.equal(new Set(people.map((person) => person.name.trim())).size, people.length);
  for (const [publishedName] of CODE_2025_ROSTER) {
    const identityName = publishedName === "Aparna Dhinakaran" ? "Aparna Dhinkaran" : publishedName.trim();
    assert.equal(peopleByName.get(identityName)?.length, 1, `${publishedName} was not reconciled to one human`);
  }

  const knownExactOverlaps = [
    "Kevin Hou", "Beyang Liu", "Ivan Leo", "Mahesh Murag", "Barry Zhang", "Will Brown",
    "Samuel Colvin", "Mahmoud Abdelwahab", "Suman Debnath", "swyx",
  ];
  for (const name of knownExactOverlaps) assert.equal(peopleByName.get(name)?.length, 1, `${name} was duplicated`);
});

test("AC-234 · at least 15 percent of submissions are multi-track and three are scheduled", () => {
  const submissions = table("submissions");
  const tracksBySubmission = groups(table("submission_tracks"), "submission_id");
  const multiTrack = submissions.filter((row) => (tracksBySubmission.get(row.id) ?? []).length >= 2);
  assert.ok(multiTrack.length / submissions.length >= 0.15, `${multiTrack.length}/${submissions.length}`);
  for (const rowsForSubmission of tracksBySubmission.values()) {
    assert.equal(rowsForSubmission.filter((row) => row.is_primary === 1).length, 1);
  }
  const scheduled = new Set(table("agenda_items").filter((row) => row.submission_id).map((row) => row.submission_id));
  assert.ok(multiTrack.filter((row) => row.status === "accepted" && scheduled.has(row.id)).length >= 3);
});

test("AC-245 · seeded recommendations cover all choices without requiring numeric scores", () => {
  const evaluations = table("evaluations");
  assert.ok(evaluations.length > 0);
  assert.deepEqual([...new Set(evaluations.map((row) => row.recommendation))].sort(), ["approve", "deny", "maybe"]);
  for (const evaluation of evaluations) {
    assert.equal(evaluation.score, null);
    assert.equal(evaluation.criteria_scores, null);
    assert.equal(evaluation.abstained, 0);
  }
});

test("AC-246 · the demo organizer has event reviewer authority, every track, and 40 unreviewed assignments", () => {
  const memberships = table("memberships");
  assert.ok(memberships.some((row) =>
    row.person_id === STAFF_PERSON_ID && row.event_id === EVENT_ID && row.role === "reviewer"));
  const scopes = table("reviewer_track_scopes").filter((row) => row.person_id === STAFF_PERSON_ID);
  assert.deepEqual(new Set(scopes.map((row) => row.track_id)), new Set(Object.values(TRACK_IDS)));

  const organizerAssignments = table("round_assignments").filter((row) =>
    row.round_id === ROUND_ONE_ID && row.reviewer_person_id === STAFF_PERSON_ID);
  const reviewed = new Set(table("evaluations").map((row) => `${row.round_id}:${row.submission_id}:${row.reviewer_person_id}`));
  const unreviewed = organizerAssignments.filter((row) =>
    !reviewed.has(`${row.round_id}:${row.submission_id}:${row.reviewer_person_id}`));
  assert.equal(unreviewed.length, ORGANIZER_UNREVIEWED_ASSIGNMENTS);
  assert.ok(unreviewed.length >= 20);

  const acceptedIds = new Set(table("submissions").filter((row) => row.status === "accepted").map((row) => row.id));
  const acceptedPeople = new Set(
    table("participations").filter((row) => acceptedIds.has(row.submission_id)).map((row) => row.person_id),
  );
  const speakerMembers = new Set(memberships.filter((row) => row.role === "speaker").map((row) => row.person_id));
  for (const personId of acceptedPeople) assert.ok(speakerMembers.has(personId), `${personId} lacks speaker authority`);
});

test("AC-249 · the seed includes 40 incomplete drafts with safe resume data", () => {
  const drafts = table("submissions").filter((row) => row.status === "draft");
  const requiredFields = table("form_fields").filter((row) => row.form_id === "frm_cfp" && row.required === 1);
  const answered = new Set(table("submission_answers").map((row) => `${row.submission_id}:${row.field_id}`));
  assert.equal(drafts.length, 40);
  assert.ok(requiredFields.length > 0, "the CFP has no applicable required field for the Drafts queue");
  for (const draft of drafts) {
    assert.equal(draft.form_id, "frm_cfp");
    assert.equal(draft.submitted_at, null);
    assert.ok(draft.last_saved_at);
    assert.match(draft.resume_token_hash, /^synthetic-resume-hash-/);
    assert.ok(requiredFields.some((field) => !answered.has(`${draft.id}:${field.id}`)));
  }
  assert.ok(drafts.some((draft) => draft.abstract === null));
  assert.ok(drafts.some((draft) => draft.format_id === null));
});

test("CONTRACT · deliberate ugliness includes long names, truncating titles, speaker cardinality, tasks, and two conflicts", () => {
  const people = table("people");
  assert.ok(people.some((row) => row.name === "Casey O'Connell-Singh"));
  assert.ok(people.some((row) => row.name === "Mei-Ling de la Fontaine"));
  assert.ok(people.some((row) => row.name.match(/[^\x00-\x7F]/)));
  assert.ok(table("submissions").some((row) => row.title.length > 160));

  const participationByPerson = groups(table("participations"), "person_id");
  const casey = people.find((row) => row.name === "Casey O'Connell-Singh");
  assert.equal(new Set(participationByPerson.get(casey.id).map((row) => row.submission_id)).size, 3);
  const participationBySubmission = groups(table("participations"), "submission_id");
  assert.ok([...participationBySubmission.values()].some((group) => group.length === 4));

  const overdue = table("speaker_tasks").filter((row) => row.status === "open" && row.due_at < Date.UTC(2026, 7, 20, 16));
  assert.ok(overdue.length >= 10);
  const requiredByPerson = groups(table("speaker_tasks").filter((row) =>
    ["Hotel and Travel Reservations", "Presentation Upload"].includes(row.title)), "person_id");
  const speakerMembers = table("memberships").filter((row) => row.role === "speaker");
  for (const member of speakerMembers) assert.equal(requiredByPerson.get(member.person_id)?.length, 2);

  const agendaBySubmission = new Map(table("agenda_items").filter((row) => row.submission_id).map((row) => [row.submission_id, row]));
  let conflictPairs = 0;
  const scheduledByPerson = groups(
    table("participations").filter((row) => agendaBySubmission.has(row.submission_id)),
    "person_id",
  );
  for (const participations of scheduledByPerson.values()) {
    const items = participations.map((row) => agendaBySubmission.get(row.submission_id));
    if (new Set(items.map((item) => item.starts_at)).size < items.length) conflictPairs += 1;
  }
  assert.ok(conflictPairs >= 2, `expected two person conflicts, found ${conflictPairs}`);
});

test("CONTRACT · the full seed remains deterministic and public-safe", async () => {
  assert.equal(await buildSeedSql(), await buildSeedSql());
  for (const person of table("people")) {
    assert.match(person.email, /^[a-z0-9-]+\.[a-z0-9-]+(?:-\d+)?@example\.com$/);
    assert.equal(person.headshot_attachment_id, null);
    assert.equal(person.is_demo, 1);
  }
  assert.equal(table("attachments").length, 0);
  for (const submission of table("submissions").filter((row) => row.status !== "accepted")) {
    assert.match(submission.external_ref, /^synthetic:/);
  }
});
