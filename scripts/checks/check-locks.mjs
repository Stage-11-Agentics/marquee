/**
 * check:locks — report stale shared-git locks without deciding that they are
 * safe to remove. A live lock may belong to a git process that is still
 * writing; the check names the lock and leaves the judgment to the operator.
 */
import { execFileSync } from "node:child_process";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { REPOSITORY_ROOT, emit } from "./lib/command.mjs";

export const NORMAL_LOCK_AGE_MS = 2 * 60 * 1000;
export const LOCK_PATHS = [
  "index.lock",
  "HEAD.lock",
  "config.lock",
  "refs/remotes/github/main.lock",
];

/**
 * The primary checkout and every linked worktree share this directory. Git
 * resolves a linked worktree's `.git` file to its shared common directory for
 * us; parsing that file ourselves would duplicate Git's path rules.
 */
export function resolveGitCommonDir(cwd = REPOSITORY_ROOT) {
  const commonDir = execFileSync(
    "git",
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    { cwd, encoding: "utf8" },
  ).trim();
  if (!commonDir) throw new Error("check:locks could not resolve git common directory");
  return commonDir;
}

export function hasLiveGitProcess() {
  try {
    const output = execFileSync("pgrep", ["-x", "git"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return output.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Inspect an explicit common directory so tests can use temporary fixture
 * locks. The command itself always supplies Git's resolved common directory.
 */
export async function inspectLocks(commonDir, { now = Date.now(), liveGitProcess = hasLiveGitProcess } = {}) {
  const stale = [];
  for (const relativePath of LOCK_PATHS) {
    const path = resolve(commonDir, relativePath);
    const details = await stat(path).catch(() => null);
    if (!details) continue;

    const ageMinutes = Math.floor(Math.max(0, now - details.mtimeMs) / 60_000);
    if (ageMinutes < NORMAL_LOCK_AGE_MS / 60_000) continue;
    stale.push({
      file: path,
      ageMinutes,
      sizeBytes: details.size,
    });
  }

  const liveGit = stale.length > 0 ? Boolean(liveGitProcess()) : false;
  const warnings = stale.map((lock) => ({ ...lock, liveGitProcess: liveGit }));
  return {
    command: "check:locks",
    status: warnings.length > 0 ? "warn" : "pass",
    warnings,
  };
}

export function formatWarnings(warnings) {
  return warnings.map((warning) =>
    `[check:locks] stale lock: ${warning.file}; ${warning.ageMinutes} whole minutes old; `
      + `${warning.sizeBytes} bytes; live git process: ${warning.liveGitProcess ? "yes" : "no"}.\n`
      + `  Verify no live git process, then remove ${warning.file}.\n`,
  ).join("");
}

export async function runCheck({ cwd = REPOSITORY_ROOT, now = Date.now(), liveGitProcess } = {}) {
  try {
    const commonDir = resolveGitCommonDir(cwd);
    const result = await inspectLocks(commonDir, { now, ...(liveGitProcess ? { liveGitProcess } : {}) });
    return { ...result, gitCommonDir: commonDir };
  } catch (error) {
    return {
      command: "check:locks",
      status: "warn",
      reason: "git-common-dir-unavailable",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

const isMainModule = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  const result = await runCheck();
  const warnings = formatWarnings(result.warnings ?? []);
  if (warnings) process.stdout.write(warnings);
  emit(result);
  // A lock is an operator-facing warning, never a gate verdict.
  process.exitCode = 0;
}
