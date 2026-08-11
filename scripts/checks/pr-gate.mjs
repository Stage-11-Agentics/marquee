import { spawn } from "node:child_process";
import { resolve } from "node:path";

import { REPOSITORY_ROOT, emit, parseArguments, recordSpeedHarness } from "./lib/command.mjs";

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
const PR_GATE_BUDGET_MS = 30_000;
for (const [name, binary, commandArgs] of checks) {
  process.stdout.write(`\n[pr-gate] ${name}\n`);
  const code = await new Promise((resolveExit, reject) => {
    const child = spawn(binary, commandArgs, { cwd: REPOSITORY_ROOT, stdio: "inherit", env: process.env });
    child.once("error", reject);
    child.once("exit", (exitCode) => resolveExit(exitCode ?? 1));
  });
  if (code !== 0) {
    const elapsedMs = Math.round(performance.now() - startedAt);
    await recordSpeedHarness("pr_gate", {
      observedMs: elapsedMs,
      budgetMs: PR_GATE_BUDGET_MS,
      verdict: elapsedMs <= PR_GATE_BUDGET_MS ? "pass" : "fail",
      source: "local pr-gate wall clock",
      environment: "local worktree; not deployed evidence",
    });
    emit({ command: "pr-gate", ticket: args.ticket, status: "fail", failedCheck: name });
    process.exit(code);
  }
}
const elapsedMs = Math.round(performance.now() - startedAt);
await recordSpeedHarness("pr_gate", {
  observedMs: elapsedMs,
  budgetMs: PR_GATE_BUDGET_MS,
  verdict: elapsedMs <= PR_GATE_BUDGET_MS ? "pass" : "fail",
  source: "local pr-gate wall clock",
  environment: "local worktree; not deployed evidence",
});
const status = elapsedMs <= PR_GATE_BUDGET_MS ? "pass" : "fail";
emit({ command: "pr-gate", ticket: args.ticket, status, elapsedMs, budgetMs: PR_GATE_BUDGET_MS });
if (status === "fail") process.exitCode = 1;
