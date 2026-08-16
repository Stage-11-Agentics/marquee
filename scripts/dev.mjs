#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "..");
const build = spawnSync(process.execPath, [resolve(repositoryRoot, "scripts/build.mjs")], {
  cwd: repositoryRoot,
  stdio: "inherit",
  env: process.env,
});
if (build.status !== 0) process.exit(build.status ?? 1);

const vite = resolve(repositoryRoot, "node_modules/.bin/vite");
const server = spawn(vite, ["dev"], {
  cwd: repositoryRoot,
  stdio: "inherit",
  env: process.env,
});
server.on("close", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
