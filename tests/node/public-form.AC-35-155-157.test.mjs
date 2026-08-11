import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");

test("AC-35 + AC-36 + AC-155 + AC-156 + AC-157 · the public form has a 375px field and resume contract", async () => {
  const styles = await readFile(resolve(ROOT, "src/ui/public/form/styles.ts"), "utf8");
  const component = await readFile(resolve(ROOT, "src/ui/public/form/PublicForm.tsx"), "utf8");
  assert.match(styles, /@media \(max-width: 560px\)/);
  assert.match(styles, /width: calc\(100% - 24px\)/);
  assert.match(styles, /overflow-wrap: anywhere/);
  assert.match(component, /scrollIntoView/);
  assert.match(component, /state\.resume_token/);
  assert.match(component, /PATCH/);
  assert.match(component, /Submit abstract/);
});
