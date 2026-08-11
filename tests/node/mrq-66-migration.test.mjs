import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(new URL("../../migrations/0005_task_cancellation_webhooks.sql", import.meta.url), "utf8");
const initMigration = await readFile(new URL("../../migrations/0001_init.sql", import.meta.url), "utf8");
const reversalMigration = await readFile(new URL("../../migrations/0004_calendar_reversal.sql", import.meta.url), "utf8");
const wipeSource = await readFile(new URL("../../src/lib/reset-demo/reseed-demo.ts", import.meta.url), "utf8");

const webhookEvents = [
  "submission.created",
  "submission.status_changed",
  "evaluation.completed",
  "speaker_task.completed",
  "agenda.published",
  "speaker.confirmed",
];

test("CONTRACT · MRQ-66 preserves the cancellation tombstone and keeps task status open or done", () => {
  assert.match(reversalMigration, /^ALTER TABLE speaker_tasks ADD COLUMN cancelled_at INTEGER;$/m);
  assert.doesNotMatch(migration, /ALTER TABLE speaker_tasks ADD COLUMN cancelled_at/);
  assert.doesNotMatch(migration, /ALTER TABLE speaker_tasks ADD COLUMN status/);
  assert.doesNotMatch(migration, /'cancelled'/);
  assert.match(initMigration, /status TEXT NOT NULL DEFAULT 'open' CHECK \(status IN \('open', 'done'\)\)/);
  assert.match(migration, /CREATE TABLE webhook_endpoints \(/);
  assert.match(migration, /CREATE TABLE webhook_deliveries \(/);
  assert.match(migration, /CREATE INDEX idx_webhook_deliveries_endpoint_created\s+ON webhook_deliveries\(endpoint_id, created_at\)/);
});

test("CONTRACT · webhook persistence carries the ratified six-event subset and reset deletes children first", () => {
  for (const event of webhookEvents) assert.match(migration, new RegExp(event.replaceAll(".", "\\.")));
  assert.match(migration, /events_json TEXT NOT NULL CHECK \([\s\S]*json_valid\(events_json\)[\s\S]*json_type\(events_json\) = 'array'[\s\S]*json_array_length\(events_json\) <= 6/);
  assert.match(migration, /event_type TEXT NOT NULL CHECK \(event_type IN \([\s\S]*'speaker\.confirmed'[\s\S]*\)\)/);
  assert.match(migration, /status TEXT NOT NULL CHECK \(status IN \('queued', 'delivered', 'failed'\)\)/);
  assert.match(migration, /url TEXT NOT NULL CHECK \(url LIKE 'https:\/\/%'\)/);

  const deliveryPosition = wipeSource.indexOf('"webhook_deliveries"');
  const endpointPosition = wipeSource.indexOf('"webhook_endpoints"');
  const eventsPosition = wipeSource.indexOf('"events"');
  assert.ok(deliveryPosition >= 0, "reset order must include webhook deliveries");
  assert.ok(endpointPosition >= 0, "reset order must include webhook endpoints");
  assert.ok(eventsPosition >= 0, "reset order must include events");
  assert.ok(deliveryPosition < endpointPosition, "webhook deliveries must be wiped before endpoints");
  assert.ok(endpointPosition < eventsPosition, "webhook endpoints must be wiped before events");
});
