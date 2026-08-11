import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const boardSource = readFileSync(resolve(ROOT, "src/ui/board/ProgramBoardPage.tsx"), "utf8");

test("AC-243 · program board cards are keyboard navigable read-only record links", () => {
  assert.doesNotMatch(boardSource, /draggable/i);
  assert.doesNotMatch(boardSource, /<button[^>]*(decision|schedule|publish)/i);
  assert.match(boardSource, /onKeyDown/);
  assert.match(boardSource, /Enter|Space/);
  assert.match(boardSource, /navigate\(`\/submissions\//);
});
