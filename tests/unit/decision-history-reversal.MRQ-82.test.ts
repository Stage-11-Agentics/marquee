import { describe, expect, test } from "vitest";

import { decisionHistory, reversalNote } from "../../src/lib/decision-history";

const ACCEPTED = { id: "dec_accept", decision: "approve", resulting_status: "accepted", feedback_md: null, decided_at: 1000, decided_by_name: "AIE Program Committee" };

function reversal(after: Record<string, unknown>, created_at = 2000, id = "aud_rev") {
  return { id, after_json: JSON.stringify({ status: "withdrawn", ...after }), created_at, actor_name: "AIE Program Committee" };
}

const ALL_CANCELLED = { tasks: "cancel", emails: "cancel", calendar: "cancel", tasks_cancelled: 3, emails_cancelled: 1, calendar_cancelled: 1 };

describe("CONTRACT · an acceptance reversal appears in Decision History", () => {
  test("CONTRACT · a withdrawn record shows the reversal the decisions alone cannot record", () => {
    // `submission_decisions` CHECKs resulting_status IN
    // ('accepted','waitlisted','rejected'), so a withdrawal can never be a row
    // there. Before this, a withdrawn record's history showed only "Accepted"
    // and an organizer could not tell it from a record never accepted at all.
    const entries = decisionHistory([ACCEPTED], [reversal(ALL_CANCELLED)]);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ kind: "reversal", resulting_status: "withdrawn", decided_by_name: "AIE Program Committee", decided_at: 2000 });
    expect(entries[1]).toMatchObject({ kind: "decision", resulting_status: "accepted" });
  });

  test("CONTRACT · a record never reversed is completely unchanged", () => {
    const entries = decisionHistory([ACCEPTED], []);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ kind: "decision", resulting_status: "accepted", note: null });
  });

  test("CONTRACT · a record reversed twice reads newest first", () => {
    const entries = decisionHistory([ACCEPTED], [reversal(ALL_CANCELLED, 4000, "aud_b"), reversal(ALL_CANCELLED, 2000, "aud_a")]);
    expect(entries.map((entry) => entry.decided_at)).toEqual([4000, 2000, 1000]);
  });

  test("CONTRACT · a reversal to rejected sorts above the decision row it caused", () => {
    // The rejected branch writes its own submission_decisions row at the same
    // millisecond. Cause must read above consequence or the pair looks like two
    // unrelated rejections.
    const rejectedRow = { ...ACCEPTED, id: "dec_reject", decision: "deny", resulting_status: "rejected", decided_at: 2000 };
    const entries = decisionHistory([rejectedRow, ACCEPTED], [reversal({ ...ALL_CANCELLED, status: "rejected" })]);
    expect(entries.map((entry) => entry.kind)).toEqual(["reversal", "decision", "decision"]);
  });

  test("CONTRACT · a malformed audit payload degrades instead of breaking the record", () => {
    // The record page is the busiest screen in the product. A bad JSON blob in
    // one audit row must not take the whole history down with it.
    const entries = decisionHistory([], [{ id: "aud_bad", after_json: "{not json", created_at: 5000, actor_name: null }]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ kind: "reversal", resulting_status: "" });
  });
});

describe("CONTRACT · the reversal note says what the cascade actually did", () => {
  test("CONTRACT · cancelled branches are counted and named", () => {
    expect(reversalNote({ ...ALL_CANCELLED })).toBe("3 speaker tasks cancelled, 1 queued email cancelled, 1 calendar invite cancelled");
  });

  test("CONTRACT · retained branches are reported as loudly as cancelled ones", () => {
    // An organizer checking a pulled talk later needs to know the speaker's
    // tasks are still live just as much as they need to know they were pulled.
    // A note listing only cancellations reads as a complete account when it
    // is not one.
    expect(reversalNote({ tasks: "retain", emails: "retain", calendar: "retain" }))
      .toBe("speaker tasks kept, queued emails kept, calendar invite kept");
  });

  test("CONTRACT · a branch chosen to cancel with nothing to cancel says so", () => {
    expect(reversalNote({ tasks: "cancel", emails: "cancel", calendar: "cancel", tasks_cancelled: 0, emails_cancelled: 0, calendar_cancelled: 0 }))
      .toBe("no speaker tasks to cancel, no queued emails to cancel, no calendar invites to cancel");
  });

  test("CONTRACT · the note never leaks a field name or a status slug", () => {
    const note = reversalNote({ ...ALL_CANCELLED, task_cancellation_reason: "withdrawn_after_acceptance" });
    for (const slug of ["tasks_cancelled", "emails_cancelled", "calendar_cancelled", "withdrawn_after_acceptance", "retain", "cancel_"]) {
      expect(note).not.toContain(slug);
    }
  });
});
