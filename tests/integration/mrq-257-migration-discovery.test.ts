import { expect, test } from "vitest";

import { applyMigrations, env } from "./apply-migrations";

test("CONTRACT · MRQ-257 migration discovery applies the newest SQL file", async () => {
  await applyMigrations();
  const latest = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'form_length_rules'",
  ).first<{ name: string }>();
  expect(latest?.name).toBe("form_length_rules");
});
