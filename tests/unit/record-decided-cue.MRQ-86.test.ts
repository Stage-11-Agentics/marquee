import { describe, expect, test } from "vitest";

import { decidedNote, UNDECIDED_RECORD_ACTION_COPY as UNDECIDED_COPY } from "../../src/ui/submissions/record-copy";

function decision(resulting_status: string, decided_at: number) {
  return { id: "dec_1", decision: "approve", resulting_status, feedback_md: null, decided_at, decided_by_name: "AIE Program Committee" };
}

describe("CONTRACT · the record action card names a standing decision", () => {
  test("CONTRACT · an undecided record keeps the unconditional copy", () => {
    expect(decidedNote(undefined)).toBe(UNDECIDED_COPY);
  });

  test("CONTRACT · a decided record names the decision and when it was taken", () => {
    // decisions[] arrives newest-first (submission-record.routes.ts ORDER BY
    // decided_at DESC), so the head is the decision that currently stands.
    const note = decidedNote(decision("accepted", Date.UTC(2026, 7, 18, 12)));
    expect(note).toContain("Accepted");
    expect(note).toContain("Aug 18, 2026");
  });

  test("CONTRACT · a waitlisted record reads Maybe, the organizer-facing name", () => {
    // DESIGN.md: Maybe is the waitlist's display name. The raw status slug must
    // never reach the card.
    const note = decidedNote(decision("waitlisted", Date.UTC(2026, 7, 19, 12)));
    expect(note).toContain("Maybe");
    expect(note).not.toContain("waitlisted");
  });

  test("CONTRACT · the decided copy cannot wrap past the undecided copy and shift the header", () => {
    // DESIGN.md's "elements never jump" rule. The cue shares the card header's
    // one .subtle slot with the undecided copy, so the only way the header can
    // change height between the two states is the decided string wrapping to
    // more lines. Holding it strictly shorter than the string already shipping
    // there makes that impossible at every width, with no reserved space and no
    // min-height to keep in sync with the font.
    for (const status of ["accepted", "waitlisted", "rejected", "withdrawn"]) {
      const note = decidedNote(decision(status, Date.UTC(2026, 11, 28, 12)));
      expect(note.length).toBeLessThanOrEqual(UNDECIDED_COPY.length);
    }
  });
});
