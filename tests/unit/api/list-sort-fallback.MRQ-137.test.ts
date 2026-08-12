/**
 * MRQ-137 — an unrecognised sort value used to hard-error the whole list.
 *
 * `?sort=score_desc` is exactly what a hand-edited URL or an agent driving the
 * product by address bar produces: a plausible guess that is not in the
 * whitelist. `.default()` covers a *missing* value only, so the guess threw a
 * ZodError, the endpoint answered 400, and the surface rendered its
 * load-failure state with an empty table and a blank sort control.
 *
 * The contract now degrades the three navigational parameters and keeps every
 * endpoint-owned filter strict.
 */
import { z } from "@hono/zod-openapi";
import { expect, test } from "vitest";

import { LIST_DEFAULTS, createListQuerySchema } from "../../../src/api/list";
import { peopleListQuerySchema } from "../../../src/routes/people.routes";

const SORTS = ["newest", "updated", "title", "score", "score_asc"] as const;
const listQuery = createListQuerySchema(
  {
    status: z.enum(["submitted", "in_review", "accepted"]).optional(),
    track_id: z.string().optional(),
  },
  SORTS,
  { defaultSort: "newest" },
);

test("AC-108 · MRQ-137 — an unrecognised sort falls back to the endpoint default instead of failing the read", () => {
  expect(listQuery.parse({ sort: "score_desc" })).toMatchObject({ sort: "newest", page: 1, per_page: 50 });
  expect(listQuery.parse({ sort: "" }).sort).toBe("newest");
  expect(listQuery.parse({ sort: "title; DROP TABLE submissions" }).sort).toBe("newest");
  // The whitelist still decides: a recognised value is honoured untouched.
  expect(listQuery.parse({ sort: "score_asc" }).sort).toBe("score_asc");
  // Without an explicit default, the first key of the endpoint's whitelist wins.
  expect(createListQuerySchema({}, SORTS).parse({ sort: "nope" }).sort).toBe("newest");
});

test("AC-108 · MRQ-137 — malformed paging degrades to the defaults rather than emptying the page", () => {
  expect(listQuery.parse({ page: "0" }).page).toBe(LIST_DEFAULTS.page);
  expect(listQuery.parse({ page: "1.5" }).page).toBe(LIST_DEFAULTS.page);
  expect(listQuery.parse({ page: "banana" }).page).toBe(LIST_DEFAULTS.page);
  expect(listQuery.parse({ per_page: "101" }).per_page).toBe(LIST_DEFAULTS.perPage);
  expect(listQuery.parse({ per_page: "0" }).per_page).toBe(LIST_DEFAULTS.perPage);
  // Valid paging is still carried through exactly as asked.
  expect(listQuery.parse({ page: "3", per_page: "100" })).toMatchObject({ page: 3, per_page: 100 });
});

test("AC-108 · MRQ-137 — softening stops at navigation — search and endpoint-owned filters still reject bad input", () => {
  // Answering a search with the unfiltered list is a different set of records
  // than the one asked for, so `q` stays strict on purpose.
  expect(listQuery.safeParse({ q: "x".repeat(201) }).success).toBe(false);
  expect(listQuery.parse({ q: "keynote" }).q).toBe("keynote");

  expect(listQuery.safeParse({ status: "deleted" }).success).toBe(false);
  expect(peopleListQuerySchema.safeParse({ stage: "invented_stage" }).success).toBe(false);
});

test("AC-108 · MRQ-137 — the people directory, which owns its own query schema, degrades the same way", () => {
  expect(peopleListQuerySchema.parse({ sort: "score_desc" }).sort).toBeUndefined();
  expect(peopleListQuerySchema.parse({ page: "0" }).page).toBeUndefined();
  expect(peopleListQuerySchema.parse({ per_page: "9999" }).per_page).toBeUndefined();
  expect(peopleListQuerySchema.parse({ sort: "name" }).sort).toBe("name");
});
