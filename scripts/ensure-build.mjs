#!/usr/bin/env node

import { access, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "..");
const required = [
  resolve(repositoryRoot, "dist/marquee/index.js"),
  resolve(repositoryRoot, "src/agent-front-door/llms.txt"),
  resolve(repositoryRoot, "src/agent-front-door/llms-full.txt"),
];
const bootstrapMarker = "# Build bootstrap";

let ready = true;
for (const path of required) {
  try {
    await access(path);
    if (path.endsWith(".txt") && (await readFile(path, "utf8")).includes(bootstrapMarker)) ready = false;
  } catch {
    ready = false;
  }
}
if (ready) process.exit(0);

const result = spawnSync(process.execPath, [resolve(repositoryRoot, "scripts/build.mjs")], {
  cwd: repositoryRoot,
  stdio: "inherit",
  env: process.env,
});
if (result.status !== 0) throw new Error("ensure-build: could not create the Worker build");
