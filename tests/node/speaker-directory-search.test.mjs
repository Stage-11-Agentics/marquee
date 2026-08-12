import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");

/**
 * The speaker directory ships no script, so the only thing that ever ran its
 * search was the browser's implicit submission on Enter. A visitor typed a
 * surname, watched thirty-eight cards not move, and concluded the box was
 * decorative — reasonably, because the agenda's search on the same site does
 * narrow as you type. The filtering behind it always worked; the form had no
 * control to run it.
 */
test("CONTRACT · the speaker directory's search form can be submitted without guessing Enter", async () => {
  const page = await readFile(resolve(ROOT, "src/ui/public/agenda/PublicAgendaPage.tsx"), "utf8");
  // `.public-speaker-grid` is also a CSS selector near the top of the file, so
  // the closing bound has to be found after the form, not from the start.
  const start = page.indexOf('class="public-filters public-directory-filters"');
  assert.notEqual(start, -1, "the directory filter form should exist");
  const form = page.slice(start, page.indexOf("public-speaker-grid", start));

  assert.match(form, /<button class="public-button primary" type="submit">Search<\/button>/);
  // The search field is the thing being submitted, so it has to stay in the form.
  assert.match(form, /class="public-search" name="q"/);
  // A filtered directory needs a way back to the whole list; the page has no
  // script to clear it with.
  assert.match(form, /data\.filters\.q \? <a class="public-button" href=\{`\/speakers\?event=/);
});

test("CONTRACT · the directory filter row makes room for its control", async () => {
  const page = await readFile(resolve(ROOT, "src/ui/public/agenda/PublicAgendaPage.tsx"), "utf8");
  // The base rule is a single full-width column; the button needs its own.
  assert.match(page, /\.public-directory-filters \{ grid-template-columns: minmax\(0, 1fr\) auto; \}/);
  assert.match(page, /\.public-directory-actions \{ display: flex; gap: 8px; \}/);
  // The narrow breakpoints deliberately collapse back to one column.
  assert.match(page, /@media[^{]*\{[\s\S]*?\.public-directory-filters \{ grid-template-columns: minmax\(0, 1fr\); \}/);
});
