/**
 * check:clocks — the CLI over `clock-policy.mjs`, which owns the rules and the
 * reasons they exist. This file walks `tests/` and reports.
 */
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { clockFindings } from "./clock-policy.mjs";
import { REPOSITORY_ROOT, emit } from "./lib/command.mjs";

const TEST_ROOT = resolve(REPOSITORY_ROOT, "tests");

async function testFiles() {
  const entries = await readdir(TEST_ROOT, { recursive: true });
  return entries
    .filter((path) => /\.(test|spec)\.(ts|mjs|js)$/.test(path))
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

