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
test("CONTRACT · the speaker column states a width, like every other column in the matrix", async () => {
  const css = await read("src/ui/onboarding/onboarding.css");
  const page = await read("src/ui/onboarding/OnboardingPage.tsx");

  assert.match(css, /\.onboarding-speaker-column \{[^}]*width: \d+px/);
  // Both the header and the row header carry it, or fixed layout has nothing
  // to apply the width to.
  assert.match(page, /<th scope="col" class="onboarding-speaker-column">Speaker<\/th>/);
  assert.match(page, /<th scope="row" class="onboarding-speaker-column">/);
});

test("CONTRACT · nothing inside a matrix cell sets a width floor the cell cannot honour", async () => {
  const css = await read("src/ui/onboarding/onboarding.css");
  const rule = /\.onboarding-speaker-link \{([^}]*)\}/.exec(css);
  assert.ok(rule, "the speaker link rule should exist");
  assert.match(rule[1], /min-width: 0/);
  assert.doesNotMatch(rule[1], /min-width: \d*[1-9]\d*px/);
});

test("CONTRACT · the matrix scrolls rather than squeezing, and the cell clips either way", async () => {
  const css = await read("src/ui/onboarding/onboarding.css");
  assert.match(css, /\.onboarding-matrix-wrap \{[^}]*overflow-x: auto/);
  assert.match(css, /\.onboarding-matrix tbody th\.onboarding-speaker-column \{[^}]*overflow: hidden/);
});

/**
 * Stating a width on one column only moves the problem: whatever is left is
 * still shared between the columns that state none, and the task columns are
 * the ones that grow in number. Measured at six templates in a 1024px viewport,
 * a stated speaker column pushed the task cells to 64px and the due dates ran
 * into each other with no gap. Every column in the header row states a width,
 * and the table is at least as wide as their sum, so the wrap scrolls instead.
 */
test("CONTRACT · every column in the header row states a width, whatever the template count", async () => {
  const css = await read("src/ui/onboarding/onboarding.css");
  const page = await read("src/ui/onboarding/OnboardingPage.tsx");

  // Fixed layout reads the first row, so a width on the body `<td>` alone does
  // not count — the header cell has to carry the class.
  assert.match(page, /<th scope="col" class="onboarding-task-column" key=\{task\.id\}>/);
  assert.match(page, /<th scope="col" class="onboarding-last-contact-column">Last contact<\/th>/);
  // Stated separately: the task columns are narrower than the last-contact
  // column so more of them fit before the wrap has to scroll.
  assert.match(css, /\.onboarding-task-column \{[^}]*width: \d+px/);
  assert.match(css, /\.onboarding-last-contact-column \{[^}]*width: \d+px/);

  // A flat pixel min-width does not grow with the column count, which is the
  // whole reason the columns were squeezed in the first place.
  assert.match(css, /\.onboarding-matrix \{[^}]*min-width: max-content/);
});

/**
 * MRQ-164 · scrolling is how the matrix fits many templates, and silence about
 * it is how a tracked task read as an untracked one: the newest column lands
 * furthest right, so a speaker whose only work is new showed a row of em dashes
 * with their real state off-screen. The grid has to say it has more, and the
 * row's identity has to survive the scroll that reaches it.
 */
test("CONTRACT · the matrix declares its hidden columns and keeps the speaker pinned", async () => {
  const css = await read("src/ui/onboarding/onboarding.css");
  const page = await read("src/ui/onboarding/OnboardingPage.tsx");

  // The strip states the count always and names the furthest column only when
  // the grid actually overflows, measured rather than guessed.
  assert.match(page, /onboarding-matrix-scroll-note/);
  assert.match(page, /matrixOverflows/);
  assert.match(page, /scrollWidth > element\.clientWidth/);
  // Reserved height, so the grid does not jump as filters change what fits.
  assert.match(css, /\.onboarding-matrix-scroll-note \{[^}]*min-height: \d+px/);

  assert.match(css, /\.onboarding-matrix th\.onboarding-speaker-column \{[^}]*position: sticky/);
  assert.match(css, /\.onboarding-matrix th\.onboarding-select-column[^{]*\{[^}]*position: sticky/);
  // A pinned cell the rows travel under needs an opaque background.
  assert.match(css, /\.onboarding-matrix tbody[^{]*onboarding-speaker-column \{[^}]*background: var\(--panel\)/);

  // A row with no applicable task must not read like one whose tasks are merely
  // unstarted — both are em dashes in the grid, so the row says which it is.
  assert.match(page, /No tasks assigned/);
});
