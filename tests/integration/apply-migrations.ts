import { env as rawEnv } from "cloudflare:test";

import migrationSql from "../../migrations/0001_init.sql?raw";
import venueGeographyMigrationSql from "../../migrations/0002_venue_geography.sql?raw";
import venueAccessNoteMigrationSql from "../../migrations/0003_building_access_note.sql?raw";
import calendarReversalMigrationSql from "../../migrations/0004_calendar_reversal.sql?raw";
import taskCancellationWebhooksMigrationSql from "../../migrations/0005_task_cancellation_webhooks.sql?raw";
import auditRequestIdMigrationSql from "../../migrations/0006_audit_log_request_id.sql?raw";
import embedWidgetKindsMigrationSql from "../../migrations/0007_embed_widget_kinds.sql?raw";
import formFieldDatesMigrationSql from "../../migrations/0008_form_field_dates.sql?raw";
import fileCommentsMigrationSql from "../../migrations/0009_file_comments.sql?raw";
import criterionKindsMigrationSql from "../../migrations/0009_criterion_kinds.sql?raw";
import boundFormOptionsMigrationSql from "../../migrations/0010_bound_form_options.sql?raw";
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
    await env.DB.batch(
      WIPE_ORDER.map((table) => env.DB.prepare(`DELETE FROM ${table}`)),
    );
    return;
  }
  for (const statement of [
    ...splitStatements(migrationSql),
    ...splitStatements(venueGeographyMigrationSql),
    ...splitStatements(venueAccessNoteMigrationSql),
    ...splitStatements(calendarReversalMigrationSql),
    ...splitStatements(taskCancellationWebhooksMigrationSql),
    ...splitStatements(auditRequestIdMigrationSql),
    ...splitStatements(embedWidgetKindsMigrationSql),
    ...splitStatements(formFieldDatesMigrationSql),
    ...splitStatements(fileCommentsMigrationSql),
    ...splitStatements(criterionKindsMigrationSql),
    ...splitStatements(boundFormOptionsMigrationSql),
  ]) {
    await env.DB.prepare(`${statement};`).run();
  }
}
