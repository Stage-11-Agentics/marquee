/**
 * sbek eval round 11, content-management, major: pressing Save changes on the
 * SESSION CONTENT panel replaced the whole record with "Record unavailable ·
 * The conference server could not be reached. Retrying shortly. Your work is
 * not lost." and Retry re-rendered the record with both edits gone.
 *
 * The reassurance was false at the moment it was shown. Two halves met: `act`
 * gave the page to anything that was not a 4xx refusal, and `reload()` reseeded
 * the content editor from the server — so the recovery action was what
 * overwrote the work.
 *
 * Five review rounds each found the same defect through another door, which is
 * why these assertions are about RULES rather than call sites. The last round
 * found it in four more writes at once; patching four `finally`s would have
 * left the fifth to whoever added it next.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const source = async (path) => readFile(new URL(path, root), "utf8");

/**
 * Exactly one arrow function and nothing after it. An earlier version sliced to
 * the next screen-level marker and swallowed `restoreVersion`, which uses `act`
 * correctly, making these assertions look violated when they were not.
 */
const fn = (page, declaration) => {
  const start = page.indexOf(declaration);
  assert.notStrictEqual(start, -1, `not found: ${declaration}`);
  return page.slice(start, page.indexOf("\n  };", start));
};

test("CONTRACT · one rule owns busy for every write that refreshes the record", async () => {
  const page = await source("src/ui/submissions/SubmissionRecordPage.tsx");

  // The lifecycle lives in one helper: it sets busy, and the load effect clears
  // it when the record lands. Nothing else may hold its own.
  assert.match(page, /const writeThenRefresh = async \(name: string, run: \(\) => Promise<void>, onFailure: \(error: unknown\) => void\): Promise<boolean> =>/);
  assert.doesNotMatch(page, /finally \{ setBusy\(""\); \}/);

  // act, participantWrite, writeOverride, resendDecision, saveContent, sendMessage.
  const routed = page.match(/writeThenRefresh\(/g) ?? [];
  assert.ok(routed.length >= 6, `expected every refreshing write routed, saw ${routed.length}`);

  // A child that writes for itself and asks the record to catch up must arm the
  // parent, or its refresh window is the one place left unguarded.
  assert.match(page, /const refreshRecord = useCallback\(\(\) => \{ setBusy\("refresh"\); reload\(\); \}/);
  assert.match(page, /onReversed=\{refreshRecord\}/);
});

test("CONTRACT · the refresh, not the write, is what releases the controls", async () => {
  const page = await source("src/ui/submissions/SubmissionRecordPage.tsx");
  const helper = fn(page, "const writeThenRefresh = async");

  const [success, failure] = helper.split("catch (error: unknown)");
  // Success reloads and deliberately does not clear busy — the record on screen
  // is still the one from before the write, and must not be actionable.
  assert.match(success, /reload\(\);/);
  assert.doesNotMatch(success, /setBusy\(""\)/);
  // Failure clears it itself, because no refresh is coming, and never reloads —
  // a reload after a failed write is what discarded the operator's text.
  assert.match(failure, /setBusy\(""\)/);
  assert.doesNotMatch(failure, /reload\(\)/);

  // The load effect owns it on BOTH outcomes, or a failed refresh leaves the
  // page disabled with nothing coming to release it.
  const effect = page.slice(page.indexOf("const controller = new AbortController();"), page.indexOf("}, [eventId, submissionId, reloadKey]);"));
  assert.match(effect, /setState\(\{ kind: "ready", record \}\); setBusy\(""\);/);
  assert.match(effect, /notFound: isNotFound\(error\) \}\); setBusy\(""\);/);
});

test("CONTRACT · a failed content save reports beside the control, not over the record", async () => {
  const page = await source("src/ui/submissions/SubmissionRecordPage.tsx");
  const saveContent = fn(page, "const saveContent = async");

  // Its failure is the operator's to answer, so it never raises the page-level
  // error state that `act` reserves for a record that is genuinely gone.
  assert.doesNotMatch(saveContent, /setState\(\{ kind: "error"/);
  assert.match(saveContent, /\(error\) => setContentError\(errorSummary\(error\)\)/);
  // And a fresh attempt does not inherit the last failure.
  assert.match(saveContent, /setContentError\(""\)/);
});

test("CONTRACT · a refresh does not unmount the record it is refreshing", async () => {
  const page = await source("src/ui/submissions/SubmissionRecordPage.tsx");

  // Blanking to "loading" on every reload destroyed child state that no
  // page-level guard can reach — the override form's typed score and comment
  // live in the row component, not on the page.
  assert.match(page, /setState\(\(current\) => \(current\.kind === "ready" \? current : \{ kind: "loading" \}\)\)/);
  assert.doesNotMatch(page, /setState\(\{ kind: "loading" \}\)/);
});

test("CONTRACT · every reload path defers to the operator's unsaved text", async () => {
  const page = await source("src/ui/submissions/SubmissionRecordPage.tsx");

  assert.match(page, /adoptServerValue\(contentEdits\.current !== contentSavedAtEdit\.current, current, record\.title\)/);
  assert.match(page, /adoptServerValue\(contentEdits\.current !== contentSavedAtEdit\.current, current, record\.abstract \?\? ""\)/);

  // Counted where typing happens, or every field reads untouched.
  assert.match(page, /onInput=\{\(event\) => \{ contentEdits\.current \+= 1; setDraftTitle/);
  assert.match(page, /onInput=\{\(event\) => \{ contentEdits\.current \+= 1; setDraftAbstract/);

  // The count is taken BEFORE the request and recorded only on success, so
  // keystrokes landing while it is in flight leave the counts unequal and the
  // field still reads as edited.
  assert.match(page, /const editsAtSend = contentEdits\.current;/);
  assert.match(page, /\.then\(\(\) => \{ contentSavedAtEdit\.current = editsAtSend; \}\)/);

  // No path may seed the fields unconditionally.
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

test("CONTRACT · a decision that did not land leaves its dialog and its words on screen", async () => {
  const page = await source("src/ui/submissions/SubmissionRecordPage.tsx");
  const decide = fn(page, "const decide = async");

  // Closing the dialog before the request meant the feedback survived in state
  // with nothing on screen able to reach it, and the next action cleared it.
  assert.doesNotMatch(decide.slice(0, decide.indexOf("await act")), /setDecisionRequest\(null\)/);
  assert.match(decide, /if \(!decided\) return;/);
  assert.match(decide, /setDecisionRequest\(null\);\s*setFeedbackDraft\(""\);/);
});

test("CONTRACT · act keeps its own policy for writes that carry no typed work", async () => {
  const page = await source("src/ui/submissions/SubmissionRecordPage.tsx");
  const act = fn(page, "const act = async");

  // Unchanged by any of this: a refused write answers beside the control, and a
  // record that really is gone still takes the page.
  assert.match(act, /const failure = submissionWriteFailure\(error, name\);/);
  assert.match(act, /if \(failure\.kind === "refusal"\) setActionError\(failure\.actionError\);/);
  assert.match(act, /else setState\(failure\.state\);/);
});
