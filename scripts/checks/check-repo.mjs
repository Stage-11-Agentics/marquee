import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { resolve } from "node:path";

import { emit, parseArguments, writeReport } from "./lib/command.mjs";
import { findDeniedContent, findDeniedPaths } from "./repo-policy.mjs";

function run(binary, arguments_, options = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(binary, arguments_, { ...options, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => resolveRun({ code: code ?? 1, stdout, stderr }));
  });
}

const args = parseArguments();
if (!args.repo || !args.ref) throw new Error("check:repo requires explicit --repo and --ref publish targets");
const repository = resolve(String(args.repo));
await access(repository);
const resolved = await run("git", ["-C", repository, "rev-parse", "--verify", `${args.ref}^{commit}`]);
if (resolved.code !== 0) throw new Error(`check:repo could not resolve publish ref ${args.ref}`);

const currentTree = await run("git", ["-C", repository, "ls-tree", "-r", "--name-only", String(args.ref)]);
const historicalTree = await run("git", ["-C", repository, "log", "--full-history", "--format=", "--name-only", String(args.ref)]);
if (currentTree.code !== 0 || historicalTree.code !== 0) {
  throw new Error(`check:repo could not enumerate the full path history for ${args.ref}`);
}
const paths = [...new Set(`${currentTree.stdout}\n${historicalTree.stdout}`.split("\n").filter(Boolean))];
const patchHistory = await run("git", ["-C", repository, "log", "--format=", String(args.ref), "-p", "--no-ext-diff"]);
const prototype = await run("git", ["-C", repository, "grep", "-I", "-n", "PROTOTYPE", String(args.ref), "--", "src"]);
const readme = await run("git", ["-C", repository, "show", `${args.ref}:README.md`]);
const license = await run("git", ["-C", repository, "cat-file", "-e", `${args.ref}:LICENSE`]);
const findings = [
  ...findDeniedPaths(paths).map((path) => ({ code: "denied-history-path", path })),
  ...findDeniedContent(patchHistory.stdout).map((label) => ({ code: "denied-history-content", label })),
];
if (prototype.code === 0 && prototype.stdout.trim()) findings.push({ code: "prototype-badge-in-src", matches: prototype.stdout.trim().split("\n") });
if (readme.code !== 0) findings.push({ code: "missing-readme" });
else {
  if (!/1\.[\s\S]*```[\s\S]*2\./.test(readme.stdout)) findings.push({ code: "readme-numbered-deploy-sequence-missing" });
  for (const extension of ["registration", "Airtable", "calendar OAuth"]) {
    if (!readme.stdout.toLowerCase().includes(extension.toLowerCase())) findings.push({ code: "readme-extension-point-missing", extension });
  }
}
if (license.code !== 0) findings.push({ code: "missing-license" });

const gitleaks = await run("gitleaks", ["detect", "--source", repository, "--log-opts", String(args.ref), "--redact", "--no-banner"])
  .catch((error) => ({ code: 127, stdout: "", stderr: error.message }));
if (gitleaks.code !== 0) findings.push({ code: gitleaks.code === 127 ? "gitleaks-unavailable" : "gitleaks-finding" });

const report = {
  command: "check:repo",
  status: findings.length ? "fail" : "pass",
  repository,
  ref: String(args.ref),
  commit: resolved.stdout.trim(),
  fullHistory: true,
  findings,
};
const reportPath = await writeReport("artifacts/checks/repo.json", report);
emit({ ...report, report: reportPath });
if (report.status === "fail") process.exitCode = 1;
