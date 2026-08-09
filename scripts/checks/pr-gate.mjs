import { spawn } from "node:child_process";
import { resolve } from "node:path";

import { REPOSITORY_ROOT, emit, parseArguments } from "./lib/command.mjs";

const args = parseArguments();
if (!args.ticket || !/^MRQ-\d+$/.test(String(args.ticket))) throw new Error("pr-gate requires --ticket MRQ-N");
const tsc = resolve(REPOSITORY_ROOT, "node_modules/.bin/tsc");
const vite = resolve(REPOSITORY_ROOT, "node_modules/.bin/vite");

const checks = [
  ["worker types", tsc, ["-p", "tsconfig.json", "--noEmit"]],
  ["client types", tsc, ["-p", "tsconfig.client.json", "--noEmit"]],
  ["test types", tsc, ["-p", "tsconfig.test.json", "--noEmit"]],
  ["production build", vite, ["build"]],
  ["design contract", "npm", ["run", "check:design"]],
  ["hermetic fast suite", "npm", ["test"]],
  ["merged AC trace", "npm", ["run", "trace:ac", "--", "--scope=merged", `--ticket=${args.ticket}`]],
];

const startedAt = performance.now();
for (const [name, binary, commandArgs] of checks) {
  process.stdout.write(`\n[pr-gate] ${name}\n`);
  const code = await new Promise((resolveExit, reject) => {
    const child = spawn(binary, commandArgs, { cwd: REPOSITORY_ROOT, stdio: "inherit", env: process.env });
    child.once("error", reject);
    child.once("exit", (exitCode) => resolveExit(exitCode ?? 1));
  });
  if (code !== 0) {
    emit({ command: "pr-gate", ticket: args.ticket, status: "fail", failedCheck: name });
    process.exit(code);
  }
}
emit({ command: "pr-gate", ticket: args.ticket, status: "pass", elapsedMs: Math.round(performance.now() - startedAt) });
