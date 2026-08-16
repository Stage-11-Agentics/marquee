import { spawn } from "node:child_process";

import { REPOSITORY_ROOT } from "./checks/lib/command.mjs";

const checks = [
  ["tsc root", "npx", ["tsc", "-p", "tsconfig.json", "--noEmit"]],
  ["tsc client", "npx", ["tsc", "-p", "tsconfig.client.json", "--noEmit"]],
  ["tsc tests", "npx", ["tsc", "-p", "tsconfig.test.json", "--noEmit"]],
  ["check:docs", "npm", ["run", "check:docs", "--", "--write"]],
  ["check:clocks", "npm", ["run", "check:clocks"]],
  ["check:no-op-tests", "npm", ["run", "check:no-op-tests"]],
  ["trace:ac", "npm", ["run", "trace:ac", "--", "--scope=merged"]],
  ["check:schema", "npm", ["run", "check:schema"]],
  [
    "bulk-paths inventory",
    process.execPath,
    ["--test", "tests/node/bulk-paths.AC-66-69.test.mjs"],
  ],
  [
    "reset-demo counts",
    "npx",
    [
      "vitest",
      "run",
      "tests/integration/reset-demo.test.ts",
      "--testNamePattern",
      "reset-demo restores the full seeded baseline",
    ],
  ],
  [
    "projection call-site inventory",
    process.execPath,
    ["--test", "tests/node/public-write-inventory.test.mjs"],
  ],
];

function commandLine(binary, arguments_) {
  return [binary, ...arguments_].join(" ");
}

function run(binary, arguments_) {
  return new Promise((resolveExit, reject) => {
    const child = spawn(binary, arguments_, {
      cwd: REPOSITORY_ROOT,
      env: process.env,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (exitCode, signal) => {
      resolveExit(exitCode ?? (signal ? 1 : 0));
    });
  });
}

const totalOperands = checks.reduce((total, [, , arguments_]) => total + arguments_.length, 0);
if (checks.length === 0 || totalOperands <= 0) {
  throw new Error("[prepush] battery definition is empty");
}

process.stdout.write(`[prepush] ${checks.length} checks; positive operands=${totalOperands}\n`);

for (const [index, [name, binary, arguments_]] of checks.entries()) {
  const operandCount = arguments_.length;
  if (operandCount <= 0) throw new Error(`[prepush] ${name} has no operands`);

  process.stdout.write(
    `\n[prepush] ${index + 1}/${checks.length} ${name}; positive operands=${operandCount}\n`
      + `[prepush] $ ${commandLine(binary, arguments_)}\n`,
  );
  const exitCode = await run(binary, arguments_);
  if (exitCode !== 0) {
    process.stderr.write(`[prepush] FAILED: ${name} (exit ${exitCode})\n`);
    process.exitCode = exitCode;
    break;
  }
  process.stdout.write(`[prepush] PASS: ${name}; positive operands=${operandCount}\n`);
}

if (process.exitCode === undefined) {
  process.stdout.write(`\n[prepush] PASS: all ${checks.length} checks\n`);
}
