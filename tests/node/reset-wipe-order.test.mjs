import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "../..");

async function migrationTables() {
  const files = (await readdir(resolve(root, "migrations")))
    .filter((file) => file.endsWith(".sql"))
    .sort();
  const tables = [];
  for (const file of files) {
    const source = await readFile(resolve(root, "migrations", file), "utf8");
    for (const match of source.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z_][A-Za-z0-9_]*)/gi)) {
      tables.push(match[1]);
    }
  }
  return tables;
}

async function wipeOrder() {
  const source = await readFile(resolve(root, "src/lib/reset-demo/reseed-demo.ts"), "utf8");
  const match = source.match(/export const WIPE_ORDER\s*=\s*\[([\s\S]*?)\]\s*as const/);
  assert.ok(match, "reseed-demo.ts must expose a parseable WIPE_ORDER");
  return [...match[1].matchAll(/"([A-Za-z_][A-Za-z0-9_]*)"/g)].map((entry) => entry[1]);
}

test("CONTRACT · WIPE_ORDER covers every table defined by every migration", async () => {
  const schemaTables = await migrationTables();
  const wipeTables = await wipeOrder();
  const schemaSet = new Set(schemaTables);
  const wipeSet = new Set(wipeTables);

  assert.equal(schemaTables.length, schemaSet.size, `duplicate schema table definitions: ${schemaTables.join(", ")}`);
  assert.equal(wipeTables.length, wipeSet.size, `duplicate WIPE_ORDER entries: ${wipeTables.join(", ")}`);
  assert.deepEqual(
    [...wipeSet].sort(),
    [...schemaSet].sort(),
    `reset table coverage drifted; missing=${JSON.stringify([...schemaSet].filter((table) => !wipeSet.has(table)).sort())} stale=${JSON.stringify([...wipeSet].filter((table) => !schemaSet.has(table)).sort())}`,
  );
});
