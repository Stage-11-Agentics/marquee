/**
 * check:clocks — the CLI over `clock-policy.mjs`, which owns the rules and the
 * reasons they exist. This file walks `tests/` and reports.
 */
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { clockFindings } from "./clock-policy.mjs";
import { REPOSITORY_ROOT, emit } from "./lib/command.mjs";

const TEST_ROOT = resolve(REPOSITORY_ROOT, "tests");

/**
 * The rules' own suite is the one file whose armed fixtures are the point. It
 * quotes the 2026-08-13 session verbatim so the guard can be shown catching it;
 * that source is a string the rules read, never a statement anything runs. No
 * marker can express this from inside — a `clock-check: allow` written into
 * those quoted fixtures would exempt them from the assertions too, which is the
 * one thing the suite must not do. So it is named here, exactly, and nowhere
 * else gets the privilege.
 */
const RULES_OWN_SUITE = "node/check-clocks.test.mjs";

async function testFiles() {
  const entries = await readdir(TEST_ROOT, { recursive: true });
  return entries
    .filter((path) => /\.(test|spec)\.(ts|mjs|js)$/.test(path))
    .filter((path) => path !== RULES_OWN_SUITE)
    .map((path) => resolve(TEST_ROOT, path));
}

const findings = [];
for (const file of await testFiles()) {
  const source = await readFile(file, "utf8");
  findings.push(...clockFindings(file.slice(REPOSITORY_ROOT.length + 1), source));
}

for (const finding of findings) {
  process.stdout.write(`\n[check:clocks] ${finding.file}:${finding.line}  ${finding.rule}\n`);
  process.stdout.write(`  ${finding.detail}\n`);
  process.stdout.write(`  fix: ${finding.fix}\n`);
}
if (findings.length === 0) process.stdout.write("[check:clocks] no calendar-pinned deadlines, no burst-spent limits\n");

emit({
  command: "check:clocks",
  status: findings.length ? "fail" : "pass",
  findings,
});
process.exitCode = findings.length ? 1 : 0;

