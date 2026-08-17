import { env as rawEnv } from "cloudflare:test";

const migrationModules = import.meta.glob("../../migrations/*.sql", {
  eager: true,
  import: "default",
  query: "?raw",
}) as Record<string, string>;

// The glob is sorted explicitly to match Wrangler's lexical migration order.
// Duplicate numeric prefixes (0020 does) are therefore deterministic even when
// their names are added by separate branches.
const migrationEntries = Object.entries(migrationModules)
  .sort(([left], [right]) => left.localeCompare(right));
const migrationSql = migrationEntries.map(([, sql]) => sql);
const migrationByName = new Map(
  migrationEntries.map(([path, sql]) => [path.split("/").at(-1), sql]),
);
import type { Env } from "../../src/index";
import { WIPE_ORDER } from "../../src/lib/reset-demo/reseed-demo";

export const env = rawEnv as unknown as Env;

/**
 * D1's `exec()` splits on bare newlines, which breaks on this file's
 * multi-line `CREATE TABLE` statements — so each top-level statement (every
 * one of which ends its own line with `;` in this migration) is run
 * individually via `prepare().run()` instead. `CREATE TRIGGER … BEGIN … END;`
 * bodies contain their own internal `;\n`-terminated statements, so chunks
 * that open a `BEGIN` without a matching `END` are re-merged with whatever
 * follows until the trigger's `END` closes them.
 */
function splitStatements(sql: string): string[] {
  const chunks = sql
    .split(/;\s*\n/g)
    .map((statement) => statement.trim())
    .filter(Boolean);
  const statements: string[] = [];
  let pending: string | null = null;
  for (const chunk of chunks) {
    if (pending !== null) {
      pending = `${pending};\n${chunk}`;
      if (/\bEND\b/.test(chunk)) {
        statements.push(pending);
        pending = null;
      }
      continue;
    }
    if (/\bBEGIN\b/.test(chunk) && !/\bEND\b/.test(chunk)) {
      pending = chunk;
      continue;
    }
    statements.push(chunk);
  }
  if (pending !== null) statements.push(pending);
  return statements;
}

async function applyMigration(name: string): Promise<void> {
  const sql = migrationByName.get(name);
  if (sql === undefined) throw new Error(`Missing migration source for ${name}`);
  for (const statement of splitStatements(sql)) {
    await env.DB.prepare(`${statement};`).run();
  }
}

/**
 * Storage persists across `test()` calls within a file (isolatedStorage only
 * scopes to request/queue entry points, not raw `env.DB` access from the test
 * body). The D1 authorizer used here rejects `DROP TABLE`, so on every call
 * after the first, wipe rows (same FK-safe order the reseed uses) instead of
 * dropping and recreating the schema.
 */
export async function applyMigrations(): Promise<void> {
  const alreadyApplied = await env.DB.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'organizations'",
  ).first();
  if (alreadyApplied) {
    const requestOperationsApplied = await env.DB.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'request_operations'",
    ).first();
    const calendarTruthApplied = await env.DB.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'calendar_cancellations'",
    ).first();
    const calendarBatchPartsApplied = await env.DB.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'outbox_calendar_parts'",
    ).first();
    const personAliasesMergesApplied = await env.DB.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'person_aliases'",
    ).first();
    const modelUsageEventsApplied = await env.DB.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'model_usage_events'",
    ).first();
    const fieldLibraryApplied = await env.DB.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'field_library'",
    ).first();
    const existingTables = new Set((await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table'",
    ).all<{ name: string }>()).results.map((row) => row.name));
    // Disable mirror triggers before the wipe reaches people. WIPE_ORDER
    // removes pending rows before deleting those parents; clearing state first
    // prevents the delete itself from re-enqueuing a stale people tombstone.
    await env.DB.prepare("DELETE FROM mirror_state").run();
    await env.DB.batch([
      env.DB.prepare("UPDATE people SET headshot_attachment_id = NULL"),
      env.DB.prepare("DELETE FROM attachments WHERE owner_type = 'person_headshot'"),
      ...WIPE_ORDER
        .filter((table) => existingTables.has(table))
        .map((table) => env.DB.prepare(`DELETE FROM ${table}`)),
    ]);
    if (calendarTruthApplied) {
      // WIPE_ORDER already clears both calendar tables for test isolation.
      // Production reset deliberately preserves the ledger through its null
      // DELETE_PLANS entry; this helper is intentionally a different path.
    } else {
      await applyMigration("0026_calendar_truth.sql");
    }
    if (!calendarBatchPartsApplied) {
      await applyMigration("0032_calendar_batch_parts.sql");
    }
    if (!fieldLibraryApplied) {
      await applyMigration("0033_field_library.sql");
    }
    if (!requestOperationsApplied) {
      await applyMigration("0034_request_operations.sql");
    }
    if (!personAliasesMergesApplied) {
      await applyMigration("0035_person_aliases_merges.sql");
    }
    if (!modelUsageEventsApplied) {
      await applyMigration("0038_model_usage_events.sql");
    }
    return;
  }
  for (const statement of migrationSql.flatMap(splitStatements)) {
    await env.DB.prepare(`${statement};`).run();
  }
}
