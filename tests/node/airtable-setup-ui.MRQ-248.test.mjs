import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../../src/ui/settings/AirtablePage.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../../src/ui/settings/airtable.css", import.meta.url), "utf8");
const route = await readFile(new URL("../../src/routes/mirror.routes.ts", import.meta.url), "utf8");

test("MRQ-248 · the Airtable setup report reserves three stable rows through completion", () => {
  assert.match(page, /function idleProgress[\s\S]*TABLE_ORDER\.map/);
  assert.match(page, /export function AirtableSetupProgress[\s\S]*TABLE_ORDER\.map/);
  assert.match(page, /!setupActive && progress\.length > 0[\s\S]*Mirror setup report/);
  assert.match(page, /Create the three tables for me/);
  assert.match(page, /added \$\{createdFields\.join\(", "\)\}/);
  assert.match(page, /kept \$\{organizerCount\} organizer column/);
  assert.match(css, /\.airtable-setup-progress-row[^}]*min-height: 54px/);
});

test("MRQ-248 · the API boundary preserves an unknown provider schema as null", () => {
  assert.match(route, /fields: z\.array\(airtableField\)\.nullable\(\)/);
  assert.match(route, /fields: table\.fields === undefined \? null : \[\.\.\.table\.fields\]/);
});
