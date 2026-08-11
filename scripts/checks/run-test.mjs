import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { REPOSITORY_ROOT, emit, recordSpeedHarness } from "./lib/command.mjs";

/**
 * The inner-loop clock. The suite is hermetic and parallel, so wall time is
 * dominated by how many cores it can actually get — and this repo is routinely
 * worked by several agents at once, each running its own build and suite. The
 * budget is set to survive that contention rather than to fail on it: a red
 * suite must mean a real defect, not a busy machine, or the signal is worthless.
 *
 * The hard kill sits just under the budget so a hung suite is killed and
 * reported rather than hanging the gate.
 */
const BUDGET_MS = 45_000;
const HARD_LIMIT_MS = BUDGET_MS - 1_000;
const startedAt = performance.now();
const vitestEntry = resolve(REPOSITORY_ROOT, "node_modules/vitest/vitest.mjs");
const vitestConfigs = ["vitest.config.ts", "vitest.node.config.ts"];
let timedOut = false;
const testEnvironment = {
  ...process.env,
  TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
  TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
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

let exitCode = await runSteps(
  vitestConfigs.map((config) => [vitestEntry, "run", "--config", config]),
);
if (exitCode === 0 && !timedOut) {
  const nodeTestRoot = resolve(REPOSITORY_ROOT, "tests/node");
  const nodeTests = (await readdir(nodeTestRoot, { recursive: true }))
    .filter((path) => /\.test\.mjs$/.test(path))
    .map((path) => resolve(nodeTestRoot, path));
  if (nodeTests.length) exitCode = await runSteps([["--test", ...nodeTests]]);
}

const elapsedMs = Math.round(performance.now() - startedAt);
await recordSpeedHarness("suite", {
  observedMs: elapsedMs,
  budgetMs: BUDGET_MS,
  verdict: timedOut || elapsedMs > BUDGET_MS ? "fail" : "pass",
  source: "local npm test wall clock",
  environment: "local worktree; not deployed evidence",
});
emit({
  command: "test",
  status: timedOut ? "timeout" : exitCode === 0 ? "pass" : "fail",
  elapsedMs,
  budgetMs: BUDGET_MS,
  hermetic: true,
});

process.exitCode = timedOut || elapsedMs > BUDGET_MS ? 1 : exitCode;
