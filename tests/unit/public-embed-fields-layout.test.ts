import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect, test } from "vitest";

const source = readFileSync(fileURLToPath(new URL("../../src/ui/embeds/EmbedPage.tsx", import.meta.url)), "utf8");

test("CONTRACT · embed field labels shrink and wrap inside their bordered panel", () => {
  expect(source).toMatch(/\.embed-field-option \{[^}]*align-items: flex-start;/);
  expect(source).toMatch(/\.embed-field-option > span \{[^}]*min-width: 0;[^}]*overflow-wrap: anywhere;/);
  expect(source).toMatch(/\.embed-field-option input \{[^}]*margin-top: 1px;/);
});
