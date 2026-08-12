import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../../src/ui/app.tsx", import.meta.url), "utf8");
const shell = readFileSync(new URL("../../src/ui/shell/AppShell.tsx", import.meta.url), "utf8");
const health = readFileSync(new URL("../../src/ui/health/DeliveryHealthShell.tsx", import.meta.url), "utf8");
const identity = readFileSync(new URL("../../src/ui/shell/identity.tsx", import.meta.url), "utf8");
const settings = readFileSync(new URL("../../src/ui/settings/EventSettings.tsx", import.meta.url), "utf8");
const auth = readFileSync(new URL("../../src/routes/auth.routes.ts", import.meta.url), "utf8");
const landing = readFileSync(new URL("../../src/routes/landing.route.tsx", import.meta.url), "utf8");
const seed = readFileSync(new URL("../../scripts/seed/event.ts", import.meta.url), "utf8");

test("CFP-03 · both shells receive a required API-backed event name", () => {
  assert.match(app, /useEventName\(\)/);
  assert.match(app, /<AppShell eventName=\{eventName\} \/>/);
  assert.match(app, /<DeliveryHealthShell eventName=\{eventName\} \/>/);
  assert.match(shell, /\{ eventName \}: \{ eventName: string \}/);
  assert.match(health, /\{ eventName: string; eventId\?: string \}/);
  assert.match(identity, /demo_event_name\?: string \| null/);
  assert.match(auth, /demo_event_name: z\.string\(\)\.nullable\(\)/);
  assert.match(identity, /EVENT_NAME_CHANGED/);
  assert.match(settings, /dispatchEvent\(new CustomEvent\(EVENT_NAME_CHANGED/);
  assert.doesNotMatch(shell, /AIE NYC/);
  assert.doesNotMatch(health, /AIE NYC/);
});

test("CFP-03 · landing copy and seed vocabulary are truthful", () => {
  assert.match(landing, /data\.conferenceName/);
  assert.doesNotMatch(landing, /Built for AIE NYC|populated AIE NYC/);
  assert.match(seed, /name: "Call for Speakers"/);
  assert.doesNotMatch(seed, /name: "2026 CFP"/);
});
