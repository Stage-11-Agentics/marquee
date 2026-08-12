import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const read = (path) => readFile(resolve(ROOT, path), "utf8");

/**
 * The onboarding matrix is `table-layout: fixed`. Under that rule a column
 * without a stated width absorbs whatever space the stated ones leave, so the
 * speaker column shrank as task templates were added — measured at 60px against
 * a 180px floor on the button inside it, which then printed across the track
 * column beside it. Both halves of that have to stay fixed: the column states a
 * width, and nothing inside a cell sets a floor the cell cannot honour.
 */
test("the speaker column states a width, like every other column in the matrix", async () => {
  const css = await read("src/ui/onboarding/onboarding.css");
  const page = await read("src/ui/onboarding/OnboardingPage.tsx");

  assert.match(css, /\.onboarding-speaker-column \{[^}]*width: \d+px/);
  // Both the header and the row header carry it, or fixed layout has nothing
  // to apply the width to.
  assert.match(page, /<th scope="col" class="onboarding-speaker-column">Speaker<\/th>/);
  assert.match(page, /<th scope="row" class="onboarding-speaker-column">/);
});

test("nothing inside a matrix cell sets a width floor the cell cannot honour", async () => {
  const css = await read("src/ui/onboarding/onboarding.css");
  const rule = /\.onboarding-speaker-link \{([^}]*)\}/.exec(css);
  assert.ok(rule, "the speaker link rule should exist");
  assert.match(rule[1], /min-width: 0/);
  assert.doesNotMatch(rule[1], /min-width: \d*[1-9]\d*px/);
});

test("the matrix scrolls rather than squeezing, and the cell clips either way", async () => {
  const css = await read("src/ui/onboarding/onboarding.css");
  assert.match(css, /\.onboarding-matrix-wrap \{[^}]*overflow-x: auto/);
  assert.match(css, /\.onboarding-matrix tbody th\.onboarding-speaker-column \{[^}]*overflow: hidden/);
});
