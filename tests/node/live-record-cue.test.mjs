/**
 * A published Session says so before you click Save, not after.
 *
 * The editor takes two deliberate clicks to save a live record, and that guard
 * is deliberate — it is the one class of record where a careless edit changes
 * what the public already sees. What was missing was the warning's timing: the
 * idle cue read the same generic sentence a non-published record shows, so the
 * first click looked exactly like a silent write failure (enabled button,
 * accepted click, no toast, unchanged record) and a reader who reloaded lost
 * their typing with no explanation. A careful reviewer hit precisely that and
 * escalated it as a data-loss bug.
 *
 * This guards the timing, not the guard. If the live cue ever moves back behind
 * the first click, the ambiguity comes back with it.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "../..");

test("CONTRACT · a live Session announces its confirmation step in the idle cue, before the first click", async () => {
  const source = await readFile(resolve(root, "src/ui/submissions/SubmissionRecordPage.tsx"), "utf8");
  const cue = source.slice(source.indexOf("record-content-cue"), source.indexOf("record-content-cue") + 700);

  assert.match(
    cue,
    /isLivePublicly \? "This Session is live on the public agenda; saving will ask you to confirm\."/,
    "the idle cue on a live record must announce the confirmation before the first click",
  );

  // Order matters: the confirming copy still wins once the first click lands,
  // and a draft keeps its own sentence. A live record is never a draft, but the
  // branch order is what makes that true rather than incidental.
  const confirming = cue.indexOf("This replaces what attendees see");
  const draft = cue.indexOf("No submit action is available");
  const idleLive = cue.indexOf("This Session is live on the public agenda");
  assert.ok(confirming !== -1 && draft !== -1 && idleLive !== -1, "all three cue branches must exist");
  assert.ok(confirming < idleLive, "the confirming cue must take precedence over the idle live cue");
  assert.ok(draft < idleLive, "a draft keeps its own cue rather than the live one");

  // The generic sentence stays for records that are not live — the change is a
  // new branch, not a replacement of the default.
  assert.match(cue, /"Saved changes are recorded in the history below\."/, "non-live records keep the generic cue");

  // Space is reserved so neither cue moves the row beneath it.
  const css = await readFile(resolve(root, "src/ui/submissions/record.css"), "utf8");
  assert.match(css, /\.record-content-cue \{[^}]*min-height: 30px/, "the cue must reserve its height across all four states");
});
