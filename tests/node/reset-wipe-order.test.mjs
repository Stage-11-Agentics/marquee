import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "../..");

/**
 * Replays each migration's DDL in order rather than just collecting every
 * `CREATE TABLE` — a CHECK-constraint widen has no `ALTER`, so SQLite's own
 * documented workaround is create-a-new-table/copy/drop-old/rename
 * (migrations/0007_embed_widget_kinds.sql). That leaves a transient name
 * (`embeds_new`) that is never a table in the final schema; a naive collector
 * would demand `WIPE_ORDER` cover a name `reset:demo` will never see.
 */
async function migrationTables() {
  const files = (await readdir(resolve(root, "migrations")))
    .filter((file) => file.endsWith(".sql"))
    .sort();
  const created = [];
  const existing = new Set();
  const ddl = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z_][A-Za-z0-9_]*)|DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([A-Za-z_][A-Za-z0-9_]*)|ALTER\s+TABLE\s+([A-Za-z_][A-Za-z0-9_]*)\s+RENAME\s+TO\s+([A-Za-z_][A-Za-z0-9_]*)/gi;
  for (const file of files) {
    const source = await readFile(resolve(root, "migrations", file), "utf8");
    for (const match of source.matchAll(ddl)) {
      if (match[1]) {
        created.push(match[1]);
        existing.add(match[1]);
      } else if (match[2]) {
        existing.delete(match[2]);
      } else if (match[3] && match[4]) {
        existing.delete(match[3]);
        existing.add(match[4]);
      }
    }
  }
  return { created, existing: [...existing] };
}

async function wipeOrder() {
  const source = await readFile(resolve(root, "src/lib/reset-demo/reseed-demo.ts"), "utf8");
  const match = source.match(/export const WIPE_ORDER\s*=\s*\[([\s\S]*?)\]\s*as const/);
  assert.ok(match, "reseed-demo.ts must expose a parseable WIPE_ORDER");
  return [...match[1].matchAll(/"([A-Za-z_][A-Za-z0-9_]*)"/g)].map((entry) => entry[1]);
}

test("CONTRACT · WIPE_ORDER covers every table defined by every migration", async () => {
  const { created, existing } = await migrationTables();
  const wipeTables = await wipeOrder();
  const schemaSet = new Set(existing);
  const wipeSet = new Set(wipeTables);

  assert.equal(created.length, new Set(created).size, `duplicate schema table definitions: ${created.join(", ")}`);
  assert.equal(wipeTables.length, wipeSet.size, `duplicate WIPE_ORDER entries: ${wipeTables.join(", ")}`);
  assert.deepEqual(
    [...wipeSet].sort(),
    [...schemaSet].sort(),
    `reset table coverage drifted; missing=${JSON.stringify([...schemaSet].filter((table) => !wipeSet.has(table)).sort())} stale=${JSON.stringify([...wipeSet].filter((table) => !schemaSet.has(table)).sort())}`,
  );
});
