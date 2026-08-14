import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const VERDICT_MODULE = pathToFileURL(resolve(ROOT, "scripts/checks/seed-verdict.mjs")).href;

function runNode(source) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", source], {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.once("error", reject);
    child.once("exit", (code, signal) => resolveRun({ code: code ?? (signal ? 1 : 0), stdout, stderr }));
  });
}

test("CONTRACT · MRQ-187 · an over-budget seed run passes with a warning verdict", async () => {
  const run = await runNode(`
    import { classifySeedRun, exitCodeForSeedStatus } from ${JSON.stringify(VERDICT_MODULE)};
    const result = classifySeedRun({ elapsedMs: 11, budgetMs: 10 });
    console.log(JSON.stringify(result));
    process.exit(exitCodeForSeedStatus(result.status));
  `);
  assert.equal(run.code, 0, run.stderr);
  assert.match(run.stdout, /"status":"pass-over-budget"/);
  assert.match(run.stdout, /"verdict":"warn"/);
});

test("CONTRACT · MRQ-187 · a hard-limit timeout exits one", async () => {
  const run = await runNode(`
    import { classifySeedRun, exitCodeForSeedStatus, runWithHardLimit } from ${JSON.stringify(VERDICT_MODULE)};
    const execution = await runWithHardLimit(() => new Promise(() => {}), { hardLimitMs: 25 });
    const result = classifySeedRun({ elapsedMs: execution.elapsedMs, budgetMs: 10, timedOut: execution.timedOut });
    console.log(JSON.stringify(result));
    process.exit(exitCodeForSeedStatus(result.status));
  `);
  assert.equal(run.code, 1, run.stderr);
  assert.match(run.stdout, /"status":"timeout"/);
  assert.match(run.stdout, /"verdict":"timeout"/);
});
