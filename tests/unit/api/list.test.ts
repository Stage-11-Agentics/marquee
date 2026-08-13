/**
 * AC-108 — one list contract. The same parsed filter object that drives a list
 * read is the one the filter arm of a bulk selector carries, which is the
 * structural reason API result IDs and UI-rendered IDs cannot disagree.
 */
import { z } from "@hono/zod-openapi";
import { expect, test } from "vitest";

import { normalizeBulkSelector } from "../../../src/api/bulk";
import { ApiError } from "../../../src/api/errors";
import { LIST_DEFAULTS, createListQuerySchema, createListResponseSchema } from "../../../src/api/list";
import { isUlid } from "../../../src/api/ids";
import { orderClause, parsePagination, resolveSort, totalPages } from "../../../src/api/pagination";

const SORTS = ["created_at", "title", "status"] as const;
const submissionQuery = createListQuerySchema(
  {
    status: z.enum(["submitted", "in_review", "accepted"]).optional(),
    track_id: z.string().optional(),
    format_id: z.string().optional(),
  },
  SORTS,
  { defaultSort: "created_at" },
);

const SORT_REGISTRY = {
  created_at: { column: "created_at", direction: "desc" },
  title: { column: "title", direction: "asc" },
  status: { column: "status", direction: "asc" },
} as const;

test("AC-108 · the list query defaults, caps, and validates every shared parameter", () => {
  expect(submissionQuery.parse({})).toMatchObject({ page: 1, per_page: 50, sort: "created_at" });
  expect(submissionQuery.parse({ page: "3", per_page: "100" })).toMatchObject({ page: 3, per_page: 100 });
  // Navigation degrades to the defaults; the caps still bind, so an
  // out-of-range per_page can never widen a page beyond maxPerPage (MRQ-137).
  expect(submissionQuery.parse({ per_page: "101" }).per_page).toBe(LIST_DEFAULTS.perPage);
  expect(submissionQuery.parse({ per_page: "0" }).per_page).toBe(LIST_DEFAULTS.perPage);
  expect(submissionQuery.parse({ page: "0" }).page).toBe(LIST_DEFAULTS.page);
  expect(submissionQuery.parse({ page: "1.5" }).page).toBe(LIST_DEFAULTS.page);
  expect(submissionQuery.parse({ sort: "secret_column" }).sort).toBe("created_at");
  // Endpoint-owned filters stay strict: an unknown status is still refused.
  expect(submissionQuery.safeParse({ status: "deleted" }).success).toBe(false);
  expect(LIST_DEFAULTS.maxPerPage).toBe(100);
});

test("AC-108 · pagination arithmetic and page boundaries agree with the totals", () => {
  expect(parsePagination({ page: 1, per_page: 50 })).toEqual({ page: 1, perPage: 50, limit: 50, offset: 0 });
  expect(parsePagination({ page: 4, per_page: 25 }).offset).toBe(75);
  expect(totalPages(0, 50)).toBe(0);
  expect(totalPages(50, 50)).toBe(1);
  expect(totalPages(51, 50)).toBe(2);
  expect(totalPages(1, 50)).toBe(1);
  expect(() => parsePagination({ page: 0 })).toThrowError(ApiError);
  expect(() => parsePagination({ per_page: 101 })).toThrowError(/at most 100/);
});

test("AC-108 · sort keys resolve only from the endpoint's registry and always tie-break on the ULID id", () => {
  expect(orderClause(resolveSort(SORT_REGISTRY, "title", "created_at"))).toBe("title ASC, id ASC");
  expect(orderClause(resolveSort(SORT_REGISTRY, undefined, "created_at"))).toBe("created_at DESC, id ASC");
  expect(orderClause({ column: "id", direction: "asc" })).toBe("id ASC");
  expect(() => resolveSort(SORT_REGISTRY, "title; DROP TABLE submissions", "created_at")).toThrowError(
    /unknown sort/,
  );
});

test("AC-108 · the list response envelope carries data, page, per_page, total, and total_pages", () => {
  const schema = createListResponseSchema(z.object({ id: z.string() }), "Submission");
  const parsed = schema.parse({ data: [{ id: "a" }], page: 2, per_page: 25, total: 30, total_pages: 2 });
  expect(Object.keys(parsed).sort()).toEqual(["data", "page", "per_page", "total", "total_pages"]);
  expect(schema.safeParse({ data: [], page: 1, per_page: 25, total: -1, total_pages: 0 }).success).toBe(false);
});

test("AC-108 · three filter combinations parse to the identical object a bulk filter selector carries", () => {
  const combinations = [
    { status: "accepted", page: "2", per_page: "25" },
    { track_id: "01J8ZQ7X2M4N6P8R0T2V4Y6A8C", q: "keynote" },
    { status: "in_review", format_id: "01J8ZQ7X2M4N6P8R0T2V4Y6A8D", sort: "title" },
  ];
  for (const raw of combinations) {
    const listFilter = submissionQuery.parse(raw);
    const selector = normalizeBulkSelector({ filter: submissionQuery.parse(raw) }, isUlid);
    expect(selector.kind).toBe("filter");
    // Same schema, same parse, same object — a filter-wide bulk operation
    // cannot select a different set than the list read that showed it.
    expect(selector.kind === "filter" ? selector.filter : undefined).toEqual(listFilter);
  }
});
