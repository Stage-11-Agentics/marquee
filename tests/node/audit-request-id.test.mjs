import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const url = (path) => new URL(`../../${path}`, import.meta.url);
const migration = await readFile(url("migrations/0006_audit_log_request_id.sql"), "utf8");
const initMigration = await readFile(url("migrations/0001_init.sql"), "utf8");
const auditSource = await readFile(url("src/lib/audit.ts"), "utf8");
const schemaSource = await readFile(url("src/db/schema.ts"), "utf8");
const applyMigrations = await readFile(url("tests/integration/apply-migrations.ts"), "utf8");

test("CONTRACT · the correlation column is additive and nullable, and earlier migrations stay immutable", () => {
  assert.match(migration, /^ALTER TABLE audit_log ADD COLUMN request_id TEXT;$/m);
  // Nullable by necessity: pre-existing rows have no request, and a cron sweep
  // has no inbound request at all. NOT NULL here would fail on every fresh D1.
  assert.doesNotMatch(migration, /request_id TEXT NOT NULL/);
  assert.doesNotMatch(initMigration, /request_id/);
  assert.match(migration, /CREATE INDEX idx_audit_request ON audit_log\(request_id, created_at\)/);
});

test("CONTRACT · the migration is registered with the test applier, or every integration test runs on a stale schema", () => {
  assert.match(applyMigrations, /0006_audit_log_request_id\.sql\?raw/);
  assert.match(applyMigrations, /splitStatements\(auditRequestIdMigrationSql\)/);
  const registered = applyMigrations.indexOf("auditRequestIdMigrationSql)");
  const previous = applyMigrations.indexOf("taskCancellationWebhooksMigrationSql)");
  assert.ok(previous >= 0 && registered > previous, "0006 must apply after 0005");
});

test("CONTRACT · schema.ts mirrors the column so a reader cannot silently drop it", () => {
  assert.match(schemaSource, /request_id: string \| null;/);
});

test("CONTRACT · audit_log has exactly one writer", async () => {
  // The column existed nowhere for so long precisely because seven hand-written
  // INSERTs each had to be found and edited. One writer is what keeps the next
  // field from going missing the same way.
  const roots = ["src"];
  const offenders = [];
  while (roots.length) {
    const directory = roots.pop();
    for (const entry of await readdir(url(directory), { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) roots.push(path);
      else if (/\.tsx?$/.test(entry.name) && path !== "src/lib/audit.ts") {
        if (/INSERT INTO audit_log/.test(await readFile(url(path), "utf8"))) offenders.push(path);
      }
    }
  }
  assert.deepEqual(offenders, [], "audit rows must be written through src/lib/audit.ts");
});

test("CONTRACT · the writer binds the request id and uses a sortable id", () => {
  assert.match(auditSource, /request_id\)/, "the column list must carry request_id");
  assert.match(auditSource, /entry\.requestId,/, "the value must actually be bound");
  // Audit history paginates on a stable secondary sort by id; two call sites
  // previously used crypto.randomUUID() here and broke that ordering.
  assert.match(auditSource, /newUlid\(entry\.now\)/);
  assert.doesNotMatch(auditSource, /crypto\.randomUUID/);
});
