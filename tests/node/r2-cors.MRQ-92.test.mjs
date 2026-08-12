import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "../..");
const policyPath = resolve(root, "code/platform/r2-cors.json");
const applyPath = resolve(root, "scripts/platform/apply-r2-cors.mjs");
const checkPath = resolve(root, "scripts/checks/check-r2-cors.mjs");
const e2ePath = resolve(root, "scripts/checks/run-e2e.mjs");
const portalPath = resolve(root, "src/ui/portal/PortalPage.tsx");

test("CONTRACT · the reviewed R2 policy names real origins and browser upload requirements", () => {
  const source = readFileSync(policyPath, "utf8");
  const policy = JSON.parse(source);
  const rule = policy.rules[0];

  assert.equal(policy.rules.length, 1);
  assert.deepEqual(rule.allowed.origins, [
    "https://marquee.stage11.dev",
    "http://127.0.0.1:8787",
    "http://localhost:8787",
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

  assert.match(portal, /console\.error\("Speaker upload failed", caught\)/);
  assert.match(portal, /speakerUploadFailureMessage\(caught\)/);
  assert.match(portal, /Retry upload/);
  assert.doesNotMatch(portal, /upload PUT network error/);
});
