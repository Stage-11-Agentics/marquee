/**
 * check:no-op-tests — report structural source-text assertions in tests.
 *
 * Existing findings are a printed backlog and do not red main. A finding in a
 * new test file is a real gate failure, so the backlog cannot silently grow.
 */
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { REPOSITORY_ROOT, emit } from "./lib/command.mjs";
import {
  gateStatus,
  sourceTextFindings,
} from "./no-op-test-policy.mjs";

const TEST_ROOT = resolve(REPOSITORY_ROOT, "tests");
// The policy suite quotes the exact source-read pattern it must catch. Its
// fixtures are evidence for the rule, not production test debt.
const RULES_OWN_SUITE = "node/check-no-op-tests.test.mjs";

async function testFiles(directory = TEST_ROOT, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolute = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await testFiles(absolute, relative));
    else if (/\.(?:test|spec)\.(?:mjs|js|ts|tsx)$/.test(relative) && relative !== RULES_OWN_SUITE) files.push(absolute);
  }
  return files;
}

const findings = [];
for (const file of await testFiles()) {
  const source = await readFile(file, "utf8");
  findings.push(...sourceTextFindings(file.slice(REPOSITORY_ROOT.length + 1), source));
}

const { classified, files, knownFiles, newFiles, staleAllowlist, status } = gateStatus(findings);

for (const file of files) {
  const fileFindings = classified.filter((finding) => finding.file === file);
  const finding = fileFindings[0];
  const fileStatus = finding.known ? "existing" : "new";
  process.stdout.write(`\n[check:no-op-tests] ${fileStatus} ${finding.file}:${finding.line}\n`);
  process.stdout.write(`  ${finding.detail}\n`);
  process.stdout.write(`  ${finding.expression}\n`);
  process.stdout.write(`  fix: ${finding.fix}\n`);
  if (fileFindings.length > 1) {
    process.stdout.write(`  additional structural assertions in file: ${fileFindings.length - 1}\n`);
  }
}

process.stdout.write(
  `\n[check:no-op-tests] ${knownFiles.length} remaining known offender file${knownFiles.length === 1 ? "" : "s"}; `
  + `${newFiles.length} new offender file${newFiles.length === 1 ? "" : "s"}\n`,
);
if (staleAllowlist.length > 0) {
  process.stdout.write(`[check:no-op-tests] stale backlog entries: ${staleAllowlist.join(", ")}\n`);
}

emit({
  command: "check:no-op-tests",
  status,
  findings: classified,
  remainingOffenderFiles: knownFiles.length,
  newOffenderFiles: newFiles,
  staleAllowlist,
});
process.exitCode = status === "fail" ? 1 : 0;
