import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CHECKS_DIRECTORY = dirname(dirname(fileURLToPath(import.meta.url)));

export const REPOSITORY_ROOT = resolve(CHECKS_DIRECTORY, "../..");
export const ARTIFACT_DIRECTORY = resolve(REPOSITORY_ROOT, "artifacts/checks");

export function isGateRun(environment = process.env) {
  return environment.MARQUEE_GATE === "1";
}

export function parseArguments(argv = process.argv.slice(2)) {
  const parsed = { positional: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) {
      parsed.positional.push(argument);
      continue;
    }

    const [rawKey, inlineValue] = argument.slice(2).split("=", 2);
    const next = argv[index + 1];
    if (inlineValue !== undefined) {
      parsed[rawKey] = inlineValue;
    } else if (next !== undefined && !next.startsWith("--")) {
      parsed[rawKey] = next;
      index += 1;
    } else {
      parsed[rawKey] = true;
    }
  }
  return parsed;
}

export function emit(result) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

export async function writeReport(filename, result) {
  const outputPath = resolve(REPOSITORY_ROOT, filename);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  return outputPath;
}

/** Merge a harness wall-clock measurement without erasing speed entries. */
export async function recordSpeedHarness(name, measurement) {
  const outputPath = resolve(REPOSITORY_ROOT, "speed-report.json");
  let current = {};
  try {
    current = JSON.parse(await readFile(outputPath, "utf8"));
  } catch {
    // pr-gate may be the first command to write the report in a clean tree.
  }
  const next = {
    ...current,
    harness: {
      ...(current.harness ?? {}),
      [name]: measurement,
    },
  };
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return outputPath;
}

/** Start a fresh speed report while retaining the same-run seed measurement. */
export async function writeSpeedReport(result) {
  const outputPath = resolve(REPOSITORY_ROOT, "speed-report.json");
  let current = {};
  try {
    current = JSON.parse(await readFile(outputPath, "utf8"));
  } catch {
    // A speed check can be the first check command in a clean worktree.
  }
  return writeReport("speed-report.json", {
    ...result,
    harness: {
      ...(current.harness?.check_seed ? { check_seed: current.harness.check_seed } : {}),
      ...(result.harness ?? {}),
    },
  });
}

export async function runStub({ command, owner, reason, replacement }) {
  const result = {
    command,
    status: "stub",
    gate: isGateRun(),
    owner,
    missing: reason,
    replacement:
      replacement ??
      `Replace scripts/checks/${command.replaceAll(":", "-")}.mjs without renaming the package script.`,
  };
  const report = await writeReport(
    `artifacts/checks/${command.replaceAll(":", "-")}.json`,
    result,
  );
  emit({ ...result, report });
  if (result.gate) process.exitCode = 2;
  return result;
}
