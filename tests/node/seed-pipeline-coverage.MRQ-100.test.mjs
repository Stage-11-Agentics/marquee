/** MRQ-100's seeded pipeline and participant-state coverage. */

import assert from "node:assert/strict";
import test from "node:test";

import { buildSeedRows, buildSeedSql } from "../../scripts/seed/index.ts";

const rows = await buildSeedRows();

function table(name) {
  return rows.filter((entry) => entry.table === name).map((entry) => entry.row);
}

function grouped(rowsToGroup, key) {
  const groups = new Map();
  for (const row of rowsToGroup) {
    const group = groups.get(row[key]) ?? [];
    group.push(row);
    groups.set(row[key], group);
  }
  return groups;
}

test("CONTRACT · MRQ-100 keeps Submitted and Withdrawn status filters populated", () => {
  const submissions = table("submissions");
  const submitted = submissions.filter((row) => row.status === "submitted");
  const withdrawn = submissions.filter((row) => row.status === "withdrawn");

  assert.ok(submitted.length >= 1, "the Submitted filter needs a seeded row");
  assert.ok(withdrawn.length >= 1, "the Withdrawn filter needs a seeded row");
  for (const row of [...submitted, ...withdrawn]) {
    assert.equal(row.form_id, "frm_cfp");
    assert.equal(row.origin, "public");
    assert.match(row.external_ref, /^synthetic:/);
    assert.ok(row.title.length >= 20, `${row.id} needs a realistic conference title`);
  }
});

test("AC-3 · MRQ-100 has an accepted row that genuinely occupies Ready to place", () => {
  const submissions = table("submissions");
  const waves = new Map(table("waves").map((row) => [row.id, row]));
  const scheduled = new Set(table("agenda_items").filter((row) => row.kind === "session").map((row) => row.submission_id));
  const openTaskSubmissions = new Set(table("speaker_tasks").filter((row) => row.status === "open" && row.submission_id).map((row) => row.submission_id));
  const ready = submissions.filter((row) =>
    row.status === "accepted"
      && !scheduled.has(row.id)
      && !openTaskSubmissions.has(row.id)
      && (row.wave_id === null || waves.get(row.wave_id)?.sent_at !== null),
  );

  assert.ok(ready.length >= 1, "the accepted stage must have a real unplaced, task-clear, wave-sent row");
  assert.ok(ready.some((row) => row.kind === "session"), "Ready to place should read as a schedulable Session");
});

test("CONTRACT · MRQ-100 represents confirmed, pending, and declined agenda roles", () => {
  const agendaSubmissionIds = new Set(table("agenda_items").filter((row) => row.kind === "session").map((row) => row.submission_id));
  const participations = table("participations");
  const statuses = new Set(participations.map((row) => row.confirmation_status));
  assert.deepEqual([...statuses].sort(), ["confirmed", "declined", "pending"]);

  const roleRank = new Map([
    ["speaker", 0],
    ["co_speaker", 1],
    ["moderator", 2],
    ["chairperson", 3],
    ["submitter", 4],
    ["sponsor_contact", 5],
  ]);
  const bySubmission = grouped(participations, "submission_id");
  const declinedAgenda = [...agendaSubmissionIds].find((submissionId) => {
    const rowsForSubmission = bySubmission.get(submissionId) ?? [];
    const representativeByPerson = new Map();
    for (const row of rowsForSubmission) {
      const current = representativeByPerson.get(row.person_id);
      const currentRank = current ? roleRank.get(current.role) ?? 99 : 99;
      const nextRank = roleRank.get(row.role) ?? 99;
      if (!current || nextRank < currentRank || (nextRank === currentRank && row.position < current.position)) {
        representativeByPerson.set(row.person_id, row);
      }
    }
    return [...representativeByPerson.values()].some((row) => row.confirmation_status === "declined");
  });

  assert.ok(declinedAgenda, "an agenda Session must project has_declined_participant=true");
  const declinedAgendaRows = [...agendaSubmissionIds].flatMap((submissionId) =>
    (bySubmission.get(submissionId) ?? []).filter((row) => row.confirmation_status === "declined"),
  );
  assert.ok(declinedAgendaRows.length >= 2, "the demo should show more than one declined confirmation");
  const declinedGroup = bySubmission.get(declinedAgenda) ?? [];
  const declinedRows = declinedGroup.filter((row) => row.confirmation_status === "declined");
  assert.equal(declinedRows.length, 1, "the multi-role agenda case should have one declined role");
  const declinedPerson = declinedRows[0].person_id;
  assert.ok(
    declinedGroup.some((row) => row.person_id === declinedPerson && row.confirmation_status === "confirmed"),
    "the declined agenda case must retain the person's confirmed second role",
  );
  assert.ok(
    declinedGroup.some((row) => row.confirmation_status === "pending"),
    "the agenda confirmation fixture must retain a pending role",
  );
});

test("CONTRACT · MRQ-100 seed upserts converge with identical row counts", async () => {
  const counts = grouped(rows, "table");
  const firstCounts = Object.fromEntries([...counts].map(([name, tableRows]) => [name, tableRows.length]));
  const secondRows = await buildSeedRows();
  const secondCounts = Object.fromEntries(
    [...grouped(secondRows, "table")].map(([name, tableRows]) => [name, tableRows.length]),
  );
  assert.deepEqual(secondCounts, firstCounts);
  assert.equal(await buildSeedSql(), await buildSeedSql());
});
