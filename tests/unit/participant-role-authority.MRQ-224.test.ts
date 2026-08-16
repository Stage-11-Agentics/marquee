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
  test("CONTRACT · being on stage and holding the work are the same population", () => {
    expect([...WORK_HOLDING_PARTICIPATION_ROLES]).toEqual([...SPEAKING_PARTICIPATION_ROLES]);
    expect([...WORK_HOLDING_PARTICIPATION_ROLES]).toEqual([
      "speaker",
      "co_speaker",
      "moderator",
      "chairperson",
    ]);
  });

  test("CONTRACT · the calendar adds the submitter to the stage, and nothing else", () => {
    // AC-328 binds a calendar-recipient `submitter` by name: a cancellation has
    // to reach them when their participation is removed. Derived rather than
    // typed out, so widening the stage widens the invite list with it.
    expect([...CALENDAR_PARTICIPATION_ROLES]).toEqual([
      ...WORK_HOLDING_PARTICIPATION_ROLES,
      "submitter",
    ]);
  });

  test("CONTRACT · the decision ladder is the program ladder inverted (AC-223)", () => {
    // Same people, opposite ends. A decision answers whoever submitted the
    // abstract; the program names whoever will deliver it.
    expect(DECISION_RECIPIENT_ROLES[0]).toBe("submitter");
    expect(PROGRAM_PRIMACY_ROLES[0]).toBe("speaker");
    expect([...DECISION_RECIPIENT_ROLES].sort()).toEqual([...PROGRAM_PRIMACY_ROLES].sort());
  });

  test.each(CONSUMERS)("CONTRACT · $file reads the authority instead of restating it", ({ file, set }) => {
    const source = sourceOf(file);
    expect(source).toContain(set);
    // A literal `role IN ('…')` over participations is exactly the drift this
    // ticket removed. `roleInSql` renders the same SQL from the named set.
    expect(source).not.toMatch(/(?:part|participation|speaker_part)\.role IN \('/);
  });

  test("CONTRACT · roleInSql renders a bound-free IN list over the named set", () => {
    expect(roleInSql("part", WORK_HOLDING_PARTICIPATION_ROLES)).toBe(
      "part.role IN ('speaker', 'co_speaker', 'moderator', 'chairperson')",
    );
  });

  test("CONTRACT · the primacy ladder ranks every role it admits, in order", () => {
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
