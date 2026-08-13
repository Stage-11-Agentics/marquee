# Code Review: MRQ-137 — unrecognised sort value hard-errors the submissions list

Reviewed at worktree `Marquee-worktrees/mrq-137-sort-fallback`, commit `a1cc5355`.
Verification was empirical, not just read-through: full suite run in the worktree
(182/182 pass), plus a targeted run of the OpenAPI document validation and the
MRQ-137 tests (13/13 pass, including `@scalar/openapi-parser` validation of the
generated `/api/openapi.json`).

### 1. Verdict

**PASS** — Implementation is correct, meets the acceptance criteria, and exceeds
the plan in a well-reasoned way.

### 2. Summary

The change adds `.catch(default)` to the navigational parameters (`sort`, `page`,
`per_page`) of the shared list contract in `src/api/list.ts`, and applies the same
treatment to the people directory's self-owned query schema in
`src/routes/people.routes.ts` — while deliberately keeping `q` and every
endpoint-owned filter strict. The Zod semantics are correct (`.default()` handles
the missing key, `.catch()` wrapping it handles the invalid value), the drawn
line between "navigation degrades, filters refuse" is principled and tested, and
the OpenAPI document still generates and validates because each softened field
restates its shape via `.openapi()` metadata. All tests pass; the wall-clock
over-budget on the full suite (86s against 45s) was machine load — actual test
execution was 13.4s, and the runner itself flagged load rather than a defect.

### 3. Issues

**[MINOR] src/ui/submissions/list-request.ts:8-15 — Comment now contradicts the API's actual behavior**
The client-side `normaliseSubmissionSort` (from PR #99, predating this branch)
carries a rationale block saying "the endpoint validates `sort` against a fixed
set and correctly refuses anything else" and that normalising client-side "keeps
the API strict." After this change the API is no longer strict on `sort` — it
degrades. The normalisation itself is still worth keeping (it makes the dropdown
render a real selection for a bad URL, which the API-side fallback alone cannot
do, since the list envelope does not echo the applied sort), but the comment now
documents a world that no longer exists. This file is not in the diff, but the
diff is what invalidates it.
**Fix:** Update the comment to say the API now also degrades unknown sorts
(MRQ-137) and that the client-side normalisation remains so the sort control
reflects the value actually applied.

**[MINOR] src/api/list.ts:93 — `options.defaultSort` is trusted, and is now also the catch value**
`defaultSort` is typed `string` with no assertion that it is a member of
`sortKeys`. This is pre-existing (`.default()` had the same trust), but the
change doubles down: a typo'd `defaultSort` at a call site would now be emitted
for *both* the missing-key and the invalid-value paths, and in Zod 4 neither
`.default()` nor `.catch()` re-parses the supplied value, so it would flow
through to the sort registry downstream. All current call sites are correct.
**Fix (optional hardening):** one guard line —
`if (!sortKeys.includes(defaultSort)) throw new Error(...)` — so a bad call site
fails at module load rather than at request time.

No critical or major issues found. Two design choices worth stating explicitly
so the record shows they were reviewed and accepted, not missed:

- `per_page=101` now degrades to the default (50) rather than clamping to the
  max (100). A caller asking for "more than allowed" arguably wants the max, but
  degrade-to-default is consistent with how every other malformed navigational
  value behaves, and the new test in `tests/unit/api/list.test.ts` documents the
  cap still binds. Acceptable as-is.
- The diff is larger than the plan's "roughly one line": it extends the fallback
  to `page`/`per_page` and to the people directory's independent schema. This is
  scope expansion, but it is the coherent version of the ticket's own principle
  (a pasted URL's navigation should never fail the read), it is fully tested,
  and the boundary — softening stops at navigation — is held everywhere. The
  strict sort enums remaining in `src/routes/views.routes.ts:25,33` are saved-view
  request *bodies*, where silently rewriting a stored sort would corrupt saved
  intent; leaving them strict is correct, not a gap.

### 4. Positive Observations

- **The correctness core is exactly right.** `.default(x).catch(x)` is the
  correct composition order in Zod: `ZodCatch` wraps `ZodDefault`, so a missing
  key takes the default without erroring and an invalid value is caught into the
  same default. Verified by the passing tests for `sort: ""`, `sort:
  "score_desc"`, and the injection-shaped `sort: "title; DROP TABLE submissions"`.
- **The strict/soft boundary is a real design decision, argued in place.** The
  comments explaining why `q` and filters stay strict ("a filter the server
  silently ignores would answer a question nobody asked") are the good kind of
  comment — they state a constraint the code cannot show, and the third test in
  `list-sort-fallback.MRQ-137.test.ts` pins the boundary so a future edit can't
  silently soften filters.
- **The OpenAPI hazard was anticipated, explained, and defended by an existing
  gate.** `.catch()` is opaque to the generator; each softened field restates its
  shape via `.openapi({type, ...})`, and `tests/integration/api/meta.test.ts`
  validates the generated document with a real parser — which passed. This is a
  failure mode that would have thrown at document-build time and taken every
  route down; catching it pre-emptively is exactly the diligence the shared
  contract deserves.
- **Test quality is high across the board.** The updated assertions in
  `list.test.ts` were flipped from "rejects" to "degrades" with a comment
  explaining the cap still binds; the new file covers the fallback, the paging
  degradation, the strictness boundary, and the people directory separately;
  names describe behavior, not implementation; and the whole MRQ-137 file runs
  in well under a second.
- **The people directory was found and included.** It predates the shared
  contract and owns its own schema — the easy miss. Degrading its params to
  `undefined` (letting `parsePagination` and `PEOPLE_SORTS` supply endpoint
  defaults) is the right shape for a schema whose defaults live downstream.
