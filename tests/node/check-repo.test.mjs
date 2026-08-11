import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function git(repository, ...arguments_) {
  const result = spawnSync("git", ["-C", repository, ...arguments_], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
}

async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), "marquee-repo-policy-"));
  const repository = resolve(root, "publish");
  const binaryDirectory = resolve(root, "bin");
  await mkdir(resolve(repository, "src"), { recursive: true });
  await mkdir(binaryDirectory, { recursive: true });
  await writeFile(resolve(binaryDirectory, "gitleaks"), "#!/bin/sh\nexit 0\n", "utf8");
  await chmod(resolve(binaryDirectory, "gitleaks"), 0o755);
  await writeFile(resolve(repository, "LICENSE"), "Apache License, Version 2.0\n", "utf8");
  await writeFile(resolve(repository, "src/index.ts"), "export const ready = true;\n", "utf8");
  await writeFile(
    resolve(repository, "README.md"),
    "# Public fixture\n\nRegistration sync, Airtable, and calendar OAuth are extension points.\n\n1. Prepare\n\n```sh\nnpm ci\n```\n\n2. Verify\n",
    "utf8",
  );
  git(repository, "init", "-q");
  git(repository, "config", "user.email", "test@example.invalid");
  git(repository, "config", "user.name", "Harness Test");
  git(repository, "add", ".");
  git(repository, "commit", "-qm", "clean public history");
  return { repository, binaryDirectory };
}

function runCheck(repository, binaryDirectory) {
  return spawnSync(
    process.execPath,
    [resolve(repositoryRoot, "scripts/checks/check-repo.mjs"), "--repo", repository, "--ref", "HEAD"],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: { ...process.env, PATH: `${binaryDirectory}:${process.env.PATH}` },
    },
  );
}

test("CONTRACT · repository policy accepts a clean full history", async () => {
  const { repository, binaryDirectory } = await fixture();
  const result = runCheck(repository, binaryDirectory);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /"fullHistory": true/);
});

test("CONTRACT · repository policy rejects denied content anywhere in history", async () => {
  const { repository, binaryDirectory } = await fixture();
  await mkdir(resolve(repository, "sources"));
  await writeFile(resolve(repository, "sources/brief.pdf"), "not actually a PDF\n", "utf8");
  git(repository, "add", ".");
  git(repository, "commit", "-qm", "introduce denied history");
  const result = runCheck(repository, binaryDirectory);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /denied-history-path/);
});

test("CONTRACT · repository policy retains every denied path with duplicate content", async () => {
  const { repository, binaryDirectory } = await fixture();
  await mkdir(resolve(repository, "sequence/research/sources"), { recursive: true });
  const duplicate = "same blob, distinct denied path names\n";
  await writeFile(resolve(repository, "sequence/research/sources/first.vtt"), duplicate, "utf8");
  await writeFile(resolve(repository, "sequence/research/sources/second.vtt"), duplicate, "utf8");
  git(repository, "add", ".");
  git(repository, "commit", "-qm", "introduce duplicate denied paths");
  const result = runCheck(repository, binaryDirectory);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /sequence\/research\/sources\/first\.vtt/);
  assert.match(result.stdout, /sequence\/research\/sources\/second\.vtt/);
});

test("CONTRACT · repository policy rejects internal publication vocabulary anywhere in history", async () => {
  const { repository, binaryDirectory } = await fixture();
  const deniedMarkers = [
    ["forgejo", ".", "stage", "11", ".", "ai"].join(""),
    ["tail", "net"].join(""),
    ["Lat", "tice"].join(""),
    ["dele", "gator"].join(""),
    ["orches", "trator"].join(""),
  ];
  await writeFile(
    resolve(repository, "internal-notes.md"),
    `${deniedMarkers.join(" ")}\n`,
    "utf8",
  );
  git(repository, "add", ".");
  git(repository, "commit", "-qm", "introduce internal publication vocabulary");
  const result = runCheck(repository, binaryDirectory);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  for (const label of [
    ["internal Forge", "jo hostname"].join(""),
    ["tail", "net identifier"].join(""),
    ["Lat", "tice vocabulary"].join(""),
    ["dele", "gator vocabulary"].join(""),
    ["orches", "trator vocabulary"].join(""),
  ]) {
    assert.match(result.stdout, new RegExp(label));
  }
});
