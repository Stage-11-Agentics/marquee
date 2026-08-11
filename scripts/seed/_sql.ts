/**
 * SQL generation helpers for the seed. Everything the seed writes goes
 * through `upsert` keyed on a deterministic `id`, so a re-run converges to
 * the same rows instead of duplicating them.
 */

export type SqlValue = string | number | null;
export type SeedRow = { table: string; row: Record<string, SqlValue> };

export function sqlLiteral(value: SqlValue): string {
  if (value === null) return "NULL";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`non-finite number in seed: ${value}`);
    return String(value);
  }
  return `'${value.replaceAll("'", "''")}'`;
}

export function upsertStatement({ table, row }: SeedRow): string {
  const columns = Object.keys(row);
  if (!columns.includes("id")) throw new Error(`seed row for ${table} has no id`);
  const updates = columns
    .filter((column) => column !== "id")
    .map((column) => `${column} = excluded.${column}`)
    .join(", ");
  return (
    `INSERT INTO ${table} (${columns.join(", ")}) VALUES (` +
    `${columns.map((column) => sqlLiteral(row[column]!)).join(", ")}) ` +
    `ON CONFLICT(id) DO UPDATE SET ${updates};`
  );
}

/** Shared per-run collection context handed to every seeder module. */
export interface SeedContext {
  rows: SeedRow[];
  /** Frozen demo clock (SPEC §6): ~Aug 20, 2026, epoch milliseconds UTC. */
  now: number;
  add(table: string, row: Record<string, SqlValue>): void;
}

/** One per-entity seeder, discovered and ordered by scripts/seed/index.ts. */
export interface SeedModule {
  name: string;
  order: number;
  run(ctx: SeedContext): void | Promise<void>;
}

export function makeContext(now: number): SeedContext {
  const rows: SeedRow[] = [];
  return {
    rows,
    now,
    add(table, row) {
      rows.push({ table, row });
    },
  };
}
