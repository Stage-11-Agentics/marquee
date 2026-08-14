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

test("CONTRACT · every reload path defers to the operator's unsaved text", async () => {
  const page = await source("src/ui/submissions/SubmissionRecordPage.tsx");

  // The load handler is the single place both fields are reseeded, and it must
  // go through the rule rather than assigning the server value outright — every
  // reload() call site on this page funnels through here.
  assert.match(page, /setDraftTitle\(\(current\) => adoptServerValue\(current, serverContent\.current\.title, record\.title\)\)/);
  assert.match(page, /setDraftAbstract\(\(current\) => adoptServerValue\(current, serverContent\.current\.abstract, record\.abstract \?\? ""\)\)/);
  // And the baseline must advance, or the second reload would compare against
  // a stale value and start overwriting again.
  assert.match(page, /serverContent\.current = \{ title: record\.title, abstract: record\.abstract \?\? "" \}/);

  // No path may still seed the fields unconditionally.
  assert.doesNotMatch(page, /setDraftTitle\(record\.title\)/);
  assert.doesNotMatch(page, /setDraftAbstract\(record\.abstract \?\? ""\)/);
});

test("CONTRACT · one record's unsaved text cannot follow you to another record", async () => {
  const shell = await source("src/ui/shell/AppShell.tsx");

  // Keeping a draft across a reload is only safe while the component instance
  // belongs to one submission. AppShell keys the boundary by event, so without
  // a key here the same instance is reused for the next record and the retained
  // draft would arrive on top of it — a leak this fix would otherwise have
  // introduced, since the unconditional reseed used to mask it.
  assert.match(shell, /<SubmissionRecordPage key=\{decodeURIComponent\(location\.pathname\.slice\("\/submissions\/"\.length\)\)\}/);
});

test("CONTRACT · decision feedback survives a decision that did not land", async () => {
  const page = await source("src/ui/submissions/SubmissionRecordPage.tsx");

  const decide = page.slice(page.indexOf("const decide = async"), page.indexOf("\n  };", page.indexOf("const decide = async")));
  // Cleared only on success — this text is what the speaker reads in the mail.
  // The guard reads `if (!decided) return;` since the dialog must survive too;
  // what matters is that neither clear can be reached on the failure path.
  assert.match(decide, /const decided = await act\(/);
  const afterGuard = decide.slice(decide.indexOf("if (!decided) return;"));
  assert.match(afterGuard, /setFeedbackDraft\(""\)/);
  assert.doesNotMatch(decide.slice(0, decide.indexOf("if (!decided) return;")), /setFeedbackDraft\(""\)/);

  // act has to report the outcome for that to be possible.
  const act = page.slice(page.indexOf("const act = async"), page.indexOf("const changePublication"));
  assert.match(act, /Promise<boolean>/);
  assert.match(act, /reload\(\);\s*return true;/);
  assert.match(act, /return false;/);
});

test("CONTRACT · a decision that did not land leaves its dialog and its words on screen", async () => {
  const page = await source("src/ui/submissions/SubmissionRecordPage.tsx");
  const decide = page.slice(page.indexOf("const decide = async"), page.indexOf("\n  };", page.indexOf("const decide = async")));

  // Closing the dialog before the request meant the feedback survived in state
  // with nothing on screen able to reach it, and the next action cleared it.
  // Both the text and the surface that shows it now wait for success.
  assert.doesNotMatch(decide.slice(0, decide.indexOf("await act")), /setDecisionRequest\(null\)/);
  assert.match(decide, /if \(!decided\) return;/);
  assert.match(decide, /setDecisionRequest\(null\);\s*setFeedbackDraft\(""\);/);
});

test("CONTRACT · a refresh does not unmount the record it is refreshing", async () => {
  const page = await source("src/ui/submissions/SubmissionRecordPage.tsx");

  // Blanking to "loading" on every reload destroyed child state that no
  // page-level guard can reach — the override form's typed score and comment
  // live in the row component, not on the page.
  assert.match(page, /setState\(\(current\) => \(current\.kind === "ready" \? current : \{ kind: "loading" \}\)\)/);
  assert.doesNotMatch(page, /setState\(\{ kind: "loading" \}\)/);
});
