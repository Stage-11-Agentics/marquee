import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { REPOSITORY_ROOT, emit, recordSpeedHarness } from "./lib/command.mjs";

/**
 * Two different numbers doing two different jobs. Conflating them is what made
 * a green suite go red on a busy machine.
 *
 * `BUDGET_MS` is the inner-loop clock — an OBJECTIVE. Speed budgets report and
 * warn; they never fail CI (client ruling, 2026-08-09). Wall time on a hermetic
 * parallel suite is dominated by how many cores it can actually get, and this
 * repo is worked by several agents at once while CI runs on a far smaller
 * machine. A number that means "fast enough here" cannot also mean "correct".
 * Exceeding it is a signal to go fix the suite, not a reason to block a merge.
 *
 * `HARD_LIMIT_MS` is a hang detector, and it does fail: a killed suite has
 * unknown results, and unknown is not passing. It is set generously on purpose,
 * because its job is to catch a wedged process, not a slow one.
 *
 * A real test failure fails regardless of either number. That is the only thing
 * a red suite should ever mean.
 */
const BUDGET_MS = 45_000;
const HARD_LIMIT_MS = 240_000;
const startedAt = performance.now();
const vitestEntry = resolve(REPOSITORY_ROOT, "node_modules/vitest/vitest.mjs");
let timedOut = false;
const testEnvironment = {
  ...process.env,
  TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
  TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
  LOG_LEVEL: "silent",
};

async function runSteps(argumentSets) {
  const children = argumentSets.map((arguments_) =>
    spawn(process.execPath, arguments_, {
      cwd: REPOSITORY_ROOT,
      stdio: "inherit",
      env: testEnvironment,
    }),
  );
  const remainingMs = Math.max(1, HARD_LIMIT_MS - (performance.now() - startedAt));
  const timer = setTimeout(() => {
    timedOut = true;
    for (const child of children) child.kill("SIGTERM");
  }, remainingMs);
  const codes = await Promise.all(
    children.map(
      (child) =>
        new Promise((resolveExit, reject) => {
          child.once("error", reject);
          child.once("exit", (exitCode, signal) => resolveExit(exitCode ?? (signal ? 1 : 0)));
        }),
    ),
  );
  clearTimeout(timer);
  return codes.find((code) => code !== 0) ?? 0;
}

// One Vitest run covering both projects. Two runs each sized their own worker
// pool to the whole machine, so the suite competed with itself for cores before
// any other agent's build entered the picture; vitest.config.ts now declares
// both projects so a single scheduler owns the whole budget.
let exitCode = await runSteps([[vitestEntry, "run"]]);
if (exitCode === 0 && !timedOut) {
  const nodeTestRoot = resolve(REPOSITORY_ROOT, "tests/node");
  const nodeTests = (await readdir(nodeTestRoot, { recursive: true }))
    .filter((path) => /\.test\.mjs$/.test(path))
    .map((path) => resolve(nodeTestRoot, path));
  if (nodeTests.length) exitCode = await runSteps([["--test", ...nodeTests]]);
}

const elapsedMs = Math.round(performance.now() - startedAt);
const overBudget = elapsedMs > BUDGET_MS;
await recordSpeedHarness("suite", {
  observedMs: elapsedMs,
  budgetMs: BUDGET_MS,
  verdict: overBudget ? "warn" : "pass",
  source: "local npm test wall clock",
  environment: "local worktree; not deployed evidence",
});
if (overBudget && !timedOut) {
  // Loud, because a suite that quietly drifts past its budget is how the inner
  // loop rots. Not fatal, because the machine it ran on is not the change.
  process.stdout.write(
    `\n[test] OVER BUDGET: ${elapsedMs}ms against a ${BUDGET_MS}ms objective. ` +
      `Tests passed; the suite is slow. Check machine load before treating this as a defect.\n`,
  );
}
emit({
  command: "test",
  status: timedOut ? "timeout" : exitCode === 0 ? (overBudget ? "pass-over-budget" : "pass") : "fail",
  elapsedMs,
  budgetMs: BUDGET_MS,
  overBudget,
  hermetic: true,
});

// A killed suite has unknown results, and unknown is not passing. A slow one
// that finished is reported, not failed.
process.exitCode = timedOut ? 1 : exitCode;
