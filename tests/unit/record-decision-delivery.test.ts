import { describe, expect, test } from "vitest";

import { decisionRecipient } from "../../src/lib/decision-history";
import { lastSendLine, sendMomentFor, sendOutcome, type DecisionSend } from "../../src/ui/submissions/record-copy";

function send(overrides: Partial<DecisionSend> = {}): DecisionSend {
  return {
    to_email: "priya@example.com",
    status: "sent",
    delivery_state: "unknown",
    reason: null,
    created_at: Date.UTC(2026, 7, 12, 15, 4),
    sent_at: Date.UTC(2026, 7, 12, 15, 5),
    delivered_at: null,
    ...overrides,
  };
}

describe("CONTRACT · decision delivery names the address the last send used", () => {
  test("CONTRACT · with no send on file the card says so instead of inventing one", () => {
    expect(lastSendLine([], "priya@example.com")).toBe("No decision mail has been queued for this record yet.");
  });

  test("CONTRACT · the last send is named by address, moment, and outcome", () => {
    const line = lastSendLine([send()], "priya@example.com");
    expect(line).toContain("priya@example.com");
    expect(line).toContain("Aug 12");
    expect(line).toContain("Sent");
  });

  test("CONTRACT · a corrected address is called out against the address that was used", () => {
    // The whole point of the card: "send it again" is a trap if the organizer
    // cannot see that the last attempt went somewhere else.
    const line = lastSendLine([send({ to_email: "priya@exmaple.com" })], "priya@example.com");
    expect(line).toContain("priya@exmaple.com");
    expect(line).toContain("The speaker record now reads priya@example.com.");
  });

  test("CONTRACT · an unchanged address is not reported as a change", () => {
    expect(lastSendLine([send()], " Priya@Example.com ")).not.toContain("now reads");
  });

  test("CONTRACT · a bounce outranks the transport's own success", () => {
    // A row can be `sent` and still have hard-bounced. Reading "Sent" to an
    // organizer chasing a silent speaker is the reassurance that keeps that
    // speaker uninformed.
    expect(sendOutcome(send({ delivery_state: "bounced_hard" }))).toEqual({ label: "Bounced", tone: "alarm" });
    expect(sendOutcome(send({ status: "suppressed" })).label).toBe("Held, not sent");
    expect(sendOutcome(send({ status: "failed" })).tone).toBe("alarm");
    expect(sendOutcome(send({ status: "queued", sent_at: null })).label).toBe("Queued");
    expect(sendOutcome(send({ delivery_state: "delivered" })).tone).toBe("success");
  });

  test("CONTRACT · the moment shown is the one the outcome refers to", () => {
    const delivered = send({ delivery_state: "delivered", delivered_at: Date.UTC(2026, 7, 12, 15, 9) });
    expect(sendMomentFor(delivered)).toBe(Date.UTC(2026, 7, 12, 15, 9));
    expect(sendMomentFor(send({ sent_at: null, status: "queued" }))).toBe(Date.UTC(2026, 7, 12, 15, 4));
  });
});

describe("CONTRACT · the recipient the card names is the recipient the sender uses", () => {
  const rows = [
    { person_id: "per_sub", name: "Ops Inbox", email: "ops@example.com", role: "submitter", position: 0 },
    { person_id: "per_co", name: "Sam Co", email: "sam@example.com", role: "co_speaker", position: 1 },
    { person_id: "per_speaker", name: "Priya Speaker", email: "priya@example.com", role: "speaker", position: 2 },
  ];

  test("CONTRACT · the speaker outranks the submitter, whatever their position", () => {
    // Mirrors loadSubmission's ORDER BY in src/jobs/cascade/decisions.ts.
    expect(decisionRecipient(rows)?.email).toBe("priya@example.com");
  });

  test("CONTRACT · with no speaker the submitter is the recipient, and a co-speaker never is", () => {
    expect(decisionRecipient(rows.filter((row) => row.role !== "speaker"))?.email).toBe("ops@example.com");
  });

  test("CONTRACT · two speakers resolve by position, as the sender's ORDER BY does", () => {
    const second = { person_id: "per_two", name: "Second Speaker", email: "second@example.com", role: "speaker", position: 5 };
    expect(decisionRecipient([second, ...rows])?.email).toBe("priya@example.com");
  });

  test("CONTRACT · a record with nobody on it reports nobody", () => {
    expect(decisionRecipient([])).toBeNull();
  });
});
