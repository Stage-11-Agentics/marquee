import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { REPOSITORY_ROOT, emit } from "./lib/command.mjs";

const HARD_LIMIT_MS = 29_000;
const startedAt = performance.now();
const vitestEntry = resolve(REPOSITORY_ROOT, "node_modules/vitest/vitest.mjs");
let timedOut = false;
const testEnvironment = {
  ...process.env,
  TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
  TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
};

async function runStep(arguments_) {
  const child = spawn(process.execPath, arguments_, {
    cwd: REPOSITORY_ROOT,
    stdio: "inherit",
    env: testEnvironment,
  });
  const remainingMs = Math.max(1, HARD_LIMIT_MS - (performance.now() - startedAt));
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
  }, remainingMs);
  const code = await new Promise((resolveExit, reject) => {
    child.once("error", reject);
    child.once("exit", (exitCode, signal) => resolveExit(exitCode ?? (signal ? 1 : 0)));
  });
  clearTimeout(timer);
  return code;
}

let exitCode = await runStep([vitestEntry, "run", "--config", "vitest.config.ts"]);
if (exitCode === 0 && !timedOut) {
  const nodeTestRoot = resolve(REPOSITORY_ROOT, "tests/node");
  const nodeTests = (await readdir(nodeTestRoot, { recursive: true }))
    .filter((path) => /\.test\.mjs$/.test(path))
    .map((path) => resolve(nodeTestRoot, path));
  if (nodeTests.length) exitCode = await runStep(["--test", ...nodeTests]);
}

const elapsedMs = Math.round(performance.now() - startedAt);
emit({
  command: "test",
  status: timedOut ? "timeout" : exitCode === 0 ? "pass" : "fail",
  elapsedMs,
  budgetMs: 30_000,
  hermetic: true,
});

process.exitCode = timedOut || elapsedMs > 30_000 ? 1 : exitCode;
