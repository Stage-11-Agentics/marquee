/**
 * check:docs — generated front-door markdown and served-manifest parity.
 *
 * The route is intentionally generated from source documents and live Worker
 * facts. A bare run compares bytes; --write is the only repair path, matching
 * check:routes' generate -> compare -> remedy contract.
 */
import { readFile } from "node:fs/promises";

import {
  FULL_OUTPUT_PATH,
  GENERATED_BANNER,
  LLMS_OUTPUT_PATH,
  MANIFEST_PATH,
  REPOSITORY_ROOT,
  renderFrontDoor,
  writeFrontDoorOutputs,
} from "../generate-agent-front-door.mjs";
import { emit, parseArguments } from "./lib/command.mjs";

const args = parseArguments();
const findings = [];
const result = await renderFrontDoor();

const compare = async (path, expected, remedy) => {
  const actual = await readFile(path, "utf8").catch(() => null);
  if (actual !== expected) findings.push({ code: actual === null ? "missing" : "drift", path, remedy });
};

if (args.write) {
  await writeFrontDoorOutputs(result);
} else {
  await compare(LLMS_OUTPUT_PATH, result.llmsText, "npm run check:docs -- --write");
  await compare(FULL_OUTPUT_PATH, result.fullText, "npm run check:docs -- --write");
}

const manifestText = await readFile(MANIFEST_PATH, "utf8");
const manifest = JSON.parse(manifestText);
const allowedSources = new Set([
  "README.md",
  "docs/GETTING-STARTED.md",
  "PHILOSOPHY.md",
  "DESIGN.md",
  "DEPLOY.md",
]);
const manifestUrls = new Set();
const manifestSources = new Set();
for (const entry of manifest) {
  if (manifestUrls.has(entry.url)) findings.push({ code: "manifest-duplicate-url", entry });
  if (manifestSources.has(entry.source)) findings.push({ code: "manifest-duplicate-source", entry });
  manifestUrls.add(entry.url);
  manifestSources.add(entry.source);
  if (!allowedSources.has(entry.source)) findings.push({ code: "manifest-source-not-allowed", entry });
  if (!entry.url.endsWith(".md")) findings.push({ code: "manifest-url-not-markdown", entry });
}
if (manifest.some((entry) => ["SPEC.md", "EVALUATION.md"].includes(entry.source))) {
  findings.push({ code: "repo-only-contract-in-served-manifest" });
}
if (!result.llmsText.startsWith(GENERATED_BANNER) || !result.fullText.startsWith(GENERATED_BANNER)) {
  findings.push({ code: "generated-banner-missing" });
}
const bundledDocumentUrls = [...result.fullText.matchAll(/<!-- Begin (\/[^ ]+) · canonical source /g)].map((match) => match[1]);
const expectedBundleUrls = [...manifest.map((entry) => entry.url), "/SKILL.md"];
if (JSON.stringify(bundledDocumentUrls) !== JSON.stringify(expectedBundleUrls)) {
  findings.push({
    code: "manifest-served-set-mismatch",
    expected: expectedBundleUrls,
    bundle: bundledDocumentUrls,
  });
}

const workerConfig = await readFile(`${REPOSITORY_ROOT}/wrangler.jsonc`, "utf8");
const workerFirst = /"run_worker_first"\s*:\s*\[([\s\S]*?)\]/.exec(workerConfig)?.[1] ?? "";
const workerPaths = [...workerFirst.matchAll(/"([^\"]+)"/g)].map((match) => match[1]);
for (const path of ["/llms.txt", "/llms-full.txt", ...manifest.map((entry) => entry.url)]) {
  if (!workerPaths.includes(path)) findings.push({ code: "assets-shadow-risk", path });
}

const report = {
  command: "check:docs",
  status: findings.length ? "fail" : "pass",
  generated: args.write === true,
  manifest: manifest.map((entry) => ({ url: entry.url, source: entry.source })),
  facts: result.facts,
  findings,
};
emit(report);
if (findings.length > 0) process.exitCode = 1;
