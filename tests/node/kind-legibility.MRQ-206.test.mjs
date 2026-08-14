import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const submissionsPage = readFileSync(resolve(ROOT, "src/ui/submissions/SubmissionsPage.tsx"), "utf8");
const submissionsCss = readFileSync(resolve(ROOT, "src/ui/submissions/submissions.css"), "utf8");
const boardPage = readFileSync(resolve(ROOT, "src/ui/board/ProgramBoardPage.tsx"), "utf8");
const boardCss = readFileSync(resolve(ROOT, "src/ui/board/board.css"), "utf8");

test("CONTRACT · MRQ-206 · the kind segment round-trips the existing URL and saved-view filter", () => {
  const segmentPosition = submissionsPage.indexOf('id="kind-segment"');
  const searchPosition = submissionsPage.indexOf('class="search-field"');

  assert.ok(segmentPosition >= 0 && segmentPosition < searchPosition, "the kind segment must lead the submissions toolbar");
  assert.match(submissionsPage, /\["", "All"\]/);
  assert.match(submissionsPage, /\["abstract", "Abstracts"\]/);
  assert.match(submissionsPage, /\["session", "Sessions"\]/);
  assert.match(submissionsPage, /aria-pressed=\{kind === value\}/);
  assert.match(submissionsPage, /updateQuery\(\{ kind: value, page: 1 \}\)/);
  assert.match(submissionsPage, /for \(const key of \["kind", "status", "track"/);
  assert.match(submissionsPage, /for \(const \[key, value\] of Object\.entries\(view\.config\.filters\)/);
  assert.match(submissionsCss, /#kind-segment button \{[^}]*width: 82px;/);
  assert.doesNotMatch(submissionsPage, /<label><span class="sr-only">Type<\/span><select/);
});

test("CONTRACT · MRQ-206 · the Sessions board note has both filter arms", () => {
  assert.match(boardPage, /filters\.kind === "session" && <div class="board-kind-note" role="note">/);
  assert.match(boardPage, /Sessions are guaranteed — they skip evaluation and enter at Ready to place\. The earlier columns are empty by design\./);
  assert.equal((boardPage.match(/class="board-kind-note"/g) ?? []).length, 1, "the note has one conditional render site");
  assert.match(boardCss, /\.board-kind-note \{[^}]*color: var\(--muted\);[^}]*font: 400 11px\/1\.4 var\(--mono\);/);
});
