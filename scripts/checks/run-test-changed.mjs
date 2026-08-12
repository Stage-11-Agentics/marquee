import { spawn, spawnSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { REPOSITORY_ROOT, emit } from "./lib/command.mjs";

/**
 * The inner-loop suite: only the tests your change can actually break.
 *
 * `npm test` runs all 700+ of them, which is the right thing for a merge gate
 * and the wrong thing for the twentieth agent running it on a shared laptop.
 * Every agent running the whole suite on every iteration is most of the load
 * this repo generates, and almost all of it is redundant — CI runs the full
 * suite on every push regardless.
 *
 * Vitest's `--changed` walks the real module graph from the changed files, so
 * this is scoped by dependency rather than by filename guessing: touching
 * `src/lib/public-site.ts` still pulls in every public-site suite.
 *
 * The node checks under `tests/node/` always run, and that is load-bearing
 * rather than belt-and-braces. Most `.tsx` coverage in this repo lives there as
 * source-text contracts — they `readFileSync` a component and assert on what is
 * in it, which is how the guard tests pin copy and prevent silent reverts.
 * Text-reading leaves no import edge, so vitest `--changed` correctly selects
 * *zero* suites for a component edit. Running the node checks unconditionally is
 * what keeps a UI change from being scoped down to nothing. They cost ~6s.
 *
 * This is a pre-push convenience, never a merge gate: `npm run pr-gate` and CI
 * both still run everything.
 */
const baseRef = process.argv[2] ?? defaultBaseRef();

function defaultBaseRef() {
  for (const candidate of ["github/main", "main"]) {
    const found = spawnSync("git", ["rev-parse", "--verify", "--quiet", candidate], {
      cwd: REPOSITORY_ROOT,
      encoding: "utf8",
    });
    if (found.status !== 0) continue;
    // The merge-base, not the branch tip. Diffing against the tip counts every
    // file that changed on main since you branched as one of yours, so a branch
    // that is a few merges behind scopes to "everything that differs" — safe,
    // but useless on a repo where main moves several times an hour. The
    // merge-base is the question actually being asked: what did I change?
    const mergeBase = spawnSync("git", ["merge-base", candidate, "HEAD"], {
      cwd: REPOSITORY_ROOT,
      encoding: "utf8",
    });
    if (mergeBase.status === 0 && mergeBase.stdout.trim()) return mergeBase.stdout.trim();
    return candidate;
  }
  return "HEAD";
}

// Two-dot against the working tree, not three-dot against HEAD: this runs
// before you commit, so uncommitted edits are exactly the changes that matter.
const changed = spawnSync("git", ["diff", "--name-only", baseRef], {
  cwd: REPOSITORY_ROOT,
  encoding: "utf8",
});
const changedFiles = (changed.stdout ?? "").split("\n").filter(Boolean);
process.stdout.write(
  `[test:changed] ${changedFiles.length} file(s) changed against ${baseRef}\n`,
);

const startedAt = performance.now();
const testEnvironment = {
  ...process.env,
  TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
  TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
  LOG_LEVEL: "silent",
};

function run(command, commandArgs) {
  return new Promise((resolveExit, reject) => {
    const child = spawn(command, commandArgs, {
      cwd: REPOSITORY_ROOT,
      stdio: "inherit",
      env: testEnvironment,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => resolveExit(code ?? (signal ? 1 : 0)));
  });
}

const vitestEntry = resolve(REPOSITORY_ROOT, "node_modules/vitest/vitest.mjs");
let exitCode = await run(process.execPath, [vitestEntry, "run", "--changed", baseRef]);

if (exitCode === 0) {
  const nodeTestRoot = resolve(REPOSITORY_ROOT, "tests/node");
  const nodeTests = (await readdir(nodeTestRoot, { recursive: true }))
    .filter((path) => /\.test\.mjs$/.test(path))
    .map((path) => resolve(nodeTestRoot, path));
  if (nodeTests.length) exitCode = await run(process.execPath, ["--test", ...nodeTests]);
}

const elapsedMs = Math.round(performance.now() - startedAt);
const sourceChanged = changedFiles.some((path) => path.startsWith("src/"));
if (sourceChanged) {
  // A fast green after a source edit is worth one sentence of context, so it is
  // read as "narrow" rather than "nothing to worry about".
  process.stdout.write(
    `\n[test:changed] source changed. Component edits select no vitest suites by ` +
      `design — their coverage is the node contract tests above, which always run.\n`,
  );
}
process.stdout.write(
  `[test:changed] scoped to ${baseRef}. Run \`npm test\` for the full suite before you open a PR.\n`,
);
emit({
  command: "test:changed",
  status: exitCode === 0 ? "pass" : "fail",
  baseRef,
  changedFiles: changedFiles.length,
  elapsedMs,
  scoped: true,
});
process.exitCode = exitCode;
