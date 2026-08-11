import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const recordStyles = readFileSync(fileURLToPath(new URL("../../src/ui/submissions/record.css", import.meta.url)), "utf8");

test("CONTRACT · the record summary cannot blow out its grid track on an unbreakable token", () => {
  // .record-summary's first child (title + abstract) is a flex item; without an
  // explicit min-width it defaults to min-width:auto, which lets an unbreakable
  // run of text (e.g. a long URL with no spaces or hyphens) hold the item at its
  // min-content width and paint over the fixed-width aside beside it, even
  // though the grid track itself stays correctly sized. Both declarations below
  // are required together: overflow-wrap gives the text a break point, and
  // min-width:0 lets the flex item actually shrink to use it.
  expect(recordStyles).toMatch(/\.record-summary > div:first-child \{ min-width: 0; \}/);
  expect(recordStyles).toMatch(/\.record-summary p \{[^}]*overflow-wrap: anywhere;/);
});
