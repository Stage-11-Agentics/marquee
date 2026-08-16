import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readme = await readFile(new URL("../../README.md", import.meta.url), "utf8");

test("AC-160 · the README exposes a numbered clean-checkout deploy path", () => {
  assert.match(readme, /### 1\. Install the checkout/);
  assert.match(readme, /### 2\. Build the Worker and prepare local D1/);
  assert.match(readme, /### 3\. Start the local Worker for development/);
  assert.match(readme, /### 4\. Verify health and seeded data/);
  assert.match(readme, /npm ci/);
  assert.match(readme, /npx vite build/);
  assert.match(readme, /wrangler d1 migrations apply DB --local/);
  assert.match(readme, /npm run seed -- --persist-to/);
  assert.match(readme, /wrangler dev/);
  assert.match(readme, /curl -fsS http:\/\/127\.0\.0\.1:8787\/health/);
  assert.match(readme, /MARQUEE_EVENT_ID/);
  assert.match(readme, /api\/v1\/events\/\$\{event_id\}\/submissions/);
  // This guard used to assert the README said the hosted path was "not covered
  // in this checkout". That sentence became false the day we deployed, and a
  // reader who believed it never opened the running site. The honest form of
  // the same guard is the opposite one: the README must name the deployment and
  // route the reader to the sequence that produced it.
  assert.match(readme, /marquee\.stage11\.dev/);
  assert.match(readme, /\[Deploy to Cloudflare\]\(#deploy-to-cloudflare\)/);
  assert.doesNotMatch(readme, /\bMRQ-\d+\b/);
  assert.match(readme, /\/api\/docs/);
  assert.match(readme, /named bearer tokens/);
  assert.match(readme, /Signed outbound webhook endpoints are defined/);
});

test("AC-161 · the README names the empty-install next action", () => {
  assert.match(readme, /## Empty installs and seeded installs/);
  assert.match(readme, /empty database is a supported starting state/);
  assert.match(readme, /empty state and next action/);
  assert.match(readme, /no demo conference\s+is configured/);
});

test("AC-162 · the README names real seams and all three integration extensions", () => {
  for (const path of [
    "src/lib/form-conditions.ts",
    "src/jobs/cascade/decisions.ts",
    "src/jobs/mail/outbox.ts",
    "src/routes/_manifest.ts",
    "src/lib/venue-geometry.ts",
  ]) assert.match(readme, new RegExp(path.replaceAll(".", "\\.")));
  assert.match(readme, /registration-platform sync/);
  assert.match(readme, /Airtable mirror/);
  assert.match(readme, /calendar OAuth/);
  assert.match(readme, /bundled fixture/);
});
