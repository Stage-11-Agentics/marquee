/** MRQ-23's executable evidence for the full-seed check contract. */

import assert from "node:assert/strict";
import test from "node:test";

import { buildSeedRows } from "../../scripts/seed/index.ts";
import { EVENT_ID, STAFF_PERSON_ID } from "../../scripts/seed/event.ts";
import { ORGANIZER_UNREVIEWED_ASSIGNMENTS, ROUND_ONE_ID } from "../../scripts/seed/evaluations.ts";

const rows = await buildSeedRows();
const table = (name) => rows.filter((entry) => entry.table === name).map((entry) => entry.row);

test("AC-3 · MRQ-23 check contract keeps the full seed and reachable reviewer work", () => {
  // The competitive pool, not the row count: sponsor Sessions are guaranteed
  // placements that never entered it (SPEC §6, Amendment 23). Both partitions are
  // asserted, so narrowing the pool's scope cannot hide a change in the other one.
  const allSubmissions = table("submissions");
  const submissions = allSubmissions.filter((submission) => !submission.sponsorship_id);
  assert.equal(submissions.length, 1_000);
  assert.equal(submissions.filter((submission) => submission.status === "accepted").length, 60);
  assert.equal(allSubmissions.length - submissions.length, 3, "the sponsor Session population drifted");

  const memberships = table("memberships");
  assert.ok(memberships.some((membership) => membership.event_id === EVENT_ID && membership.person_id === "per_aie-program-committee" && membership.role === "reviewer"));
  const assignments = table("round_assignments").filter((assignment) => assignment.round_id === ROUND_ONE_ID && assignment.reviewer_person_id === STAFF_PERSON_ID);
  const reviewed = new Set(table("evaluations").map((evaluation) => `${evaluation.round_id}:${evaluation.submission_id}:${evaluation.reviewer_person_id}`));
  const unreviewed = assignments.filter((assignment) => !reviewed.has(`${assignment.round_id}:${assignment.submission_id}:${assignment.reviewer_person_id}`));
  assert.equal(unreviewed.length, ORGANIZER_UNREVIEWED_ASSIGNMENTS);
  assert.ok(unreviewed.length >= 20);
});
