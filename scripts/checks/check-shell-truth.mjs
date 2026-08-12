#!/usr/bin/env node

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

import { REPOSITORY_ROOT } from "./lib/command.mjs";

const execFileAsync = promisify(execFile);
/**
 * Two literals, one scanner. The conference NAME must not be written into the
 * shell, and neither must its ID: a page that defaults to the seeded
 * conference's id renders conference A's data while the organizer is standing
 * in conference B, which is worse than a page that renders nothing.
 *
 * Both are allowed in the seed and its fixtures, which is where the seeded
 * conference is supposed to be named.
 */
const FORBIDDEN_LITERALS = [["AIE", "NYC", "2026"].join(" "), ["evt", "aie-ny-2026"].join("_")];
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
  for (const literal of FORBIDDEN_LITERALS) {
    if (source.includes(literal)) matches.push({ path, literal });
  }
}

const result = {
  check: "shell-truth",
  status: matches.length === 0 ? "pass" : "fail",
  forbidden_literals: FORBIDDEN_LITERALS,
  scanned_files: paths.length,
  matches,
  allowed: ["scripts/seed/**", "**/*fixture*"],
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (matches.length > 0) process.exitCode = 1;
