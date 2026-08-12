#!/usr/bin/env node

import { access } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const policyPath = resolve(repositoryRoot, "code/platform/r2-cors.json");
const wranglerPath = resolve(repositoryRoot, "node_modules/.bin/wrangler");
const allowedBuckets = new Set(["marquee-media", "marquee-media-preview"]);

function valueAfter(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

const bucket = valueAfter("--bucket") ?? process.env.MARQUEE_R2_CORS_BUCKET ?? "marquee-media";
if (!allowedBuckets.has(bucket)) {
  throw new Error(`Unsupported R2 bucket '${bucket}'. Use marquee-media or marquee-media-preview.`);
}

const missing = ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"].filter((name) => !process.env[name]);
if (missing.length > 0) {
  throw new Error(`Set the environment variables required to apply R2 CORS: ${missing.join(", ")}.`);
}

await access(policyPath);
await access(wranglerPath);

const child = spawn(
  wranglerPath,
  ["r2", "bucket", "cors", "set", bucket, "--file", policyPath, "--force"],
  { cwd: repositoryRoot, env: process.env, stdio: "inherit" },
);

child.once("error", (error) => {
  throw error;
});

const exitCode = await new Promise((resolveExit) => {
  child.once("exit", (code, signal) => resolveExit(code ?? (signal ? 1 : 0)));
});

if (exitCode !== 0) {
  throw new Error(`Wrangler could not apply the R2 CORS policy to ${bucket} (exit ${exitCode}).`);
}
