import { readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

const styles = readFileSync(new URL("../../src/ui/evaluation/evaluation.css", import.meta.url), "utf8");

/**
 * sbek round 11 filed this against the scorecard editor: the dropdown
 * criterion's OPTIONS input showed "be, Reject" where "Accept, Maybe, Reject"
 * was stored, so an organizer could not read back what they had configured.
 *
 * It is a specificity fault, not a sizing one. `width: 100%` was already
 * written for this input and never applied: the rule that sets every inline
 * field's input to the 72px the numeric fields want carries three classes
 * (`.criterion-detail .field.inline input`) and the options rule carried two,
 * so the narrower declaration won. Measured in a browser against the shipped
 * stylesheet: the input rendered 88px with its own label 731px wide, and
 * scrollWidth exceeded clientWidth — clipped. With `.field.inline` named in the
 * options selector it renders 681px and is not clipped.
 *
 * These assertions are about that ordering surviving, which is why the 72px
 * rule is asserted too: delete it and the fix becomes accidental rather than
 * intended, and the next person to reintroduce it reopens the defect.
 */
function selectorClassCount(selector: string): number {
  return (selector.match(/\.[a-z-]+/g) ?? []).length;
}

describe("scorecard editor options field", () => {
  test("CONTRACT · scorecard editor — the options input outranks the narrow inline-field width", () => {
    const inlineRule = /\.criterion-detail \.field\.inline input \{[^}]*width: 72px[^}]*\}/.exec(styles);
    const optionsRule = /(\.criterion-detail [^{]*criterion-options[^{]*input) \{[^}]*width: 100%[^}]*\}/.exec(styles);

    expect(inlineRule, "the 72px inline-field rule this must outrank").not.toBeNull();
    expect(optionsRule, "a width rule for the options input").not.toBeNull();

    expect(selectorClassCount(optionsRule![1])).toBeGreaterThan(
      selectorClassCount(".criterion-detail .field.inline input"),
    );
  });

  test("CONTRACT · scorecard editor — the options label keeps room for the value it holds", () => {
    expect(styles).toMatch(/\.criterion-detail \.criterion-options \{[^}]*flex: 1 1 260px/);
  });
});
