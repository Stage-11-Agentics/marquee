/**
 * check:schema — run the schema verifier when, and only when, the schema moved.
 *
 * `scripts/schema-verify.mjs` applies every migration to a scratch SQLite
 * database and asserts the resulting shape: table count, named indexes, foreign
 * keys, triggers. It is the only check that reads what the migrations actually
 * build rather than what a test fixture says they build.
 *
 * It was wired into nothing, and it drifted. Nine migrations landed in one day
 * against a hand-maintained table count, and the verifier sat at 51 tables while
 * the migrations defined 52 — a failure nobody saw because nothing ran it. A
 * check that is not in a gate is a check that is already stale.
 *
 * It runs in CI, not in `pr-gate`, and takes ~100 seconds because it spawns
 * Wrangler, which spawns workerd. `pr-gate` runs on the shared machine where
 * the whole fleet builds at once — measured at load 189 with 85 workerd
 * processes alive — and adding another workerd-spawning check there compounds
 * the contention it would be measured against. CI gets a dedicated runner with
 * none of that, which is the only place a hundred-second check is honest.
 *
 * Drift comes from exactly three places, so those are the trigger:
 *
 *   - `migrations/` — the statements themselves
 *   - `src/db/schema.ts` — the type mirror the verifier compares against
 *   - `scripts/schema-verify.mjs` — the expectations
 *
 * Touch none of them and this exits immediately. Touch any of them and the full
 * verification runs. `--force` runs it regardless, which is what CI does on a
 * push to main.
 */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

import { REPOSITORY_ROOT, emit, parseArguments } from "./lib/command.mjs";

const WATCHED = ["migrations/", "src/db/schema.ts", "scripts/schema-verify.mjs"];
const args = parseArguments();
const force = process.argv.includes("--force") || args.force === true;

function git(...commandArgs) {
  return spawnSync("git", commandArgs, { cwd: REPOSITORY_ROOT, encoding: "utf8" });
}

/**
 * The merge-base, not the branch tip: files that changed on main since this
 * branch started are not this branch's changes, and counting them would run the
 * slow path on every branch that is a few merges behind.
 */
function changedFiles() {
  for (const candidate of ["github/main", "main"]) {
    if (git("rev-parse", "--verify", "--quiet", candidate).status !== 0) continue;
    const mergeBase = git("merge-base", candidate, "HEAD");
    const base = mergeBase.status === 0 && mergeBase.stdout.trim() ? mergeBase.stdout.trim() : candidate;
    const diff = git("diff", "--name-only", base);
    if (diff.status === 0) return diff.stdout.split("\n").filter(Boolean);
  }
  return null;
}

const changed = force ? null : changedFiles();
// A repository with no main to compare against cannot prove the schema is
// untouched, so it verifies rather than assumes.
const touched = changed === null
  ? WATCHED
  : changed.filter((path) => WATCHED.some((watched) => path.startsWith(watched)));

if (!force && touched.length === 0) {
  process.stdout.write("[check:schema] schema untouched on this branch — skipped\n");
  emit({ command: "check:schema", status: "pass", verified: false, reason: "schema-untouched" });
  process.exit(0);
}

process.stdout.write(
  force
    ? "[check:schema] --force: verifying\n"
    : `[check:schema] schema touched (${touched.join(", ")}) — verifying\n`,
);
const startedAt = performance.now();
const result = spawnSync(process.execPath, [resolve(REPOSITORY_ROOT, "scripts/schema-verify.mjs")], {
  cwd: REPOSITORY_ROOT,
  stdio: "inherit",
});
const elapsedMs = Math.round(performance.now() - startedAt);
const status = result.status === 0 ? "pass" : "fail";
emit({ command: "check:schema", status, verified: true, touched, elapsedMs });
process.exitCode = result.status ?? 1;
