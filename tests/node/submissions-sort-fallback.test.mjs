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

test("CONTRACT · an unknown sort in a pasted URL falls back instead of emptying the table", () => {
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

test("CONTRACT · every real sort reaches the endpoint unchanged", () => {
  for (const sort of SUBMISSION_SORTS) {
    assert.equal(normaliseSubmissionSort(sort), sort);
    assert.equal(buildSubmissionsQuery(new URLSearchParams(`sort=${sort}`)).get("sort"), sort);
  }
});

test("CONTRACT · a request with no sort still sends none", () => {
  // Absent and invalid are different: absent lets the endpoint apply its own
  // default rather than this page asserting one.
  assert.equal(buildSubmissionsQuery(new URLSearchParams("q=x")).has("sort"), false);
});

test("CONTRACT · the sort control offers exactly the ids the request can send", async () => {
  const page = await readFile(resolve(ROOT, "src/ui/submissions/SubmissionsPage.tsx"), "utf8");
  const block = page.slice(page.indexOf("const SORT_OPTIONS"), page.indexOf("const COLD_SKELETON_ROWS"));
  const offered = [...block.matchAll(/\["([a-z_]+)", "/g)].map((match) => match[1]);
  assert.deepEqual([...offered].sort(), [...SUBMISSION_SORTS].sort());
});

test("CONTRACT · the client's sort list is the endpoint's own registry, not a copy that can drift", async () => {
  // Normalising client-side means this list decides what the API is ever asked
  // for. If the endpoint grew a sort and this list did not, the normaliser would
  // quietly rewrite that sort to `newest` — a link that silently shows the wrong
  // order, which is the same class of soft failure this file exists to close.
  const queries = await readFile(resolve(ROOT, "src/routes/submissions.queries.ts"), "utf8");
  const registry = queries.slice(queries.indexOf("export const SUBMISSION_SORTS = {"), queries.indexOf("} as const satisfies SortRegistry"));
  const served = [...registry.matchAll(/^\s{2}([a-z_]+):\s*\{/gm)].map((match) => match[1]);
  assert.deepEqual([...served].sort(), [...SUBMISSION_SORTS].sort());
});
