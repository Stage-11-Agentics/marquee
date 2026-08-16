import { env } from "cloudflare:test";
import { describe, expect, test } from "vitest";

import { emailValiditySql, isValidEmail } from "../../../src/lib/email-validity";

describe("MRQ-234 decision email validity SQL/TypeScript parity", () => {
  test("CONTRACT · MRQ-234 · the notification predicate agrees on divergence fixtures and valid controls", async () => {
    const values = [
      "a b@c.d",
      "@x.",
      "a@x.",
      "ada@example.test",
      " Ada@example.test ",
    ];
    const rows = await env.DB
      .prepare(`
        SELECT value AS email, CASE WHEN ${emailValiditySql("value")} THEN 1 ELSE 0 END AS valid
        FROM json_each(?)
        ORDER BY key ASC
      `)
      .bind(JSON.stringify(values))
      .all<{ email: string; valid: number }>();

    expect(rows.results.map((row) => Boolean(row.valid))).toEqual(values.map(isValidEmail));
    expect(rows.results).toEqual([
      { email: "a b@c.d", valid: 0 },
      { email: "@x.", valid: 0 },
      { email: "a@x.", valid: 0 },
      { email: "ada@example.test", valid: 1 },
      { email: " Ada@example.test ", valid: 1 },
    ]);
  });
});
