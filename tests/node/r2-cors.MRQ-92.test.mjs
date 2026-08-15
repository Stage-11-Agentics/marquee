import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "../..");
const policyPath = resolve(root, "scripts/platform/r2-cors.json");
const applyPath = resolve(root, "scripts/platform/apply-r2-cors.mjs");
const checkPath = resolve(root, "scripts/checks/check-r2-cors.mjs");
const e2ePath = resolve(root, "scripts/checks/run-e2e.mjs");
// Browser-upload behaviour lives in the extracted task machinery, shared by the
// speaker and sponsor portals.
const portalPath = resolve(root, "src/ui/portal/task-machinery.tsx");

test("CONTRACT · the reviewed R2 policy names real origins and browser upload requirements", () => {
  const source = readFileSync(policyPath, "utf8");
  const policy = JSON.parse(source);
  const rule = policy.rules[0];

  assert.equal(policy.rules.length, 1);
  assert.deepEqual(rule.allowed.origins, [
    "https://marquee.stage11.dev",
  ]);
  assert.deepEqual(rule.allowed.methods, ["PUT"]);
  assert.deepEqual(rule.allowed.headers, ["content-type", "if-none-match"]);
  assert.deepEqual(rule.exposeHeaders, ["etag"]);
  assert.equal(rule.maxAgeSeconds, 3600);
  assert.doesNotMatch(source, /\*/);
});

test("CONTRACT · applying R2 CORS is environment-only, bucket-scoped, and idempotent", () => {
  const source = readFileSync(applyPath, "utf8");

  assert.match(source, /CLOUDFLARE_API_TOKEN/);
  assert.match(source, /CLOUDFLARE_ACCOUNT_ID/);
  assert.match(source, /r2.*bucket.*cors.*set/);
  assert.match(source, /--force/);
  assert.match(source, /marquee-media-preview/);
  assert.doesNotMatch(source, /CLOUDFLARE_API_TOKEN\s*[:=]\s*["']/);
});

test("CONTRACT · the deployed check proves the production preflight and rejects a wrong origin", () => {
  const source = readFileSync(checkPath, "utf8");
  const e2e = readFileSync(e2ePath, "utf8");

  assert.match(source, /method: "OPTIONS"/);
  assert.match(source, /Access-Control-Request-Method.*PUT/);
  assert.match(source, /content-type,if-none-match/);
  assert.match(source, /access-control-allow-origin/);
  assert.match(source, /not-allowed\.example/);
  assert.match(e2e, /check-r2-cors\.mjs/);
});

test("CONTRACT · speaker upload transport failures keep diagnostics and show retry copy", () => {
  const portal = readFileSync(portalPath, "utf8");
  const uploadClient = readFileSync(resolve(root, "src/ui/upload/upload-client.ts"), "utf8");

  // "Portal upload failed": the machinery is shared with the sponsor portal, so
  // the log line names the surface honestly. The contract is that the caught
  // error still reaches the console, not which noun labels it.
  assert.match(portal, /console\.error\("Portal upload failed", caught\)/);
  assert.match(portal, /speakerUploadFailureMessage\(caught(?:,|\))/);
  assert.match(portal, /isUploadAborted\(caught\)/);
  assert.match(uploadClient, /UPLOAD_PUT_NETWORK_ERROR/);
  assert.match(portal, /Retry upload/);
  assert.doesNotMatch(portal, /upload PUT network error/);
});

test("CONTRACT · MRQ-177 · stalled and canceled replacements state the saved version and never fake byte progress", () => {
  const portal = readFileSync(portalPath, "utf8");
  const uploadClient = readFileSync(resolve(root, "src/ui/upload/upload-client.ts"), "utf8");

  assert.match(uploadClient, /xhr\.timeout = UPLOAD_PUT_TIMEOUT_MS/);
  assert.match(uploadClient, /UPLOAD_PUT_TIMED_OUT/);
  assert.match(portal, /speakerUploadAbortedMessage\(hasPreviousVersion\)/);
  assert.match(portal, /state: "failed"/);
  assert.match(portal, /Upload stopped/);
  assert.match(portal, /Previous version kept/);
  assert.match(portal, /progress\.loaded === null/);
  assert.doesNotMatch(portal, /setProgress\(\{ loaded: 0/);
  assert.match(portal, /Your previous version is still current/);
  assert.match(portal, /await onComplete\(\)/);
});
