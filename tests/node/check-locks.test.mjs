import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { formatWarnings, inspectLocks, resolveGitCommonDir } from "../../scripts/checks/check-locks.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const checkLocks = resolve(repositoryRoot, "scripts/checks/check-locks.mjs");

async function temporaryDirectory(prefix) {
  return mkdtemp(resolve(tmpdir(), prefix));
}

async function fixtureLock(commonDir, relativePath, contents, mtimeMs) {
  const path = resolve(commonDir, relativePath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents, "utf8");
  const time = new Date(mtimeMs);
  await utimes(path, time, time);
  return path;
}

function git(cwd, ...arguments_) {
  const result = spawnSync("git", ["-C", cwd, ...arguments_], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stdout + result.stderr);
}

test("CONTRACT · a lock younger than two minutes stays quiet", async () => {
  const commonDir = await temporaryDirectory("marquee-locks-fresh-");
  try {
    const now = Date.now();
    await fixtureLock(commonDir, "index.lock", "working", now - 60_000);
    let inspectedForLiveGit = false;
    const result = await inspectLocks(commonDir, {
      now,
      liveGitProcess: () => {
        inspectedForLiveGit = true;
        return true;
      },
    });

    assert.equal(result.status, "pass");
    assert.deepEqual(result.warnings, []);
    assert.equal(formatWarnings(result.warnings), "");
    assert.equal(inspectedForLiveGit, false, "a fresh lock should not trigger an alarming process check");
  } finally {
    await rm(commonDir, { recursive: true, force: true });
  }
});

test("CONTRACT · an old lock reports its age, size, and live git state", async () => {
  const commonDir = await temporaryDirectory("marquee-locks-old-");
  try {
    const now = Date.now();
    const file = await fixtureLock(commonDir, "config.lock", "stale-lock", now - (3 * 60_000) - 1);
    const result = await inspectLocks(commonDir, { now, liveGitProcess: () => false });

    assert.equal(result.status, "warn");
    assert.deepEqual(result.warnings, [{
      file,
      ageMinutes: 3,
      sizeBytes: Buffer.byteLength("stale-lock"),
      liveGitProcess: false,
    }]);
    assert.match(formatWarnings(result.warnings), /3 whole minutes old/);
    assert.match(formatWarnings(result.warnings), /10 bytes/);
    assert.match(formatWarnings(result.warnings), /live git process: no/);
    assert.match(formatWarnings(result.warnings), /Verify no live git process, then remove/);
  } finally {
    await rm(commonDir, { recursive: true, force: true });
  }
});

test("CONTRACT · a stale-lock warning still exits with code zero", async () => {
  const root = await temporaryDirectory("marquee-locks-cli-");
  const gitDir = resolve(root, "fixture.git");
  try {
    git(root, "init", "--bare", "-q", gitDir);
    await fixtureLock(gitDir, "HEAD.lock", "stale", Date.now() - (4 * 60_000));
    const result = spawnSync(process.execPath, [checkLocks], {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: { ...process.env, GIT_DIR: gitDir },
    });

    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /"command": "check:locks"/);
    assert.match(result.stdout, /"status": "warn"/);
    assert.match(result.stdout, /Verify no live git process, then remove/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("CONTRACT · linked worktrees resolve the shared git common directory", async () => {
  const root = await temporaryDirectory("marquee-locks-worktree-");
  const linked = resolve(root, "linked");
  try {
    git(root, "init", "-q");
    git(root, "config", "user.email", "check-locks@example.invalid");
    git(root, "config", "user.name", "Check Locks");
    await writeFile(resolve(root, "README.md"), "fixture\n", "utf8");
    git(root, "add", "README.md");
    git(root, "commit", "-qm", "fixture");
    git(root, "worktree", "add", "-q", "-b", "check-locks-linked", linked);

    assert.equal(await realpath(resolveGitCommonDir(linked)), await realpath(resolve(root, ".git")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
