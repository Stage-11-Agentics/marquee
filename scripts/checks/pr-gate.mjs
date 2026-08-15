import { spawn } from "node:child_process";
import { resolve } from "node:path";

import { REPOSITORY_ROOT, emit, parseArguments, recordSpeedHarness } from "./lib/command.mjs";

const args = parseArguments();
/**
 * A ticket is accepted, not demanded.
 *
 * Requiring one made the full gate unrunnable for work that has no ticket —
 * eval triage, a follow-up on someone else's PR, a review agent's own fix — and
 * the fallback everyone reached for was running the four `check:*` scripts by
 * hand. That hand-written list is not this list: it silently omits `check:clocks`
 * and the merged AC trace, which is exactly the pair that reached CI red on #99
 * after a green local run. The gate is the thing that knows what CI runs, so the
 * gate has to be the thing anyone can run.
 *
 * With a ticket, the AC trace is scoped to it. Without one, it runs `--scope=merged`
 * exactly as CI does. A malformed ticket is still an error, because a typo that
 * silently widened the scope would be worse than being told.
 */
if (args.ticket !== undefined && !/^MRQ-\d+$/.test(String(args.ticket))) {
  throw new Error(`pr-gate: --ticket must look like MRQ-N (got "${args.ticket}"); omit it entirely to gate unticketed work`);
}
const tsc = resolve(REPOSITORY_ROOT, "node_modules/.bin/tsc");
const vite = resolve(REPOSITORY_ROOT, "node_modules/.bin/vite");

const checks = [
  ["git lock report", "npm", ["run", "check:locks"]],
  ["worker types", tsc, ["-p", "tsconfig.json", "--noEmit"]],
  ["client types", tsc, ["-p", "tsconfig.client.json", "--noEmit"]],
  ["test types", tsc, ["-p", "tsconfig.test.json", "--noEmit"]],
  ["source-text test guard", "npm", ["run", "check:no-op-tests"]],
  ["production build", vite, ["build"]],
  ["shell truth", "npm", ["run", "check:shell-truth"]],
  ["design contract", "npm", ["run", "check:design"]],
  ["API contract", "npm", ["run", "check:api"]],
  ["route map", "npm", ["run", "check:routes"]],
  ["fixture clocks", "npm", ["run", "check:clocks"]],
  ["schema shape", "npm", ["run", "check:schema"]],
  ["hermetic fast suite", "npm", ["test"]],
  ["merged AC trace", "npm", ["run", "trace:ac", "--", "--scope=merged", ...(args.ticket ? [`--ticket=${args.ticket}`] : [])]],
];

const startedAt = performance.now();
// An OBJECTIVE, not a verdict — the same rule `run-test.mjs` already follows.
// This is the 45s suite budget plus the production build and three typechecks,
// and every one of those numbers describes the machine it ran on rather than
// the change being gated. Several agents build here at once; on a loaded box
// the suite alone has been seen at 258s with nothing wrong. Failing the gate on
// wall clock turns contention into a red merge gate, and a red that does not
// mean "broken" teaches a fleet to re-run instead of read.
//
// A failing check still fails, immediately and by its own exit code. That is
// the only thing a red gate should ever mean.
const PR_GATE_BUDGET_MS = 120_000;
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
      verdict: elapsedMs <= PR_GATE_BUDGET_MS ? "pass" : "warn",
      source: "local pr-gate wall clock",
      environment: "local worktree; not deployed evidence",
    });
    emit({ command: "pr-gate", ticket: args.ticket ?? null, status: "fail", failedCheck: name });
    process.exit(code);
  }
}
const elapsedMs = Math.round(performance.now() - startedAt);
await recordSpeedHarness("pr_gate", {
  observedMs: elapsedMs,
  budgetMs: PR_GATE_BUDGET_MS,
  verdict: elapsedMs <= PR_GATE_BUDGET_MS ? "pass" : "warn",
  source: "local pr-gate wall clock",
  environment: "local worktree; not deployed evidence",
});
const overBudget = elapsedMs > PR_GATE_BUDGET_MS;
if (overBudget) {
  // Loud, because a gate that quietly drifts past its budget is how the inner
  // loop rots. Not fatal, because the machine it ran on is not the change.
  process.stdout.write(
    `\n[pr-gate] OVER BUDGET: ${elapsedMs}ms against a ${PR_GATE_BUDGET_MS}ms objective. ` +
      `Every check passed; the gate is slow. Check machine load before treating this as a defect.\n`,
  );
}
emit({
  command: "pr-gate",
  ticket: args.ticket ?? null,
  status: overBudget ? "pass-over-budget" : "pass",
  elapsedMs,
  budgetMs: PR_GATE_BUDGET_MS,
  overBudget,
});
