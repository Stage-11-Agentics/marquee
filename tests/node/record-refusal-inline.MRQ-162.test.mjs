/**
 * Assigning an out-of-scope reviewer is refused by the server, correctly, with
 * a sentence an organizer can act on. The record page sent that refusal down
 * the same path as a failed load and replaced the whole record with
 * "Record unavailable" — so a guardrail doing its job read as the record being
 * gone, and the organizer lost the page they were working on.
 *
 * A refused write and an unreachable record are different events. Only the
 * second one is the page's problem.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const source = async (path) => readFile(new URL(path, root), "utf8");

test("CONTRACT · a refused write is told apart from an unreachable record", async () => {
  const page = await source("src/ui/submissions/SubmissionRecordPage.tsx");

  assert.match(page, /function isRefusal/);
  // 4xx only: a 5xx or a dropped connection (status 0) is not something the
  // operator can answer, and still takes the page.
  assert.match(page, /error\.status >= 400 && error\.status < 500/);
  // The record really being gone, and the seat being gone, stay page-level.
  assert.match(page, /error\.status !== 404 && error\.status !== 401/);
});

test("CONTRACT · act() keeps the record on screen when a write is refused", async () => {
  const page = await source("src/ui/submissions/SubmissionRecordPage.tsx");

  const act = page.slice(page.indexOf("const act = async"), page.indexOf("const changePublication"));
  assert.match(act, /if \(isRefusal\(error\)\) setActionError\(\{ action: name, message: errorSummary\(error\) \}\)/);
  assert.match(act, /else setState\(\{ kind: "error"/);
  // A fresh attempt must not inherit the last refusal.
  assert.match(act, /setActionError\(null\)/);
});

test("CONTRACT · the refusal is rendered where the operator can see it", async () => {
  const page = await source("src/ui/submissions/SubmissionRecordPage.tsx");
  const css = await source("src/ui/submissions/record.css");

  // Beside the Assign control for assignment refusals...
  assert.match(page, /actionError\.action === `assign-\$\{round\.id\}`/);
  // ...and in a record-level banner for every other declined action, so no
  // refusal can now be swallowed silently.
  assert.match(page, /!actionError\.action\.startsWith\("assign-"\) && !actionError\.action\.startsWith\("remove-"\)/);
  assert.match(page, /class="record-refusal" role="alert"/);
  assert.match(css, /\.record-refusal \{/);
});
