#!/usr/bin/env node

import { spawn } from "node:child_process";
import { resolve } from "node:path";

import { REPOSITORY_ROOT, emit } from "./lib/command.mjs";

// The mirror gate is deliberately hermetic. The acceptance suite injects the
// recorded FakeAirtableTransport, so a missing operator-owned Airtable base can
// never turn a local or PR check into a false green (or a network-dependent
// red). The deployed-base round trip remains a separate operator precondition
// in EVALUATION.md gate 9.
const vitest = resolve(REPOSITORY_ROOT, "node_modules/.bin/vitest");
const testFiles = [
  "tests/integration/mirror-outbound.MRQ-217.test.ts",
  "tests/integration/mirror-connect-inbound.MRQ-223.test.ts",
  "tests/integration/mirror-schema.MRQ-248.test.ts",
];

const exitCode = await new Promise((resolveExit, reject) => {
  const child = spawn(vitest, ["run", ...testFiles, "--reporter=dot"], {
    cwd: REPOSITORY_ROOT,
    env: process.env,
    stdio: "inherit",
  });
  child.once("error", reject);
  child.once("exit", (code) => resolveExit(code ?? 1));
});

if (exitCode !== 0) {
  emit({
    command: "check:mirror",
    status: "fail",
    provider: "FakeAirtableTransport",
    tests: testFiles,
  });
  process.exitCode = exitCode;
} else {
  emit({
    command: "check:mirror",
    status: "pass",
    provider: "FakeAirtableTransport",
    evidence: [
      "recorded outbound batch calls and shared rate budget",
      "signed inbound allowlist, cursor, and echo suppression",
      "keepalive webhook expiry refresh and row-count reconciliation",
    ],
    tests: testFiles,
  });
}
