import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { emit, isGateRun, parseArguments, runStub, writeReport } from "./lib/command.mjs";
import { classifySpeedMeasurements } from "./speed-budgets.mjs";

const args = parseArguments();
if (!args.input) {
  await runStub({
    command: "check:speed",
    owner: "MRQ-50",
    reason: "deployed seed measurements were not supplied with --input",
    replacement: "Measure all 14 manifest records on deployed infrastructure and pass their observed values as JSON via --input.",
  });
} else {
  const measurements = JSON.parse(await readFile(resolve(String(args.input)), "utf8"));
  const classified = classifySpeedMeasurements(measurements, { gate: isGateRun() });
  const result = {
    command: "check:speed",
    status: classified.shouldFail ? "fail" : "pass",
    gate: isGateRun(),
    ...classified,
  };
  const report = await writeReport("speed-report.json", result);
  emit({ ...result, report });
  if (result.status === "fail") process.exitCode = 1;
}
