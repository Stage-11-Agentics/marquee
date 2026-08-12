import { describe, expect, test } from "vitest";

import { boundSourceOf, isBoundSource, isBoundSourceCompatible, normalizeFieldConfig, resolveBoundOptions } from "../../src/lib/bound-options";
import type { FormFieldView } from "../../src/routes/forms.queries";

function field(overrides: Partial<FormFieldView> = {}): FormFieldView {
  return {
    id: "fld_1",
    form_id: "form_1",
    key: "format",
    label: "Format",
    help_text: null,
    type: "single_select",
    required: true,
    position: 0,
    config: {},
    condition: null,
    created_at: 0,
    updated_at: 0,
    ...overrides,
  };
}

/**
 * A stand-in for the two-column reads the resolver makes, counting them so the
 * "no bound field costs no query" claim is actually asserted rather than
 * assumed — the public form GET is on the speed budget.
 */
function fakeDb(rows: Record<string, string[]>): { db: D1Database; queries: string[] } {
  const queries: string[] = [];
  const db = {
    prepare(sql: string) {
      queries.push(sql);
      return {
        bind() {
          return {
            async all() {
              const table = /FROM (\w+)/.exec(sql)?.[1] ?? "";
              return { results: (rows[table] ?? []).map((name) => ({ name })) };
            },
          };
        },
      };
    },
  } as unknown as D1Database;
  return { db, queries };
}

describe("bound form options (MRQ-126)", () => {
  test("AC-17 · only the two conference lists are valid bound sources", () => {
    expect(isBoundSource("formats")).toBe(true);
    expect(isBoundSource("tracks")).toBe(true);
    expect(isBoundSource("speakers")).toBe(false);
    expect(isBoundSource(undefined)).toBe(false);
  });

  test("AC-17 · each bound source uses the storage-compatible select type", () => {
    expect(boundSourceOf(field({ config: { source: "formats" } }))).toBe("formats");
    expect(boundSourceOf(field({ type: "multi_select", config: { source: "tracks" } }))).toBe("tracks");
    expect(isBoundSourceCompatible("formats", "single_select")).toBe(true);
    expect(isBoundSourceCompatible("tracks", "multi_select")).toBe(true);
    expect(isBoundSourceCompatible("formats", "multi_select")).toBe(false);
    expect(isBoundSourceCompatible("tracks", "single_select")).toBe(false);
    expect(boundSourceOf(field({ type: "short_text", config: { source: "formats" } }))).toBeNull();
    expect(boundSourceOf(field({ type: "multi_select", config: { source: "formats" } }))).toBeNull();
  });

  test("AC-25 · a bound field is served the live rows in settings order", async () => {
    const { db, queries } = fakeDb({ formats: ["Keynote (45 min)", "Talk (30 min)"], tracks: ["Platform & Infra"] });
    const resolved = await resolveBoundOptions(db, "evt_1", [
      field({ config: { source: "formats" } }),
      field({ id: "fld_2", key: "tracks", type: "multi_select", config: { source: "tracks", minItems: 1 } }),
    ]);
    expect(resolved[0].config.options).toEqual(["Keynote (45 min)", "Talk (30 min)"]);
    expect(resolved[1].config.options).toEqual(["Platform & Infra"]);
    // Other config survives resolution — tracks keeps its minimum.
    expect(resolved[1].config.minItems).toBe(1);
    expect(queries).toHaveLength(2);
  });

  test("AC-25 · an unbound field keeps its own list, and costs no query", async () => {
    const { db, queries } = fakeDb({ formats: ["Keynote (45 min)"] });
    const custom = field({ key: "audience_level", config: { options: ["Beginner", "Intermediate", "Advanced"] } });
    const resolved = await resolveBoundOptions(db, "evt_1", [custom]);
    expect(resolved[0].config.options).toEqual(["Beginner", "Intermediate", "Advanced"]);
    expect(queries).toHaveLength(0);
  });

  test("AC-25 · an empty bound source never serves stale names", async () => {
    const { db } = fakeDb({ formats: [] });
    const resolved = await resolveBoundOptions(db, "evt_1", [field({ config: { source: "formats", options: ["Stage Talk"] } })]);
    expect(resolved[0].config.options).toEqual([]);
  });

  test("AC-24 · a bound field never persists a copy of the options", () => {
    const result = normalizeFieldConfig({ source: "formats", options: ["Stage Talk"], minItems: 1 }, "single_select");
    expect(result).toEqual({ config: { source: "formats", minItems: 1 } });
  });

  test("AC-24 · an unbound config keeps custom options and drops an empty source", () => {
    expect(normalizeFieldConfig({ options: ["A", "B"] }, "single_select")).toEqual({ config: { options: ["A", "B"] } });
    expect(normalizeFieldConfig({ source: "", options: ["A"] }, "single_select")).toEqual({ config: { options: ["A"] } });
  });

  test("AC-25 · invalid sources and source types are refused rather than ignored", () => {
    expect(normalizeFieldConfig({ source: "venues" }, "single_select")).toEqual({ error: expect.stringContaining("formats, tracks") });
    expect(normalizeFieldConfig({ source: "formats" }, "short_text")).toEqual({ error: expect.stringContaining("single-select") });
    expect(normalizeFieldConfig({ source: "formats" }, "multi_select")).toEqual({ error: expect.stringContaining("single-select") });
    expect(normalizeFieldConfig({ source: "tracks" }, "single_select")).toEqual({ error: expect.stringContaining("multi-select") });
  });
});
