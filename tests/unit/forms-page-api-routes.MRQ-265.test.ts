import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "vitest";

import { apiManifest } from "../../src/routes/_manifest";

test("CONTRACT · MRQ-265 · every API path FormsPage requests exists in the OpenAPI route table", () => {
  const page = readFileSync(resolve(process.cwd(), "src/ui/forms/FormsPage.tsx"), "utf8");
  const requested = [...page.matchAll(/"(\/api\/v1\/[^\"]+)"/g)].map(([, path]) => path);
  const routes = new Set(apiManifest.map((entry) => entry.path));

  expect(requested.length).toBeGreaterThan(0);
  expect(requested).toContain("/api/v1/events/{eventId}/tracks");
  expect([...new Set(requested.filter((path) => !routes.has(path)))]).toEqual([]);
});
