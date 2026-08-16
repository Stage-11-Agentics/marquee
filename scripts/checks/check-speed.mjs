#!/usr/bin/env node

/**
 * Decision: check:speed stays strict for AC-sourced interaction measurements
 * in both local runs and CI. R7 makes those measured product behaviors graded;
 * a contended local box may explain a red measurement, but it must not turn a
 * missed acceptance budget into a pass. The objective-only measurements already
 * remain warning-only through classifySpeedMeasurements. The check:seed wrapper
 * has a separate warning-only boot objective because its wall clock is dominated
 * by starting Wrangler rather than by the seeded behavior it verifies.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { emit, isGateRun, parseArguments, writeSpeedReport } from "./lib/command.mjs";
import { runSpeedCheck } from "./speed.ts";
import { classifySpeedMeasurements } from "./speed-budgets.mjs";

const args = parseArguments();
const scope = args.scope === undefined ? "all" : String(args.scope);
let result;
if (args.input) {
  // Keep the old explicit-input seam for operators replaying a captured
  // report, but classify it with the same binding AC/objective rules as the
  // local harness. It is never labeled as deployed evidence.
  const measurements = JSON.parse(await readFile(resolve(String(args.input)), "utf8"));
  const classified = classifySpeedMeasurements(measurements, { gate: isGateRun(), scope });
  result = {
    command: "check:speed",
    scope,
    status: classified.shouldFail ? "fail" : "pass",
    gate: isGateRun(),
    environment: { kind: "provided-input", runtime: "captured measurements", deployed: false },
    measurements,
    ...classified,
    follow_up: "Provided input is not deployed evidence; MRQ-57 owns production measurements.",
  };
} else {
  result = await runSpeedCheck({ gate: isGateRun(), scope });
}

const report = await writeSpeedReport(result);
emit({ ...result, report });
if (result.status === "fail") process.exitCode = 1;
