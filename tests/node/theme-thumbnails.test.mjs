import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import test from "node:test";

// The landing promises a real preview of every theme. A card whose image 404s
// is a broken promise on the first screen a judge sees, so the shipped files
// are asserted here — against the registry, not a copied list, so a new theme
// fails this test until its thumbnail is captured
// (node scripts/capture-theme-thumbnails.mjs).
const registry = readFileSync(new URL("../../src/ui/shell/theme.ts", import.meta.url), "utf8");
const ids = [...registry.matchAll(/\{ id: "([a-z-]+)", label/g)].map((match) => match[1]);

test("CONTRACT · every registered theme ships a landing thumbnail", () => {
  assert.ok(ids.length >= 5, `theme registry parse found only ${ids.length} themes`);
  for (const id of ids) {
    const path = new URL(`../../public/themes/${id}.webp`, import.meta.url);
    const stats = statSync(path);
    // A truncated capture encodes to almost nothing; a real screen does not.
    assert.ok(stats.size > 5_000, `${id}.webp is ${stats.size} bytes — looks like a broken capture`);
  }
});
