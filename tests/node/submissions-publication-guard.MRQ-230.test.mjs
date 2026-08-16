import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const page = readFileSync(new URL("../../src/ui/submissions/SubmissionsPage.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../../src/ui/submissions/submissions.css", import.meta.url), "utf8");

test("AC-315 · the current bulk dialog reserves the honest published-count line", () => {
  assert.match(page, /Published records selected:/);
  assert.match(page, /publishedMatchingCount/);
  assert.match(styles, /\.bulk-published-count\s*\{[^}]*min-height/);
  assert.match(page, /include_published_count/);
});
