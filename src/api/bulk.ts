/**
 * Bulk selector (exclusive: ids *or* filter), the durable bulk result
 * contract, and the S-3 `runBulkByIds` helper — the one ID-set bulk-write
 * transport. Bounded <=90-binding chunking is a documented future fallback
 * for queries that cannot use D1 JSON functions; it is never a competing
 * default here (S-3 verdict, merged at spikes/s3-d1-chunking/VERDICT.md).
 */
import { z } from "@hono/zod-openapi";
import type { D1Database } from "@cloudflare/workers-types";

import { ApiError } from "./errors";
import { ulidSchema } from "./ids";

/** The exclusive selector union — never two optional fields. */
export type BulkSelector<F> =
  | { kind: "ids"; ids: readonly string[] }
  | { kind: "filter"; filter: F };

export const BULK_ID_LIMIT = 1_000;

/**
 * Wire schema for the selector: exactly one arm. The filter arm reuses the
 * endpoint's typed list-filter shape, so filter-wide operations and list
 * reads share semantics (AC-108).
 */
export function bulkSelectorWireSchema<Filter extends z.ZodType>(
  filterSchema: Filter,
  idSchema: z.ZodType = ulidSchema,
) {
  return z.union([
    z
      .object({ ids: z.array(idSchema).min(1).max(BULK_ID_LIMIT) })
      .strict()
      .openapi({ description: "Explicit ID selection" }),
    z
      .object({ filter: filterSchema })
      .strict()
      .openapi({ description: "Select-all-matching: server-side filter selection" }),
  ]);
}

/** Normalize a parsed wire selector into the internal union; rejects both/neither. */
export function normalizeBulkSelector<F>(
  raw: { ids?: readonly string[]; filter?: F },
  validateId: (id: string) => boolean,
): BulkSelector<F> {
  const hasIds = raw.ids !== undefined;
  const hasFilter = raw.filter !== undefined;
  if (hasIds === hasFilter) {
    throw ApiError.badRequest(
      "selector must carry exactly one of 'ids' or 'filter'",
      "selector",
    );
  }
  if (hasIds) {
    const ids = raw.ids as readonly string[];
    if (ids.length === 0) throw ApiError.badRequest("selector.ids must not be empty", "selector.ids");
    if (ids.length > BULK_ID_LIMIT) {
      throw ApiError.badRequest(`selector.ids is capped at ${BULK_ID_LIMIT}`, "selector.ids");
    }
    const invalid = ids.find((id) => !validateId(id));
    if (invalid !== undefined) {
      throw ApiError.badRequest(`selector.ids contains a malformed id`, "selector.ids");
    }
    return { kind: "ids", ids };
  }
  return { kind: "filter", filter: raw.filter as F };
}

export const BULK_FAILURE_REPORT_LIMIT = 100;

export const bulkItemFailureSchema = z
  .object({
    id: z.string().min(1),
    code: z.string(),
    message: z.string(),
  })
  .openapi("BulkItemFailure");

export const bulkItemResultSchema = z
  .object({
    id: z.string().min(1),
    outcome: z.enum(["succeeded", "failed"]),
    resulting_status: z.string().nullable(),
    error: z.string().optional(),
  })
  .openapi("BulkItemResult");

export const BULK_OPERATION_STATES = [
  "queued",
  "running",
  "completed",
  "completed_with_failures",
] as const;

/**
 * Durable bulk result (Amendment 7). `operation_id` is the durable handle
 * M-18 persists; per-item failures are echoed only for explicit-ID
 * selectors — filter-wide operations never echo an unbounded item list.
 */
export const bulkResultSchema = z
  .object({
    operation_id: ulidSchema,
    selected: z.number().int().min(0),
    succeeded: z.number().int().min(0),
    failed: z.number().int().min(0),
    state: z.enum(BULK_OPERATION_STATES),
    outbox_enqueued: z
      .number()
      .int()
      .min(0)
      .describe("Publication/outbox rows enqueued by the operation"),
    /** Selected live sessions are reported even when the default is to skip them. */
    published_count: z.number().int().min(0).optional(),
    failures: z.array(bulkItemFailureSchema).max(BULK_FAILURE_REPORT_LIMIT).optional(),
    results: z.array(bulkItemResultSchema).max(BULK_ID_LIMIT).optional(),
  })
  .openapi("BulkResult");

export type BulkResult = z.infer<typeof bulkResultSchema>;

/** Construct a result with the count invariant checked. */
export function buildBulkResult(input: BulkResult): BulkResult {
  if (input.succeeded + input.failed > input.selected) {
    throw new Error(
      `bulk result invariant: succeeded(${input.succeeded}) + failed(${input.failed}) > selected(${input.selected})`,
    );
  }
  return input;
}

/**
 * S-3's exact helper. Callers keep their fixed bindings and use
 * `WHERE id IN (SELECT CAST(value AS TEXT) FROM json_each(?))` with the JSON
 * ID set as the final logical input. One serialization, one prepare, one
 * `.run()` — never placeholder expansion, never chunk splitting.
 */
export async function runBulkByIds<T = Record<string, unknown>>(
  ids: readonly string[],
  prepare: (idsJson: string) => D1PreparedStatement,
): Promise<D1Result<T> | null> {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const id of ids) {
    if (!seen.has(id)) {
      seen.add(id);
      normalized.push(id);
    }
  }
  if (normalized.length === 0) return null;
  const idsJson = JSON.stringify(normalized);
  return prepare(idsJson).run<T>();
}

/**
 * The atomic companion for ID-set writes that must update more than one
 * projection together. It keeps the same single JSON binding while allowing
 * callers to submit the related statements as one D1 batch.
 */
export async function runBulkByIdsBatch<T = Record<string, unknown>>(
  database: D1Database,
  ids: readonly string[],
  prepare: (idsJson: string) => readonly D1PreparedStatement[],
): Promise<D1Result<T>[] | null> {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const id of ids) {
    if (!seen.has(id)) {
      seen.add(id);
      normalized.push(id);
    }
  }
  if (normalized.length === 0) return null;
  const idsJson = JSON.stringify(normalized);
  return database.batch<T>([...prepare(idsJson)]);
}
