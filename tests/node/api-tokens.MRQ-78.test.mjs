/** MRQ-78's standing guard for the organization-scoped token-admin seed row. */

import assert from "node:assert/strict";
import test from "node:test";

import { buildSeedRows } from "../../scripts/seed/index.ts";
import { EVENT_ID, ORG_ID, STAFF_PERSON_ID } from "../../scripts/seed/event.ts";
import { roleRank } from "../../src/lib/auth/scope-resolution.ts";

const rows = await buildSeedRows();
const memberships = rows
  .filter((entry) => entry.table === "memberships")
  .map((entry) => entry.row);

test("AC-242 · MRQ-78 · the generated demo seed leaves requireTokenAdmin satisfiable", () => {
  // 161 + the one sponsor Session speaker the sponsors seeder names: a named
  // sponsor speaker holds the same speaker membership every accepted speaker does.
  assert.equal(memberships.length, 162, "the shipped seed includes the organizer membership and the Agent seat membership");
  assert.ok(
    memberships.some((membership) =>
      membership.org_id === ORG_ID &&
      membership.person_id === STAFF_PERSON_ID &&
      membership.event_id === null &&
      roleRank(membership.role) >= roleRank("program_lead")),
    "the seeded organizer must have an org-scoped program-lead-or-owner membership",
  );
  assert.ok(
    memberships.some((membership) =>
      membership.event_id === EVENT_ID &&
      membership.person_id === STAFF_PERSON_ID &&
      membership.role === "reviewer"),
    "the additive org row must not remove the organizer's event reviewer membership",
  );
});
