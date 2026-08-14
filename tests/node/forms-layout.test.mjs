import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const repositoryRoot = resolve(import.meta.dirname, "../..");

test("the CFP add-field row wraps before the 1280px editor can collide with the preview", async () => {
  const styles = await readFile(resolve(repositoryRoot, "src/ui/forms/forms.css"), "utf8");

  assert.match(styles, /\.forms-add-row\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1\.6fr\) 118px 132px minmax\(0, 1\.4fr\) 88px 104px/);
  assert.match(styles, /@media \(max-width: 1320px\)\s*\{\s*\.forms-add-row\s*\{\s*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(styles, /@media \(max-width: 700px\)[\s\S]*\.forms-add-row\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\) minmax\(0, 1fr\)/);
});
