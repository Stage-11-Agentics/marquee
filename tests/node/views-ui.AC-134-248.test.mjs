import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const formsPage = readFileSync(new URL("../../src/ui/forms/FormsPage.tsx", import.meta.url), "utf8");
const submissionsPage = readFileSync(new URL("../../src/ui/submissions/SubmissionsPage.tsx", import.meta.url), "utf8");
/**
 * The status labeller moved here so the chip on the row and the cell in the
 * CSV export are one function. The MRQ-97 contract below follows it: what it
 * pins is that `accepted` stays a stored decision fact, and that is true of
 * wherever the labeller lives.
 */
const submissionColumns = readFileSync(new URL("../../src/lib/submission-columns.ts", import.meta.url), "utf8");

test("AC-134 · the builder field list renders a condition summary without opening the field", () => {
  assert.match(formsPage, /data-condition-summary=\{summary\}/);
  assert.match(formsPage, /fieldTypeLabel\(field\.type\).*summary \? ` · When \$\{summary\}`/);
  assert.match(formsPage, /export function conditionSummary/);
});

test("AC-248 · the column chooser renders the fixed registry and disables Title removal", () => {
  assert.match(submissionsPage, /SUBMISSION_COLUMN_REGISTRY/);
  assert.match(submissionsPage, /disabled=\{column === "title"\}/);
  assert.match(submissionsPage, /persistColumns\(view\.config\.columns\)/);
  assert.match(submissionsPage, /localStorage\.setItem\(`marquee\.columns\.\$\{eventId\}`/);
});

test("CONTRACT · MRQ-97 keeps accepted as a stored fact and groups the stage filter", () => {
  assert.match(submissionsPage, /\["accepted_any", "Accepted \(any stage\)"\]/);
  assert.match(submissionsPage, /<optgroup label=\{group\.label\}>/);
  assert.match(submissionsPage, /status-filter \$\{status \? "has-selection" : "is-default"\}/);
  assert.match(submissionColumns, /return status\[0\]!\.toUpperCase\(\) \+ status\.slice\(1\);/);
  // Neither the labeller's home nor the page it feeds may special-case it.
  assert.doesNotMatch(submissionColumns, /status === "accepted"\) return "Ready to place"/);
  assert.doesNotMatch(submissionsPage, /status === "accepted"\) return "Ready to place"/);
});
