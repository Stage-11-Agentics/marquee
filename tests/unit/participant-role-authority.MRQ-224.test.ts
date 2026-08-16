/**
 * One role authority, asserted by enumeration.
 *
 * The bug this guards is not that any single fan-out was wrong — it is that
 * three of them each carried their own literal role list and disagreed. Task
 * reconciliation and calendar invites read `(speaker, submitter)`; event
 * membership read `(speaker, co_speaker)`. A moderator satisfied none of them,
 * so someone the conference had accepted and printed on the published agenda
 * received no calendar invite, held no membership row, and could not sign in to
 * their own portal — while the conflict engine had been treating them as on
 * stage the whole time.
 *
 * A behavioural test would have caught the moderator and missed the next role.
 * This one asserts the shape instead: the sets live in one module, and the
 * three consumers read them rather than restating them.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

import {
  CALENDAR_PARTICIPATION_ROLES,
  DECISION_RECIPIENT_ROLES,
  primaryParticipantSql,
  PROGRAM_PRIMACY_ROLES,
  roleInSql,
  SPEAKING_PARTICIPATION_ROLES,
  WORK_HOLDING_PARTICIPATION_ROLES,
} from "../../src/lib/participants";
import { PARTICIPATION_ROLES } from "../../src/db/schema";

const ROOT = resolve(import.meta.dirname, "../..");

/** The three fan-outs the ticket names, and the set each one must read. */
const CONSUMERS = [
  { file: "src/jobs/cascade/decisions.ts", set: "WORK_HOLDING_PARTICIPATION_ROLES" },
  { file: "src/jobs/calendar/invites.ts", set: "CALENDAR_PARTICIPATION_ROLES" },
  { file: "src/lib/speaker-membership.ts", set: "WORK_HOLDING_PARTICIPATION_ROLES" },
] as const;

function sourceOf(file: string): string {
  return readFileSync(resolve(ROOT, file), "utf8");
}

describe("MRQ-224 · the participant role authority", () => {
  test("AC-333 · every declared set is the on-stage population, spelled out once", () => {
    // Against literals, not against each other. Asserting
    // `WORK_HOLDING === SPEAKING` where one is assigned from the other cannot
    // fail; what can fail — and is worth catching — is somebody widening
    // `PARTICIPATION_ROLES` and expecting every fan-out to follow, or narrowing
    // the stage and leaving a role holding work it can no longer be given.
    const stage = ["speaker", "co_speaker", "moderator", "chairperson"];
    expect([...WORK_HOLDING_PARTICIPATION_ROLES]).toEqual(stage);
    expect([...SPEAKING_PARTICIPATION_ROLES]).toEqual(stage);
    // AC-328 binds a calendar-recipient `submitter` by name: a cancellation has
    // to reach them when their participation is removed.
    expect([...CALENDAR_PARTICIPATION_ROLES]).toEqual([...stage, "submitter"]);
    expect([...PROGRAM_PRIMACY_ROLES]).toEqual([...stage, "submitter"]);
    expect([...DECISION_RECIPIENT_ROLES]).toEqual(["submitter", ...stage]);
    // The submitter holds no stage work: they are in the calendar and decision
    // sets and in neither of the two that mint tasks and portal seats.
    expect(WORK_HOLDING_PARTICIPATION_ROLES).not.toContain("submitter");
    // And every declared role is a real column value.
    for (const role of new Set([...CALENDAR_PARTICIPATION_ROLES, ...DECISION_RECIPIENT_ROLES])) {
      expect(PARTICIPATION_ROLES).toContain(role);
    }
  });

  test("AC-334 · the decision ladder is the program ladder inverted", () => {
    // Same people, opposite ends. A decision answers whoever submitted the
    // abstract; the program names whoever will deliver it.
    expect(DECISION_RECIPIENT_ROLES[0]).toBe("submitter");
    expect(PROGRAM_PRIMACY_ROLES[0]).toBe("speaker");
    expect([...DECISION_RECIPIENT_ROLES].sort()).toEqual([...PROGRAM_PRIMACY_ROLES].sort());
  });

  test("AC-333 · all three fan-outs read the authority instead of restating it", () => {
    for (const { file, set } of CONSUMERS) {
      const source = sourceOf(file);
      expect(source, `${file} should read ${set}`).toContain(set);
      // A literal `role IN ('…')` over participations is exactly the drift this
      // ticket removed. `roleInSql` renders the same SQL from the named set.
      // Alias-agnostic on purpose: naming the three aliases in use today would
      // pass the moment somebody introduces a fourth.
      expect(source, `${file} still carries a literal participation role list`)
        .not.toMatch(/\w+\.role IN \('/);
      expect(source, `${file} still carries a bare literal role list`)
        .not.toMatch(/\brole IN \('/);
    }
  });

  test("CONTRACT · roleInSql renders a bound-free IN list over the named set", () => {
    expect(roleInSql("part", WORK_HOLDING_PARTICIPATION_ROLES)).toBe(
      "part.role IN ('speaker', 'co_speaker', 'moderator', 'chairperson')",
    );
  });

  test("AC-334 · the primacy ladder ranks every role it admits, in order", () => {
    const sql = primaryParticipantSql({
      submissionId: "s.id",
      column: "email",
      order: DECISION_RECIPIENT_ROLES,
      fallback: "submitter.email",
    });
    expect(sql).toContain("WHEN 'submitter' THEN 0");
    expect(sql).toContain("WHEN 'speaker' THEN 1");
    expect(sql).toContain("primary_person.email");
    expect(sql).toContain("submitter.email");
    // Every admitted role gets a rank; an unranked role would sort last and
    // make the ladder's order a lie for whichever role was forgotten.
    for (const role of DECISION_RECIPIENT_ROLES) expect(sql).toContain(`WHEN '${role}' THEN`);
  });
});
