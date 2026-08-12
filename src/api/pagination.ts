/**
 * Pagination helper: validated paging, endpoint-owned sort resolution, and
 * the D1 executor returning the common list envelope. Caller strings never
 * become SQL identifiers — sort columns come only from the endpoint's own
 * registry constants. Every order appends the ULID `id` as the stable
 * secondary key (Amendment 7), unless `id` is already the unique sort.
 */
import type { D1PreparedStatement } from "@cloudflare/workers-types";

import { ApiError } from "./errors";
import { LIST_DEFAULTS, type ListEnvelope } from "./list";

export interface PageParams {
  page: number;
  perPage: number;
  limit: number;
  offset: number;
}

/** Validate raw query values (already zod-parsed at the boundary, or raw in unit probes). */
export function parsePagination(input: { page?: unknown; per_page?: unknown }): PageParams {
  const page = Number(input.page ?? LIST_DEFAULTS.page);
  const perPage = Number(input.per_page ?? LIST_DEFAULTS.perPage);
  if (!Number.isInteger(page) || page < 1) {
    throw ApiError.badRequest("page must be a positive integer", "page");
  }
  if (!Number.isInteger(perPage) || perPage < 1) {
    throw ApiError.badRequest("per_page must be a positive integer", "per_page");
  }
  if (perPage > LIST_DEFAULTS.maxPerPage) {
    throw ApiError.badRequest(
      `per_page must be at most ${LIST_DEFAULTS.maxPerPage}`,
      "per_page",
    );
  }
  return { page, perPage, limit: perPage, offset: (page - 1) * perPage };
}

export function totalPages(total: number, perPage: number): number {
  return total === 0 ? 0 : Math.ceil(total / perPage);
}

export interface SortColumn {
  /** SQL identifier — only ever an endpoint-owned constant. */
  column: string;
  direction: "asc" | "desc";
  /**
   * Keep NULLs at the bottom in BOTH directions. SQLite sorts NULLs first
   * ascending, which buries the scored records under every unscored one the
   * moment a chair asks for "lowest score first" — the ordering is technically
   * correct and useless. Records with no value belong last either way.
   */
  nullsLast?: boolean;
}

export type SortRegistry = Record<string, SortColumn>;

/**
 * Resolve a caller-supplied sort key against the endpoint's whitelist.
 * Unknown keys are rejected, never interpolated.
 */
export function resolveSort(
  registry: SortRegistry,
  key: string | undefined,
  defaultKey: string,
): SortColumn & { key: string } {
  const selected = key ?? defaultKey;
  const column = registry[selected];
  if (!column) {
    throw ApiError.badRequest(
      `unknown sort '${selected}'; allowed: ${Object.keys(registry).sort().join(", ")}`,
      "sort",
    );
  }
  return { ...column, key: selected };
}

/**
 * Build the ORDER BY clause. Appends `id ASC` as the deterministic ULID
 * tiebreaker unless the primary sort is already the unique `id` column.
 */
export function orderClause(sort: SortColumn): string {
  const primary = sort.nullsLast
    ? `${sort.column} IS NULL ASC, ${sort.column} ${sort.direction.toUpperCase()}`
    : `${sort.column} ${sort.direction.toUpperCase()}`;
  return sort.column === "id" ? primary : `${primary}, id ASC`;
}

/**
 * Run separately prepared count/data statements (bound with identical
 * filters by the caller) and return the common envelope. Out-of-range pages
 * return `data: []` with the authoritative totals — the requested page is
 * never silently rewritten.
 */
export async function executeListPage<T>(input: {
  count: D1PreparedStatement;
  data: D1PreparedStatement;
  page: PageParams;
}): Promise<ListEnvelope<T>> {
  const countRow = await input.count.first<{ total: number }>();
  const total = Number(countRow?.total ?? 0);
  const { results } = await input.data.all<T>();
  return {
    data: results,
    page: input.page.page,
    per_page: input.page.perPage,
    total,
    total_pages: totalPages(total, input.page.perPage),
  };
}
