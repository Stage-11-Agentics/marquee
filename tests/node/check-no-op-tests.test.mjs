import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyFindings,
  gateStatus,
  isStructuralMatcher,
  sourceTextFindings,
  uniqueOffenderFiles,
} from "../../scripts/checks/no-op-test-policy.mjs";

test("CONTRACT · the allowlist panel class assertion is a source-text behavior no-op", () => {
  const source = `
import { readFileSync } from "node:fs";
const component = readFileSync(new URL("../../src/ui/comms/DemoMailAllowlist.tsx", import.meta.url), "utf8");
test("panel", () => {
  assert.match(component, /class=["']allowlist-listing["']/);
});
`;
  const findings = sourceTextFindings("tests/node/new-panel.test.mjs", source);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].rule, "source-text-behavior-assertion");
});

test("CONTRACT · the real demo-mail allowlist source-text case is visible to the guard", async () => {
  const { readFile } = await import("node:fs/promises");
  const { resolve } = await import("node:path");
  const root = resolve(import.meta.dirname, "../..");
  const relative = "tests/node/demo-mail-allowlist-ui.test.mjs";
  const source = await readFile(resolve(root, relative), "utf8");
  assert.ok(sourceTextFindings(relative, source).length > 0);
});

test("CONTRACT · a user-facing copy assertion is not a source-text no-op finding", () => {
  const source = `
import { readFile } from "node:fs/promises";
const component = await readFile(resolve(root, "src/ui/public/form/PublicForm.tsx"), "utf8");
test("copy", () => {
  assert.match(component, /This link is your sign-in/);
  assert.match(component, /Track your submission/);
});
`;
  assert.deepEqual(sourceTextFindings("tests/node/copy.test.mjs", source), []);
});

test("CONTRACT · the real copy-only submitter test stays outside the offender population", async () => {
  const { readFile } = await import("node:fs/promises");
  const { resolve } = await import("node:path");
  const root = resolve(import.meta.dirname, "../..");
  const source = await readFile(resolve(root, "tests/node/submitter-seat.MRQ-154.test.mjs"), "utf8");
  assert.deepEqual(sourceTextFindings("tests/node/submitter-seat.MRQ-154.test.mjs", source), []);
});

test("CONTRACT · an unknown offender is new while an allowlisted file is existing", () => {
  const findings = [
    { file: "tests/node/existing.test.mjs", line: 4 },
    { file: "tests/node/new.test.mjs", line: 4 },
  ];
  const classified = classifyFindings(findings, {
    "tests/node/existing.test.mjs": { ticket: "MRQ-192", reason: "runtime seam pending" },
  });
  assert.equal(classified.find((finding) => finding.file.endsWith("existing.test.mjs")).known, true);
  assert.equal(classified.find((finding) => finding.file.endsWith("new.test.mjs")).known, false);
  assert.deepEqual(uniqueOffenderFiles(classified.filter((finding) => !finding.known)), ["tests/node/new.test.mjs"]);
  const baseline = {
    "tests/node/existing.test.mjs": { ticket: "MRQ-192", reason: "runtime seam pending" },
  };
  assert.equal(gateStatus([findings[0]], baseline).status, "pass");
  assert.equal(gateStatus(findings, baseline).status, "fail");
});

test("CONTRACT · structural forms are obvious while copy punctuation stays readable", () => {
  assert.equal(isStructuralMatcher('assert.match(page, /class="panel"/)'), true);
  assert.equal(isStructuralMatcher("assert.match(page, /requestJson\\(/)"), true);
  assert.equal(isStructuralMatcher("assert.match(page, /Live outbox/)"), false);
  assert.equal(isStructuralMatcher("assert.match(page, /<strong>Requested deliverables<\\/strong>/)"), false);
  assert.equal(isStructuralMatcher("assert.match(page, /Logistics &amp; notes/)"), false);
  assert.equal(isStructuralMatcher("assert.match(page, /This link is your sign-in/)"), false);
});
