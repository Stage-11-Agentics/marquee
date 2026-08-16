#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { emit, parseArguments } from "./checks/lib/command.mjs";

const DEFAULT_PATHS = [
  "/health",
  "/llms.txt",
  "/llms-full.txt",
  "/SKILL.md",
  "/api/openapi.json",
  "/api/docs",
];
const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

function positiveInteger(value, name, fallback) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function localBaseUrl(value) {
  if (!value) throw new Error("--url is required");
  const base = new URL(value);
  if (!LOOPBACK_HOSTNAMES.has(base.hostname)) {
    throw new Error(`measure-latency is local-only; refusing ${base.hostname}`);
  }
  return base;
}

function pathsFrom(value) {
  if (value === undefined) return DEFAULT_PATHS;
  const paths = String(value)
    .split(",")
    .map((path) => path.trim())
    .filter(Boolean)
    .map((path) => (path.startsWith("/") ? path : `/${path}`));
  if (paths.length === 0) throw new Error("--paths must contain at least one path");
  return paths;
}

async function measurePath(base, path, runs, timeoutMs) {
  const samples = [];
  let status = null;
  let error;
  for (let run = 0; run < runs; run += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const started = performance.now();
    try {
      const response = await fetch(new URL(path, base), { signal: controller.signal });
      const ttfb = performance.now() - started;
      await response.arrayBuffer();
      status = response.status;
      samples.push(Number(ttfb.toFixed(2)));
      if (!response.ok) error = `HTTP ${response.status}`;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      clearTimeout(timeout);
    }
  }
  return {
    path,
    status: status ?? "error",
    ...(samples.length > 0 ? { ttfb_median_ms: Number(median(samples).toFixed(2)), samples } : {}),
    ...(error ? { error } : {}),
  };
}

const args = parseArguments();
const base = localBaseUrl(args.url);
const runs = positiveInteger(args.runs, "--runs", 5);
const timeoutMs = positiveInteger(args["timeout-ms"], "--timeout-ms", 10_000);
const paths = pathsFrom(args.paths);
const measurements = [];

for (const path of paths) {
  measurements.push(await measurePath(base, path, runs, timeoutMs));
}

const result = {
  schema_version: 1,
  source: "scripts/measure-latency.mjs",
  environment: String(args.environment ?? "local-wrangler-dev"),
  base_url: base.origin,
  runs,
  timeout_ms: timeoutMs,
  measured_at: new Date().toISOString(),
  measurements,
};

if (args.write) {
  const outputPath = resolve(process.cwd(), String(args.write === true ? "scripts/latency-baseline.json" : args.write));
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  result.wrote = outputPath;
}

emit(result);
if (measurements.some((measurement) => measurement.status === "error" || measurement.status < 200 || measurement.status >= 400)) {
  process.exitCode = 1;
}
