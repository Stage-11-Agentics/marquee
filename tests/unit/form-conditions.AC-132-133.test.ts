import { describe, expect, test } from "vitest";

import {
  fieldPreviewProjection,
  isFieldApplicable,
  isIsoDate,
  projectApplicableAnswers,
} from "../../src/lib/form-conditions";

const fields = [
  { key: "vendor_content", label: "Vendor content", type: "single_select", required: true, position: 0, config: { options: ["No", "Yes"] }, condition: null },
  { key: "vendor_product", label: "Product", type: "short_text", required: true, position: 1, config: { minLength: 2 }, condition: { all: [{ fieldKey: "vendor_content", op: "equals", value: "Yes" }] } },
  { key: "workshop_notes", label: "Workshop notes", type: "long_text", required: true, position: 2, config: { minLength: 5 }, condition: { all: [
    { fieldKey: "vendor_content", op: "equals", value: "Yes" },
    { fieldKey: "vendor_product", op: "answered" },
  ] } },
] as const;

describe("MRQ-13 shared condition contract", () => {
  test("AC-132 · show/hide conditions work for one prior answer in both directions", () => {
    const field = fields[1];
    expect(isFieldApplicable(field, { vendor_content: "Yes" })).toBe(true);
    expect(isFieldApplicable(field, { vendor_content: "No" })).toBe(false);
    expect(isFieldApplicable(field, {})).toBe(false);
  });

  test("AC-132 · show/hide conditions require every prior answer for multiple clauses in both directions", () => {
    const field = fields[2];
    expect(isFieldApplicable(field, { vendor_content: "Yes", vendor_product: "Acme" })).toBe(true);
    expect(isFieldApplicable(field, { vendor_content: "No", vendor_product: "Acme" })).toBe(false);
    expect(isFieldApplicable(field, { vendor_content: "Yes" })).toBe(false);
    expect(isFieldApplicable(field, { vendor_content: "Yes", vendor_product: "" })).toBe(false);
  });

  test("AC-133 · a hidden required field is omitted from a submission and its supplied value is not persisted", () => {
    const withoutHiddenField = projectApplicableAnswers(fields, { vendor_content: "No" });
    expect(withoutHiddenField.issues).toEqual([]);
    expect(withoutHiddenField.answers).toEqual({ vendor_content: "No" });

    const suppliedWhileHidden = projectApplicableAnswers(fields, {
      vendor_content: "No",
      vendor_product: "secret product that must not be written",
      workshop_notes: "also hidden",
    });
    expect(suppliedWhileHidden.issues).toEqual([]);
    expect(suppliedWhileHidden.answers).toEqual({ vendor_content: "No" });

    const revealed = projectApplicableAnswers(fields, { vendor_content: "Yes" });
    expect(revealed.issues).toEqual([
      { fieldKey: "vendor_product", message: "This field is required." },
    ]);
    expect(revealed.answers).toEqual({ vendor_content: "Yes" });
  });

  test("AC-19 · the preview projection preserves label, type, order, required, and condition", () => {
    expect(fieldPreviewProjection([...fields].reverse())).toEqual([
      { key: "vendor_content", label: "Vendor content", type: "single_select", position: 0, required: true, condition: null },
      { key: "vendor_product", label: "Product", type: "short_text", position: 1, required: true, condition: { all: [{ fieldKey: "vendor_content", op: "equals", value: "Yes" }] } },
      { key: "workshop_notes", label: "Workshop notes", type: "long_text", position: 2, required: true, condition: { all: [{ fieldKey: "vendor_content", op: "equals", value: "Yes" }, { fieldKey: "vendor_product", op: "answered" }] } },
    ]);
  });

  test("CONTRACT · MRQ-95 date answers validate as calendar days and keep conditional comparisons zone-free", () => {
    const dateFields = [
      { key: "arrival_date", label: "Arrival date", type: "date", required: true, position: 0, config: {}, condition: null },
      { key: "departure_notes", label: "Departure notes", type: "long_text", required: false, position: 1, config: {}, condition: { all: [{ fieldKey: "arrival_date", op: "equals", value: "2026-10-12" }] } },
    ] as const;

    expect(isIsoDate("2028-02-29")).toBe(true);
    expect(isIsoDate("2025-02-29")).toBe(false);
    expect(isIsoDate("0000-01-01")).toBe(false);
    expect(isIsoDate("2026-10-12T00:00:00Z")).toBe(false);

    const malformed = projectApplicableAnswers(dateFields, { arrival_date: "2026-02-30" });
    expect(malformed.issues).toEqual([
      { fieldKey: "arrival_date", message: "Enter a valid date in YYYY-MM-DD format." },
    ]);
    expect(malformed.answers).toEqual({});

    const valid = projectApplicableAnswers(dateFields, { arrival_date: "2026-10-12" });
    expect(valid.issues).toEqual([]);
    expect(valid.answers).toEqual({ arrival_date: "2026-10-12" });
    expect(isFieldApplicable(dateFields[1], valid.answers)).toBe(true);
    expect(isFieldApplicable(dateFields[1], { arrival_date: "2026-10-13" })).toBe(false);
  });

  test("CONTRACT · MRQ-95 dates do not inherit text length or pattern rules", () => {
    const field = {
      key: "arrival_date",
      label: "Arrival date",
      type: "date",
      required: true,
      position: 0,
      config: { minLength: 20, maxLength: 1, pattern: "^not-a-date$" },
      condition: null,
    } as const;

    expect(projectApplicableAnswers([field], { arrival_date: "2026-10-12" })).toEqual({
      answers: { arrival_date: "2026-10-12" },
      issues: [],
    });
  });
});
