import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "../..");

test("AC-128 · AC-131 · AC-250 · the communications surface has stable templates, preview, audience, and outbox sections", async () => {
  const source = await readFile(resolve(root, "src/ui/comms/CommsScreen.tsx"), "utf8");
  assert.match(source, /aria-labelledby="comms-templates-heading"/);
  assert.match(source, /aria-labelledby="comms-preview-heading"/);
  assert.match(source, /aria-labelledby="comms-outbox-heading"/);
  assert.match(source, /comms\/audience/);
  assert.match(source, /comms\/preview/);
  assert.match(source, /comms\/send/);
  assert.match(source, /demo_safe/);
  assert.match(source, /conference/);
  assert.match(source, /MERGE_FIELDS/);
  assert.doesNotMatch(source, /messages\/send/);
});
