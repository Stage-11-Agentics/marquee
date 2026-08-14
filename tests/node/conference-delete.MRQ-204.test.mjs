import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";

const root = resolve(import.meta.dirname, "../..");
const source = (path) => readFile(resolve(root, path), "utf8");

test("AC-307 · CLI and remove-demo use the one conference-deletion primitive", async () => {
  const [cli, registry, skill, removeDemo, cascade] = await Promise.all([
    source("cli/marquee.mjs"),
    source("cli/registry.mjs"),
    source("SKILL.md"),
    source("src/lib/reset-demo/remove-demo.ts"),
    source("src/lib/events/delete-event.ts"),
  ]);
  assert.match(cli, /client\.remove\(`\/api\/v1\/events\/\$\{encodeURIComponent\(eventId\)\}`\)/);
  assert.match(registry, /path: \["event", "delete"\][\s\S]*operations: \["deleteEvent"\]/);
  assert.match(skill, /node cli\/marquee\.mjs event delete <event-id>/);
  assert.match(removeDemo, /deleteEventCascade/);
  assert.doesNotMatch(removeDemo, /REMOVE_DEMO_STATEMENTS/);
  assert.match(cascade, /export async function deleteEventCascade/);
});
