import assert from "node:assert/strict";
import { test } from "node:test";

import {
  formatLine,
  matchesFilters,
  renderDiagnosticBundle,
  structuredLinesFrom,
} from "../../cli/diagnostics.mjs";

const line = (overrides = {}) => ({
  ts: "2026-08-11T12:00:00.000Z",
  level: "info",
  event: "http_request",
  schema_version: 1,
  request_id: "8f2a4c90-5f0b-4b1e-9d2a-9b1d2f0a1c2d",
  method: "GET",
  route: "/api/v1/events/{eventId}/dashboard",
  status: 200,
  duration_ms: 12,
  ...overrides,
});

test("CONTRACT · the reference code an organizer reads off the screen finds the line", () => {
  // Six characters, exactly as the banner shows them.
  assert.ok(matchesFilters(line(), { requestId: "8f2a4c" }));
  assert.ok(matchesFilters(line(), { requestId: "8f2a4c90-5f0b-4b1e-9d2a-9b1d2f0a1c2d" }));
  assert.ok(!matchesFilters(line(), { requestId: "deadbe" }));
});

test("CONTRACT · a level filter means that level and everything above it", () => {
  assert.ok(matchesFilters(line({ level: "error" }), { level: "warn" }));
  assert.ok(matchesFilters(line({ level: "warn" }), { level: "warn" }));
  assert.ok(!matchesFilters(line({ level: "info" }), { level: "warn" }));
  assert.ok(!matchesFilters(line(), { level: "nonsense" }));
});

test("CONTRACT · an event filter is exact", () => {
  assert.ok(matchesFilters(line(), { event: "http_request" }));
  assert.ok(!matchesFilters(line(), { event: "api_error" }));
});

test("CONTRACT · only our structured lines are pulled out of the raw stream", () => {
  const found = structuredLinesFrom({
    logs: [
      { message: [JSON.stringify(line())] },
      { message: ["a plain string a dependency printed"] },
      { message: [JSON.stringify({ hello: "world" })] },
      { message: [JSON.stringify(line({ event: "api_error", level: "error" }))] },
    ],
  });
  assert.equal(found.length, 2);
  assert.deepEqual(found.map((each) => each.event), ["http_request", "api_error"]);
});

test("CONTRACT · a malformed stream never crashes the reader", () => {
  assert.deepEqual(structuredLinesFrom(undefined), []);
  assert.deepEqual(structuredLinesFrom({ logs: [{ message: ["{not json"] }, { message: [7] }] }), []);
});

test("CONTRACT · a formatted line leads with time, level and correlation id", () => {
  const rendered = formatLine(line({ level: "error", event: "api_error", code: "internal_error", d1_queries: 41 }));
  assert.match(rendered, /^2026-08-11T12:00:00\.000Z ERROR 8f2a4c90 api_error /);
  assert.match(rendered, /41q/);
  assert.match(rendered, /internal_error/);
});

test("CONTRACT · the diagnostic bundle names the failing binding and any stale trigger", () => {
  const bundle = renderDiagnosticBundle({
    status: "degraded",
    build: { sha: "abc123def456", built_at: "2026-08-11T00:00:00.000Z" },
    migration: "0005_task_cancellation_webhooks.sql",
    checked_at: "2026-08-11T12:00:00.000Z",
    probes: [
      { name: "d1", ok: true, duration_ms: 3 },
      { name: "r2", ok: false, duration_ms: 120, detail: "bucket not reachable" },
    ],
    crons: [
      { cron: "0 * * * *", last_success_at: 1, age_ms: 600_000, stale: false },
      { cron: "30 4 * * *", last_success_at: 0, age_ms: 0, stale: true },
    ],
  });
  assert.match(bundle, /Verdict: \*\*degraded\*\*/);
  assert.match(bundle, /r2: FAILED \(120ms\) — bucket not reachable/);
  assert.match(bundle, /never run.*STALE/);
  assert.match(bundle, /abc123def456/);
});
