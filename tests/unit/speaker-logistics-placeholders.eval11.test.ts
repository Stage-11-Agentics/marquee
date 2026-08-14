import { readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

import { LOGISTICS_FIELDS } from "../../src/ui/speakers/SpeakerRecord";

/**
 * sbek round 11, speaker-management: the Logistics & notes placeholders were
 * written as realistic sample values, so a record where nothing had been
 * captured read as though arrival, travel and accessibility were already on
 * file. Accessibility is what makes this worth a test rather than a tidy-up —
 * an organizer who believes a speaker's access requirement is recorded does not
 * go and ask for it.
 *
 * The contract is on the exported list, not on the shape of the file. An
 * earlier version of this test regex-parsed the source, which meant a refactor
 * of the constant could regress the UI while the test stayed green, and a
 * literal typed straight into the input would never be seen at all.
 */
const placeholders = LOGISTICS_FIELDS.map((field) => field.placeholder);

/**
 * Shapes that read as data an organizer entered rather than a request for it.
 * The first version of this guard only caught a spelled-out English month
 * followed by a day, so "Vegan", "11 May", "2026-05-11" and "5/11 evening" all
 * walked through it.
 */
const VALUE_SHAPES: Array<{ name: string; pattern: RegExp }> = [
  { name: "a month name beside a day number", pattern: /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d|\d\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*/i },
  { name: "a numeric date", pattern: /\b\d{1,4}[/-]\d{1,2}([/-]\d{1,4})?\b/ },
  { name: "a clock time", pattern: /\b\d{1,2}:\d{2}\b/ },
  // A bare capitalised noun — "Vegetarian", "Vegan" — is the specimen shape that
  // is hardest to spot, because it looks like a tidy label rather than data.
  { name: "a single bare word", pattern: /^\S+$/ },
];

describe("speaker logistics placeholders", () => {
  test("CONTRACT · speaker record — every logistics field carries a prompt", () => {
    expect(LOGISTICS_FIELDS.length).toBeGreaterThanOrEqual(6);
    for (const field of LOGISTICS_FIELDS) {
      expect(field.placeholder.trim(), `${field.key} has no placeholder`).not.toBe("");
    }
  });

  test("CONTRACT · speaker record — no placeholder is shaped like a recorded value", () => {
    for (const field of LOGISTICS_FIELDS) {
      for (const shape of VALUE_SHAPES) {
        expect(field.placeholder, `${field.key}: "${field.placeholder}" reads as ${shape.name}`)
          .not.toMatch(shape.pattern);
      }
    }
  });

  test("CONTRACT · speaker record — the shipped specimen values, and their near variants, stay out", () => {
    // The first five are verbatim from the judgement; the rest are the variants
    // that slipped past the original month-name-only guard.
    for (const specimen of [
      "May 11, evening", "May 15, midday", "Aisle seat; no red-eyes", "Step-free stage access", "Vegetarian",
      "Vegan", "11 May", "2026-05-11", "5/11 evening", "09:00",
    ]) {
      expect(placeholders, `"${specimen}" is a value, not a prompt`).not.toContain(specimen);
    }
  });

  test("CONTRACT · speaker record — the shape guard actually recognises those variants", () => {
    // A guard nobody has tested against a known-bad value is decoration. Each
    // of these must trip at least one shape, or the case above is the only
    // thing standing between a specimen and the screen.
    for (const specimen of ["May 11, evening", "Vegan", "11 May", "2026-05-11", "5/11 evening", "09:00", "Vegetarian"]) {
      const caught = VALUE_SHAPES.some((shape) => shape.pattern.test(specimen));
      expect(caught, `no shape recognises "${specimen}"`).toBe(true);
    }
  });

  test("CONTRACT · speaker record — the prompts are what the inputs actually render", () => {
    // The list is only a contract if the screen uses it. Asserting the seam
    // rather than the file layout: a literal typed into the input instead would
    // fail here.
    const source = readFileSync(new URL("../../src/ui/speakers/SpeakerRecord.tsx", import.meta.url), "utf8");
    const panel = source.slice(source.indexOf("Logistics &amp; notes"));

    expect(panel).toContain("LOGISTICS_FIELDS.map");
    expect(panel).toMatch(/placeholder=\{field\.placeholder\}/);
  });
});
