/**
 * sbek eval round 11, content-management, major: pressing Save changes on the
 * SESSION CONTENT panel replaced the whole record with "Record unavailable ·
 * The conference server could not be reached. Retrying shortly. Your work is
 * not lost." and Retry re-rendered the record with both edits gone.
 *
 * The reassurance was false at the moment it was shown. The mechanism is the
 * two halves meeting: `act` gives the page to anything that is not a 4xx
 * refusal, and `reload()` reseeds `draftTitle` / `draftAbstract` from the
 * server — so the recovery action is what overwrites the work.
 *
 * `act` is deliberately NOT changed. A record that really is gone should still
 * take the page; that contract is asserted by record-refusal-inline.MRQ-162 and
 * must stay green. What changes is that the one control holding typed prose
 * stops routing through it — the same move already made for the score override.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const source = async (path) => readFile(new URL(path, root), "utf8");

/**
 * Exactly the saveContent arrow function and nothing after it — a slice that
 * ran to the next screen-level marker swallowed `restoreVersion`, which uses
 * `act` correctly, and made the assertions below look violated when they were
 * not.
 */
const saveContentOf = (page) => {
  const start = page.indexOf("const saveContent = async");
  const end = page.indexOf("\n  };", start);
  return page.slice(start, end);
};

test("CONTRACT · a failed content save keeps the record on screen", async () => {
  const page = await source("src/ui/submissions/SubmissionRecordPage.tsx");
  const saveContent = saveContentOf(page);

  // It must not hand its failure to act(), which would take the page.
  assert.doesNotMatch(saveContent, /await act\(/);
  // Nor may it raise the page-level error state itself.
  assert.doesNotMatch(saveContent, /setState\(\{ kind: "error"/);
  // It reports beside the control instead.
  assert.match(saveContent, /catch \(error: unknown\) \{\s*setContentError\(errorSummary\(error\)\);/);
});

test("CONTRACT · a failed content save leaves the typed title and abstract in the fields", async () => {
  const page = await source("src/ui/submissions/SubmissionRecordPage.tsx");
  const saveContent = saveContentOf(page);

  // reload() reseeds both drafts from the server, so it may only run on the
  // success path — after a failure it is exactly what would discard the work.
  const [beforeCatch, afterCatch] = saveContent.split("catch (error: unknown)");
  assert.match(beforeCatch, /reload\(\);/);
  assert.doesNotMatch(afterCatch, /reload\(\)/);

  // And nothing in the failure path may reseed the fields directly either.
  assert.doesNotMatch(afterCatch, /setDraftTitle|setDraftAbstract/);
});

test("CONTRACT · a fresh save attempt does not inherit the last failure", async () => {
  const page = await source("src/ui/submissions/SubmissionRecordPage.tsx");
  const saveContent = saveContentOf(page);

  const openingLines = saveContent.slice(0, saveContent.indexOf("try {"));
  assert.match(openingLines, /setContentError\(""\)/);
});

test("CONTRACT · the failure is rendered beside the Save control in reserved space", async () => {
  const page = await source("src/ui/submissions/SubmissionRecordPage.tsx");
  const css = await source("src/ui/submissions/record.css");

  const form = page.slice(page.indexOf('class="record-draft-form"'), page.indexOf('record.actions.can_decide'));
  assert.match(form, /record-inline-message \$\{contentError \? "error" : ""\}/);
  assert.match(form, /role=\{contentError \? "alert" : undefined\}/);

  // Reserved height: the message appearing must not move the button under a
  // cursor already travelling towards it.
  assert.match(css, /\.record-inline-message \{[^}]*min-height/);
});

test("CONTRACT · act() keeps its own policy for writes that carry no typed work", async () => {
  const page = await source("src/ui/submissions/SubmissionRecordPage.tsx");
  const act = page.slice(page.indexOf("const act = async"), page.indexOf("const changePublication"));

  // Unchanged by this fix, and asserted here so a later edit to saveContent
  // cannot quietly generalise into act and swallow a genuinely dead record.
  assert.match(act, /if \(isRefusal\(error\)\) setActionError/);
  assert.match(act, /else setState\(\{ kind: "error"/);
});
