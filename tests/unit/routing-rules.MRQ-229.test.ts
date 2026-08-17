import { describe, expect, test } from "vitest";

import {
  clauseMatches,
  evaluateRoutingConditions,
  isFieldApplicable,
  validateRoutingConditions,
} from "../../src/lib/form-conditions";

describe("MRQ-229 routing condition contract", () => {
  test("AC-369 · MRQ-229 · all six answer operators use the same blank and multiselect truth table", () => {
    const blankAnswers = { missing: undefined, empty: "", whitespace: "   ", empty_list: [] };
    for (const key of Object.keys(blankAnswers)) {
      expect(clauseMatches({ fieldKey: key, op: "equals", value: "x" }, blankAnswers)).toBe(false);
      expect(clauseMatches({ fieldKey: key, op: "not_equals", value: "x" }, blankAnswers)).toBe(false);
      expect(clauseMatches({ fieldKey: key, op: "contains", value: "x" }, blankAnswers)).toBe(false);
      expect(clauseMatches({ fieldKey: key, op: "not_contains", value: "x" }, blankAnswers)).toBe(false);
      expect(clauseMatches({ fieldKey: key, op: "answered" }, blankAnswers)).toBe(false);
      expect(clauseMatches({ fieldKey: key, op: "not_answered" }, blankAnswers)).toBe(true);
    }

    const answers = {
      text: "A routing answer for arbitrary matching",
      choices: ["Platform", "AI"],
      zero: 0,
      no: false,
      file: { attachmentId: "att-1" },
    };
    expect(clauseMatches({ fieldKey: "text", op: "equals", value: "A routing answer for arbitrary matching" }, answers)).toBe(true);
    expect(clauseMatches({ fieldKey: "text", op: "contains", value: "ARBITRARY" }, answers)).toBe(true);
    expect(clauseMatches({ fieldKey: "text", op: "not_contains", value: "missing" }, answers)).toBe(true);
    expect(clauseMatches({ fieldKey: "choices", op: "contains", value: "AI" }, answers)).toBe(true);
    expect(clauseMatches({ fieldKey: "choices", op: "not_contains", value: "Design" }, answers)).toBe(true);
    expect(clauseMatches({ fieldKey: "zero", op: "answered" }, answers)).toBe(true);
    expect(clauseMatches({ fieldKey: "no", op: "equals", value: false }, answers)).toBe(true);
    expect(clauseMatches({ fieldKey: "file", op: "answered" }, answers)).toBe(true);
  });

  test("AC-369 · MRQ-229 · legacy operator aliases remain equivalent to their canonical forms", () => {
    const answers = { choice: "Platform", text: "A useful answer" };
    expect(clauseMatches({ fieldKey: "choice", op: "eq", value: "Platform" }, answers)).toBe(true);
    expect(clauseMatches({ fieldKey: "choice", op: "is_not", value: "AI" }, answers)).toBe(true);
    expect(clauseMatches({ fieldKey: "text", op: "includes", value: "useful" }, answers)).toBe(true);
    expect(clauseMatches({ fieldKey: "text", op: "not_includes", value: "missing" }, answers)).toBe(true);
    expect(clauseMatches({ fieldKey: "choice", op: "exists" }, answers)).toBe(true);
    expect(clauseMatches({ fieldKey: "missing", op: "not_exists" }, answers)).toBe(true);
  });

  test("AC-369 · MRQ-229 · saved conditions enforce one-to-five clauses, values, and schema state", () => {
    const eventFields = ["notes", "audience_outcome", "tracks"];
    expect(validateRoutingConditions([], { eventFieldKeys: eventFields }).state).toBe("invalid");
    expect(validateRoutingConditions(new Array(6).fill({ fieldKey: "notes", op: "answered" }), { eventFieldKeys: eventFields }).state).toBe("invalid");
    expect(validateRoutingConditions([{ fieldKey: "notes", op: "answered", value: "anything" }], { eventFieldKeys: eventFields }).state).toBe("invalid");
    expect(validateRoutingConditions([{ fieldKey: "notes", op: "equals", value: "" }], { eventFieldKeys: eventFields }).state).toBe("invalid");
    expect(validateRoutingConditions([{ fieldKey: "unknown", op: "answered" }], { eventFieldKeys: eventFields }).state).toBe("dangling");
    expect(validateRoutingConditions([{ fieldKey: "audience_outcome", op: "equals", value: "yes" }], {
      eventFieldKeys: eventFields,
      formFieldKeys: ["notes"],
    }).state).toBe("skipped");
    expect(validateRoutingConditions([{ fieldKey: "notes", op: "equals", value: "yes" }], {
      eventFieldKeys: eventFields,
      formFieldKeys: ["notes"],
    }).state).toBe("matched");
  });

  test("AC-371 · MRQ-229 · evaluation skips fields absent from a form and never turns a non-match into a match", () => {
    const condition = [{ fieldKey: "audience_outcome", op: "not_equals", value: "No" }] as const;
    expect(evaluateRoutingConditions(condition, {
      eventFieldKeys: ["audience_outcome", "notes"],
      formFieldKeys: ["notes"],
      answers: { notes: "MRQ-229-SKIP" },
    })).toMatchObject({ state: "skipped" });

    expect(evaluateRoutingConditions([{ fieldKey: "notes", op: "contains", value: "MRQ-229" }], {
      eventFieldKeys: ["notes"],
      formFieldKeys: ["notes"],
      answers: { notes: "unrelated" },
    })).toMatchObject({ state: "invalid", reason: null });

    expect(isFieldApplicable({ condition: { all: [{ fieldKey: "notes", op: "contains", value: "route" }] } }, { notes: "route me" })).toBe(true);
    expect(isFieldApplicable({ condition: { all: [{ fieldKey: "notes", op: "contains", value: "route" }] } }, { notes: "leave me" })).toBe(false);
  });
});
