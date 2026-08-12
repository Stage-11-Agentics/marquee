import { readFile } from "node:fs/promises";
import { strict as assert } from "node:assert";
import { resolve } from "node:path";
import { test } from "node:test";

const ROOT = resolve(import.meta.dirname, "../..");

test("CONTRACT · MRQ-154 · the CFP confirmation names the magic link as sign-in", async () => {
  const component = await readFile(resolve(ROOT, "src/ui/public/form/PublicForm.tsx"), "utf8");
  assert.match(component, /This link is your sign-in/);
  assert.match(component, /Track your submission/);
});
