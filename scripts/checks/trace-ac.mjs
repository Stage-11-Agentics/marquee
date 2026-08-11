import { readdir, readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";

import { REPOSITORY_ROOT, emit, parseArguments, writeReport } from "./lib/command.mjs";
import { buildCoverage, parseEvaluationContract, scanTestSource } from "./trace-ac-core.mjs";

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path)));
    else if (/\.(spec|test)\.[cm]?[jt]sx?$/.test(entry.name)) files.push(path);
  }
  return files;
}

const args = parseArguments();
const scope = args.scope ?? "merged";
if (!new Set(["merged", "all"]).has(scope)) throw new Error("trace:ac --scope must be merged or all");

const evaluation = await readFile(resolve(REPOSITORY_ROOT, "EVALUATION.md"), "utf8");
const criteria = parseEvaluationContract(evaluation);
const testFiles = await walk(resolve(REPOSITORY_ROOT, "tests"));
const scans = await Promise.all(
  testFiles.map(async (path) => scanTestSource(await readFile(path, "utf8"), path.slice(REPOSITORY_ROOT.length + 1))),
);
const claimsDirectory = resolve(REPOSITORY_ROOT, "tests/ac-claims");
const claimFiles = (await readdir(claimsDirectory).catch(() => []))
  .filter((name) => extname(name) === ".json")
  .sort();
const claims = await Promise.all(
  claimFiles.map(async (name) => JSON.parse(await readFile(join(claimsDirectory, name), "utf8"))),
);
const result = buildCoverage({ criteria, scans, claims, scope });
const currentTicket = args.ticket ? String(args.ticket) : undefined;
const warnings = [];
if (scope === "merged" && currentTicket && !claims.some((claim) => claim.ticket === currentTicket)) {
  warnings.push({ code: "missing-current-ticket-manifest", ticket: currentTicket });
}
const report = {
  command: "trace:ac",
  status: result.errors.length || result.uncovered.length ? "fail" : "pass",
  scope,
  ticket: currentTicket ?? null,
  counts: {
    live: criteria.size,
    testFiles: testFiles.length,
    claims: claims.length,
    uncovered: result.uncovered.length,
    errors: result.errors.length,
  },
  warnings,
  ...result,
};
const reportPath = await writeReport("ac-coverage.json", report);
emit({ ...report, coverage: undefined, report: reportPath });
if (report.status === "fail") process.exitCode = 1;
