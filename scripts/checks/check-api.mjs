/**
 * check:api — single-source API parity.
 *
 * Two halves, per EVALUATION §1.1 and BUILDPLAN M-06:
 *
 *   - served JSON <-> rendered docs: LIVE from Wave 0. The built Worker bundle
 *     is served in-process and both endpoints are fetched for real.
 *   - CLI registry: activates once `cli/` exists (M-38). Before then it is
 *     skipped with a printed notice, because a hard failure over a registry no
 *     ticket has built yet would fail every PR from the first one — the same
 *     defect `trace:ac`'s `--scope` rule fixes.
 *
 * The three non-`/api/v1` calendar and feed URLs named in SPEC §4.2 are a named
 * allowlist, not drift.
 *
 * MRQ-9 completes the remaining half of the EVALUATION row: replaying a
 * full-loop Playwright session with network recording and asserting every
 * captured non-GET request exists in the public schema (AC-105's UI-only write
 * set). This command owns generation parity; that one owns traffic parity.
 */
import { spawn, spawnSync } from "node:child_process";
import { access, readdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

import { validate } from "@scalar/openapi-parser";

import { REPOSITORY_ROOT, emit, parseArguments, writeReport } from "./lib/command.mjs";

/** SPEC §4.2: consumed by calendar clients and feed readers that cannot follow a versioned prefix. */
const SPEC_4_2_ALLOWLIST = ["/i/{uid}.ics", "/agenda.json", "/api/v1/public/agenda.ics"];
/** The meta endpoints describe the versioned surface rather than belonging to it. */
const META_ALLOWLIST = ["/api/openapi.json", "/api/docs"];

const VERSIONED_PREFIX = "/api/v1";
const BUNDLE = resolve(REPOSITORY_ROOT, "dist/marquee/index.js");

function run(binary, args) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(binary, args, { cwd: REPOSITORY_ROOT, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => resolveRun(code ?? 1));
  });
}

/** Newest mtime under a directory, or 0 when it does not exist. */
async function newestMtimeMs(directory) {
  let newest = 0;
  const walk = async (path) => {
    let entries;
    try {
      entries = await readdir(path, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const child = resolve(path, entry.name);
      if (entry.isDirectory()) await walk(child);
      else {
        const info = await stat(child).catch(() => null);
        if (info && info.mtimeMs > newest) newest = info.mtimeMs;
      }
    }
  };
  await walk(directory);
  return newest;
}

/**
 * Freshness is decided by INPUTS, never by existence.
 *
 * "Rebuild only if the bundle is missing" is right exactly once — on a clean
 * checkout, which is why CI never saw this. In a worktree that survives a
 * merge, the bundle is present and describes the API as it was several commits
 * ago, and `dist/` is ignored so git cannot correct it. Both outcomes are
 * wrong and one of them is silent: the loud one reports operations "missing"
 * that are sitting in the tree, and the quiet one validates an API surface
 * nobody is shipping and calls it a pass. A check that answers about the wrong
 * artifact is worse than no check, because it is believed.
 */
async function bundleIsStale() {
  const bundle = await stat(BUNDLE).catch(() => null);
  if (!bundle) return { stale: true, reason: "no build found" };
  const newestSource = await newestMtimeMs(resolve(REPOSITORY_ROOT, "src"));
  if (newestSource > bundle.mtimeMs) return { stale: true, reason: "src/ is newer than the build" };
  return { stale: false };
}

async function loadWorker() {
  const { stale, reason } = await bundleIsStale();
  if (stale) {
    process.stdout.write(`[check:api] ${reason}; running npm run build\n`);
    const code = await run("npm", ["run", "build"]);
    if (code !== 0) throw new Error("check:api could not build the Worker bundle");
  }
  // Cache-bust so a rebuild inside one process is never served from module cache.
  const module = await import(`${pathToFileURL(BUNDLE).href}?t=${process.hrtime.bigint()}`);
  if (!module.app?.fetch) throw new Error("check:api: the Worker bundle does not export a Hono app");
  return module.app;
}

const args = parseArguments();
const findings = [];
const notices = [];

const app = await loadWorker();
// The meta routes touch no binding; anything they did touch would be a defect
// the fetch surfaces rather than hides.
const environment = { CACHE: {}, DB: {} };
const executionContext = { waitUntil() {}, passThroughOnException() {} };
const serve = (path) =>
  app.fetch(new Request(`https://marquee.stage11.dev${path}`), environment, executionContext);

// ---- served JSON -----------------------------------------------------------
const jsonResponse = await serve("/api/openapi.json");
if (jsonResponse.status !== 200) {
  findings.push({ code: "openapi-json-unreachable", status: jsonResponse.status });
}
const servedJson = await jsonResponse.text();
const servedDigest = createHash("sha256").update(servedJson, "utf8").digest("hex");
const servedEtag = jsonResponse.headers.get("etag");
if (servedEtag !== `"${servedDigest}"`) {
  findings.push({ code: "openapi-etag-mismatch", expected: `"${servedDigest}"`, actual: servedEtag });
}

let document = {};
try {
  document = JSON.parse(servedJson);
} catch (error) {
  findings.push({ code: "openapi-json-unparseable", detail: String(error) });
}

const validation = await validate(servedJson);
if (!validation.valid) {
  findings.push({ code: "openapi-invalid", errors: (validation.errors ?? []).slice(0, 10) });
}

const operations = Object.entries(document.paths ?? {}).flatMap(([path, methods]) =>
  Object.entries(methods).map(([method, operation]) => ({
    signature: `${method.toUpperCase()} ${path} ${operation.operationId}`,
    path,
    operationId: operation.operationId,
  })),
);
const signatures = operations.map((operation) => operation.signature).sort();

const duplicateSignatures = signatures.filter((value, index) => signatures[index - 1] === value);
if (duplicateSignatures.length > 0) {
  findings.push({ code: "duplicate-operations", signatures: [...new Set(duplicateSignatures)] });
}
const missingOperationId = operations.filter((operation) => !operation.operationId);
if (missingOperationId.length > 0) {
  findings.push({ code: "operation-without-id", paths: missingOperationId.map((each) => each.path) });
}

// ---- the SPEC §4.2 allowlist ----------------------------------------------
const allowed = new Set([...SPEC_4_2_ALLOWLIST, ...META_ALLOWLIST]);
const drift = [...new Set(operations.map((operation) => operation.path))].filter(
  (path) => !path.startsWith(VERSIONED_PREFIX) && !allowed.has(path),
);
if (drift.length > 0) findings.push({ code: "unversioned-path-drift", paths: drift });

// ---- rendered docs ---------------------------------------------------------
const docsResponse = await serve("/api/docs");
if (docsResponse.status !== 200) {
  findings.push({ code: "docs-unreachable", status: docsResponse.status });
}
if (!(docsResponse.headers.get("content-type") ?? "").includes("text/html")) {
  findings.push({ code: "docs-not-html", contentType: docsResponse.headers.get("content-type") });
}
const docsHtml = await docsResponse.text();
const renderedDigest = /name="marquee-openapi-sha256" content="([0-9a-f]{64})"/.exec(docsHtml)?.[1];
if (renderedDigest !== servedDigest) {
  findings.push({ code: "docs-document-hash-mismatch", served: servedDigest, rendered: renderedDigest });
}
const renderedCount = Number(
  /name="marquee-openapi-operations" content="(\d+)"/.exec(docsHtml)?.[1] ?? -1,
);
if (renderedCount !== operations.length) {
  findings.push({ code: "docs-operation-count-mismatch", served: operations.length, rendered: renderedCount });
}
// R8: the docs shell must work in a clean self-host container with no public network.
if (/<script/i.test(docsHtml) || /(?:src|href)="https?:\/\//i.test(docsHtml)) {
  findings.push({ code: "docs-external-dependency" });
}

// ---- CLI registry (activates with cli/) ------------------------------------
const cliDirectory = resolve(REPOSITORY_ROOT, "cli");
const cliExists = await access(cliDirectory).then(
  () => true,
  () => false,
);
let cliRegistry = "skipped";
if (!cliExists) {
  cliRegistry = "skipped";
  const notice =
    "CLI-registry parity skipped: cli/ does not exist yet (M-38). The served-JSON/rendered-docs half above is live.";
  notices.push(notice);
  process.stdout.write(`[check:api] ${notice}\n`);
} else {
  const registryPath = resolve(cliDirectory, "api-registry.json");
  // The registry is a build artifact, not source: it is generated from the
  // served OpenAPI document and is deliberately not tracked in git. A tracked
  // copy conflicts on every concurrent branch — its documentSha256 changes
  // whenever any route does — which serialises an otherwise parallel fleet.
  // Generate it on demand instead. The build must already exist; pr-gate runs
  // the production build before this check.
  //
  // Regenerated whenever it is older than the bundle it describes, for the same
  // reason the bundle is rebuilt from source mtimes: an ignored artifact that
  // outlives a merge cannot be corrected by git, and the stale one reports every
  // route added in between as missing from a registry that would list them the
  // moment it was rewritten.
  const registryStat = await stat(registryPath).catch(() => null);
  const bundleStat = await stat(BUNDLE).catch(() => null);
  if (!registryStat || (bundleStat && bundleStat.mtimeMs > registryStat.mtimeMs)) {
    const generated = spawnSync(process.execPath, [resolve(cliDirectory, "generate-api-registry.mjs")], {
      cwd: REPOSITORY_ROOT,
      encoding: "utf8",
    });
    if (generated.status !== 0) {
      findings.push({ code: "cli-registry-ungeneratable", detail: generated.stderr?.trim() || "generator failed" });
    }
  }
  try {
    const registry = JSON.parse(
      await (await import("node:fs/promises")).readFile(registryPath, "utf8"),
    );
    cliRegistry = "checked";
    const registrySignatures = [...(registry.operations ?? [])].sort();
    const missing = signatures.filter((signature) => !registrySignatures.includes(signature));
    const extra = registrySignatures.filter((signature) => !signatures.includes(signature));
    if (missing.length > 0 || extra.length > 0) {
      findings.push({ code: "cli-registry-parity", missing, extra });
    }
    if (registry.documentSha256 && registry.documentSha256 !== servedDigest) {
      findings.push({
        code: "cli-registry-hash-mismatch",
        served: servedDigest,
        registry: registry.documentSha256,
      });
    }
  } catch (error) {
    cliRegistry = "failed";
    findings.push({ code: "cli-registry-unreadable", path: registryPath, detail: String(error) });
  }
}

const report = {
  command: "check:api",
  status: findings.length ? "fail" : "pass",
  openapiVersion: validation.version ?? null,
  documentSha256: servedDigest,
  operations: operations.length,
  signatures,
  halves: {
    servedJsonAndRenderedDocs: "live",
    cliRegistry,
  },
  allowlist: { spec4_2: SPEC_4_2_ALLOWLIST, meta: META_ALLOWLIST },
  notices,
  findings,
  // Named so nobody reads a pass here as full AC-105 coverage.
  notCoveredHere:
    "Full-loop network-recorded traffic parity (every captured non-GET request present in the schema) is MRQ-9.",
};

const reportPath = await writeReport("artifacts/checks/api.json", report);
emit({ ...report, report: reportPath });
if (findings.length > 0) process.exit(1);
if (args.strict && cliRegistry === "skipped") {
  process.stdout.write("[check:api] --strict: CLI registry is still absent\n");
  process.exit(2);
}
