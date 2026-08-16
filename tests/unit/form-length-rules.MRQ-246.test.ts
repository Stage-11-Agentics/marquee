import { describe, expect, test } from "vitest";

import {
  evaluateFormLengthRules,
  projectApplicableAnswers,
  type FormFieldAnswerInput,
  type FormLengthRule,
} from "../../src/lib/form-conditions";

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
  test("CONTRACT · MRQ-246 · counts projected answers and gives condition-hidden fields zero weight", () => {
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

  test("CONTRACT · MRQ-246 · the same answers flip from pass to refusal when the conditional field appears", () => {
    const projected = projectApplicableAnswers(fields, {
      include_bio: "Yes",
      title: "Title",
      abstract: "12345",
      bio: "extra",
    }, [programmeRule]);

    expect(projected.issues).toEqual([{
      fieldKey: "title",
      message: "Printed programme block is 5 characters over its 10-character limit.",
    }]);
    expect(evaluateFormLengthRules([programmeRule], fields, projected.answers)[0]).toMatchObject({
      character_count: 15,
      over_by: 5,
      disabled: false,
    });
  });

  test("CONTRACT · MRQ-246 · soft-disables a rule whose field was deleted and evaluates no-rule forms at no cost", () => {
    const remainingFields = fields.filter((field) => field.key !== "bio");
    const disabled = evaluateFormLengthRules([programmeRule], remainingFields, { title: "Title", abstract: "12345" })[0];

    expect(disabled).toMatchObject({ disabled: true, missing_field_keys: ["bio"], over_by: 0 });
    expect(projectApplicableAnswers(remainingFields, { title: "Title", abstract: "12345" }, [programmeRule]).issues).toEqual([]);
    expect(evaluateFormLengthRules([], remainingFields, { title: "Title" })).toEqual([]);
  });

  test("CONTRACT · MRQ-246 · orders multiple rules by sort order and then stable id", () => {
    const rules = [
      { ...programmeRule, id: "z-last", sort_order: 2 },
      { ...programmeRule, id: "b-first", sort_order: 1 },
      { ...programmeRule, id: "a-first", sort_order: 1 },
    ];

    expect(evaluateFormLengthRules(rules, fields, {}).map((rule) => rule.id)).toEqual(["a-first", "b-first", "z-last"]);
  });
});
