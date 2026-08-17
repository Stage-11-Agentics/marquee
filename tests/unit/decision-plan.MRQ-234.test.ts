import { describe, expect, test } from "vitest";

import { planBulkDecision } from "../../src/jobs/cascade/decision-plan";
import { emailValiditySql, isValidEmail } from "../../src/lib/email-validity";

const template = {
  key: "acceptance",
  subject: "Your session was accepted",
  body_md: "Hi {{speaker.first_name}}",
  enabled: true,
};

describe("MRQ-234 pure decision planner", () => {
  test("AC-379 · MRQ-234 · always returns the four rows, including an empty muted shape", () => {
    const plan = planBulkDecision({ action: "accept", selected: [], template });
    expect(plan.rows.map((row) => [row.disposition, row.count])).toEqual([
      ["will_send", 0],
      ["already_notified", 0],
      ["no_valid_address", 0],
      ["cannot_move", 0],
    ]);
    expect(plan.zero_effect).toBeNull();
  });

  test("AC-379 · MRQ-234 · classifies the signed truth table without dropping records", () => {
    const plan = planBulkDecision({
      action: "accept",
      template,
      selected: [
        { id: "will", title: "Will send", email: "ada@example.test" },
        { id: "already", title: "Already notified", email: "grace@example.test", alreadyNotified: true },
        { id: "no-email", title: "No email", email: "not-an-email" },
        { id: "cannot", title: "Cannot move", email: "lin@example.test", transitionError: "submission is already rejected" },
      ],
    });
    expect(plan.rows.map((row) => ({ disposition: row.disposition, ids: row.records.map((record) => record.id) }))).toEqual([
      { disposition: "will_send", ids: ["will"] },
      { disposition: "already_notified", ids: ["already"] },
      { disposition: "no_valid_address", ids: ["no-email"] },
      { disposition: "cannot_move", ids: ["cannot"] },
    ]);
    expect(plan.zero_effect).toBeNull();
  });

  test("AC-379 · MRQ-234 · disabled templates and demo suppression stay advisory on the sendable row", () => {
    const plan = planBulkDecision({
      action: "reject",
      template: { ...template, key: "rejection", enabled: false },
      selected: [
        { id: "disabled", title: "Disabled template", email: "disabled@example.test" },
        { id: "demo", title: "Demo safe", email: "demo@example.test", demoSuppressed: true },
      ],
    });
    expect(plan.rows[0]?.count).toBe(2);
    expect(plan.rows[0]?.records.map((record) => record.reason)).toEqual([
      "The decision template is disabled; this action will send nothing.",
      "The decision template is disabled; this action will send nothing.",
    ]);
    expect(plan.demo_suppressed).toBe(1);
    expect(plan.zero_effect).toBeNull();
  });

  test("AC-379 · MRQ-234 · waitlist and withdraw are no-mail actions, not address failures", () => {
    for (const action of ["waitlist", "withdraw"] as const) {
      const plan = planBulkDecision({
        action,
        template,
        selected: [{ id: action, title: action, email: "not-an-email" }],
      });
      expect(plan.mail_mode).toBe("none");
      expect(plan.rows[0]?.records[0]).toMatchObject({ id: action, reason: `${action === "waitlist" ? "Waitlisted" : "Withdrawn"} decisions do not send an email.` });
    }
  });

  test("AC-379 · MRQ-234 · feedback is normalized in the pure contract", () => {
    const plan = planBulkDecision({ action: "accept", template, feedbackMd: "  first\r\nsecond  ", selected: [] });
    expect(plan.feedback_md).toBe("first\nsecond");
  });
});

describe("MRQ-234 shared email validity", () => {
  test("AC-379 · MRQ-234 · email validity accepts valid and rejects invalid forms", () => {
    for (const [value, expected] of [
      ["ada@example.test", true],
      [" Ada@example.test ", true],
      ["a b@c.d", false],
      ["@x.", false],
      ["a@x.", false],
      ["a@@x.test", false],
    ] as const) {
      expect(isValidEmail(value)).toBe(expected);
    }
  });

  test("AC-379 · MRQ-234 · the SQL predicate has the same named shape instead of the old LIKE twin", () => {
    const sql = emailValiditySql("people.email");
    expect(sql).toContain("length(trim(people.email)) - length(replace(trim(people.email), '@', '')) = 1");
    expect(sql).toContain("instr(substr(trim(people.email), instr(trim(people.email), '@') + 1), '.') < length(substr(trim(people.email), instr(trim(people.email), '@') + 1))");
    expect(sql).not.toContain("LIKE '%@%.%'");
  });
});
