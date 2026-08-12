#!/usr/bin/env node

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

import { REPOSITORY_ROOT } from "./lib/command.mjs";

const execFileAsync = promisify(execFile);
const FORBIDDEN_LITERAL = ["AIE", "NYC", "2026"].join(" ");
const SOURCE_ROOTS = ["src/", "scripts/", "cli/"];

function isSeedOrFixture(path) {
  return path.startsWith("scripts/seed/")
    || path.includes("/fixture")
    || path.endsWith("demo-fixture.ts");
}

const { stdout } = await execFileAsync("git", ["ls-files", "-z"], { cwd: REPOSITORY_ROOT });
const paths = stdout
  .split("\0")
  .filter((path) => SOURCE_ROOTS.some((root) => path.startsWith(root)))
  .filter((path) => !isSeedOrFixture(path));
const matches = [];

for (const path of paths) {
  const source = await readFile(`${REPOSITORY_ROOT}/${path}`, "utf8");
  if (source.includes(FORBIDDEN_LITERAL)) matches.push(path);
}

const result = {
  check: "shell-truth",
  status: matches.length === 0 ? "pass" : "fail",
  forbidden_literal: FORBIDDEN_LITERAL,
  scanned_files: paths.length,
  matches,
  allowed: ["scripts/seed/**", "**/*fixture*"],
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (matches.length > 0) process.exitCode = 1;
