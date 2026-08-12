import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const styles = readFileSync(new URL("../../src/styles/themes/latent-space.css", import.meta.url), "utf8");
const controls = styles.match(/\/\* ── native controls[\s\S]*?(?=\/\* ── chrome)/)?.[0] ?? "";

test("CONTRACT · MRQ-158 latent.space native controls follow the dark token palette", () => {
  assert.match(styles, /html\[data-theme="latent-space"\]\s*\{\s*color-scheme:\s*dark;/);
  assert.match(controls, /html\[data-theme="latent-space"\][\s\S]*?input/);
  assert.match(controls, /html\[data-theme="latent-space"\][\s\S]*?select/);
  assert.match(controls, /html\[data-theme="latent-space"\][\s\S]*?textarea/);
  assert.match(controls, /background-color:\s*var\(--surface-sunk\)/);
  assert.match(controls, /border:\s*1px solid var\(--rule\)/);
  assert.match(controls, /color:\s*var\(--ink\)/);
  assert.match(controls, /::placeholder[\s\S]*?color:\s*var\(--muted\)/);
  assert.match(controls, /focus-visible[\s\S]*?box-shadow:\s*0 0 0 2px var\(--accent-wash\)/);
  assert.doesNotMatch(controls, /#[0-9a-f]{3,8}\b|\brgba?\(/i);
});
