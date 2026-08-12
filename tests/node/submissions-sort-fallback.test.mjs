import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { resolve } from "node:path";

import {
  SUBMISSION_SORTS,
  buildSubmissionsQuery,
  normaliseSubmissionSort,
} from "../../src/ui/submissions/list-request.ts";

const ROOT = resolve(import.meta.dirname, "../..");

test("an unknown sort in a pasted URL falls back instead of emptying the table", () => {
  // The reported dead end: /submissions?sort=score_desc — a plausible guess at
  // a real option — returned 400 and rendered the shell with no rows and a
  // blank sort control.
  assert.equal(normaliseSubmissionSort("score_desc"), "newest");
  assert.equal(normaliseSubmissionSort(null), "newest");
  assert.equal(normaliseSubmissionSort(""), "newest");

  const query = buildSubmissionsQuery(new URLSearchParams("sort=score_desc&q=synthetic"));
  assert.equal(query.get("sort"), "newest");
  assert.equal(query.get("q"), "synthetic", "the rest of the query survives untouched");
});

test("every real sort reaches the endpoint unchanged", () => {
  for (const sort of SUBMISSION_SORTS) {
    assert.equal(normaliseSubmissionSort(sort), sort);
    assert.equal(buildSubmissionsQuery(new URLSearchParams(`sort=${sort}`)).get("sort"), sort);
  }
});

test("a request with no sort still sends none", () => {
  // Absent and invalid are different: absent lets the endpoint apply its own
  // default rather than this page asserting one.
  assert.equal(buildSubmissionsQuery(new URLSearchParams("q=x")).has("sort"), false);
});

test("the sort control offers exactly the ids the request can send", async () => {
  const page = await readFile(resolve(ROOT, "src/ui/submissions/SubmissionsPage.tsx"), "utf8");
  const block = page.slice(page.indexOf("const SORT_OPTIONS"), page.indexOf("const COLD_SKELETON_ROWS"));
  const offered = [...block.matchAll(/\["([a-z_]+)", "/g)].map((match) => match[1]);
  assert.deepEqual([...offered].sort(), [...SUBMISSION_SORTS].sort());
});
