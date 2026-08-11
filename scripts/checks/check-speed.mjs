#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { emit, isGateRun, parseArguments, writeSpeedReport } from "./lib/command.mjs";
import { runSpeedCheck } from "./speed.ts";
import { classifySpeedMeasurements } from "./speed-budgets.mjs";

const args = parseArguments();
let result;
if (args.input) {
  // Keep the old explicit-input seam for operators replaying a captured
  // report, but classify it with the same binding AC/objective rules as the
  // local harness. It is never labeled as deployed evidence.
  const measurements = JSON.parse(await readFile(resolve(String(args.input)), "utf8"));
  const classified = classifySpeedMeasurements(measurements, { gate: isGateRun() });
  result = {
    command: "check:speed",
    status: classified.shouldFail ? "fail" : "pass",
    gate: isGateRun(),
    environment: { kind: "provided-input", runtime: "captured measurements", deployed: false },
    measurements,
    ...classified,
    follow_up: "Provided input is not deployed evidence; MRQ-57 owns production measurements.",
  };
} else {
  result = await runSpeedCheck({ gate: isGateRun() });
}

const report = await writeSpeedReport(result);
emit({ ...result, report });
if (result.status === "fail") process.exitCode = 1;
