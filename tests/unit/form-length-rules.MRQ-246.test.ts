import { describe, expect, test } from "vitest";

import {
  evaluateFormLengthRules,
  projectApplicableAnswers,
  type FormFieldAnswerInput,
  type FormLengthRule,
} from "../../src/lib/form-conditions";
import { publicIssueMessage } from "../../src/routes/public-form.shared";

const fields: FormFieldAnswerInput[] = [
  { key: "include_bio", type: "single_select" },
  { key: "title", type: "short_text" },
  { key: "abstract", type: "long_text" },
  {
    key: "bio",
    type: "long_text",
    condition: { all: [{ fieldKey: "include_bio", op: "equals", value: "Yes" }] },
  },
];

const programmeRule: FormLengthRule = {
  id: "programme",
  label: "Printed programme block",
  field_keys: ["title", "abstract", "bio"],
  max_chars: 10,
  sort_order: 0,
};

describe("MRQ-246 combined character budgets", () => {
  test("AC-399 · MRQ-246 · counts projected answers and gives condition-hidden fields zero weight", () => {
    const projected = projectApplicableAnswers(fields, {
      include_bio: "No",
      title: "Title",
      abstract: "12345",
      bio: "hidden legacy answer",
    }, [programmeRule]);

    expect(projected.answers).toEqual({ include_bio: "No", title: "Title", abstract: "12345" });
    expect(projected.issues).toEqual([]);
    expect(evaluateFormLengthRules([programmeRule], fields, projected.answers)[0]).toMatchObject({
      character_count: 10,
      over_by: 0,
      disabled: false,
    });
  });

  test("AC-399 · MRQ-246 · the same answers flip from pass to refusal when the conditional field appears", () => {
    const projected = projectApplicableAnswers(fields, {
      include_bio: "Yes",
      title: "Title",
      abstract: "12345",
      bio: "extra",
    }, [programmeRule]);

    expect(projected.issues).toEqual([{
      fieldKey: "title",
      kind: "form_length_rule",
      fieldKeys: ["title", "abstract", "bio"],
      message: "Printed programme block is 5 characters over its 10-character limit.",
    }]);
    expect(evaluateFormLengthRules([programmeRule], fields, projected.answers)[0]).toMatchObject({
      character_count: 15,
      over_by: 5,
      disabled: false,
    });
  });

  test("AC-400 · MRQ-246 · soft-disables a rule whose field was deleted and evaluates no-rule forms at no cost", () => {
    const remainingFields = fields.filter((field) => field.key !== "bio");
    const disabled = evaluateFormLengthRules([programmeRule], remainingFields, { title: "Title", abstract: "12345" })[0];

    expect(disabled).toMatchObject({ disabled: true, missing_field_keys: ["bio"], over_by: 0 });
    expect(projectApplicableAnswers(remainingFields, { title: "Title", abstract: "12345" }, [programmeRule]).issues).toEqual([]);
    expect(evaluateFormLengthRules([], remainingFields, { title: "Title" })).toEqual([]);
  });

  test("AC-400 · MRQ-246 · orders multiple rules by sort order and then stable id", () => {
    const rules = [
      { ...programmeRule, id: "z-last", sort_order: 2 },
      { ...programmeRule, id: "b-first", sort_order: 1 },
      { ...programmeRule, id: "a-first", sort_order: 1 },
    ];

    expect(evaluateFormLengthRules(rules, fields, {}).map((rule) => rule.id)).toEqual(["a-first", "b-first", "z-last"]);
  });

  test("AC-402 · MRQ-246 · focuses the first visible member when a rule starts with a hidden field", () => {
    const conditionalFields: FormFieldAnswerInput[] = [
      { key: "show_bio", type: "single_select" },
      { key: "hidden_bio", type: "long_text", condition: { all: [{ fieldKey: "show_bio", op: "equals", value: "yes" }] } },
      { key: "visible_abstract", type: "long_text" },
    ];
    const rule: FormLengthRule = {
      id: "conditional-programme",
      label: "Updated programme block",
      field_keys: ["hidden_bio", "visible_abstract"],
      max_chars: 3,
    };

    const projected = projectApplicableAnswers(conditionalFields, {
      show_bio: "no",
      hidden_bio: "hidden legacy answer",
      visible_abstract: "four",
    }, [rule]);

    expect(projected.issues[0]).toMatchObject({
      fieldKey: "visible_abstract",
      kind: "form_length_rule",
      fieldKeys: ["hidden_bio", "visible_abstract"],
    });
  });

  test("AC-402 · MRQ-246 · public copy uses field type and never label substrings", () => {
    const issue = {
      fieldKey: "programme",
      kind: "form_length_rule" as const,
      message: "Updated programme block is 2 characters over its 20-character limit.",
    };

    expect(publicIssueMessage(issue, { key: "programme", type: "long_text" })).toBe(
      "Updated programme block is 2 characters over its 20-character limit. Then try again.",
    );
    expect(publicIssueMessage(
      { fieldKey: "arrival_date", message: "Enter a valid date in YYYY-MM-DD format." },
      { key: "arrival_date", type: "date" },
    )).toBe("Choose a valid date, then try again.");
  });
});
