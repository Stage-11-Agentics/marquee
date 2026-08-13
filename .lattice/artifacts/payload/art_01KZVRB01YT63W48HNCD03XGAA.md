# Plan Review: MRQ-137

## 1. Verdict

**PASS** — the diagnosis is correct, the fix shape is sound, and the scope is right. Implementation can proceed, but the implementer must incorporate the issues below — most importantly, an existing test explicitly asserts the behavior this fix removes, so "roughly one line" is really "one line plus a deliberate test-contract change."

## 2. Summary

Reviewed the plan for making the shared list contract's `sort` field fall back to the default instead of 400-ing on an unrecognized value. I independently verified every factual claim: `src/api/list.ts:43-46` is exactly as described (`z.enum(sortKeys).default(...)` with no `.catch()`), the whitelist behavior matches Zod semantics, and the change lands once and covers all four consumers (`submissions`, `board`, `comms`, `forms` routes). The plan is a verbatim copy of the ticket with no added implementation detail; for a trivial ticket that's acceptable, but it misses one real landmine (a test that asserts the opposite behavior) and slightly overclaims what the server-side fix resolves (the dropdown symptom is client-side).

## 3. Issues

**[MAJOR] Fix shape — An existing AC-108 test asserts the exact behavior this fix removes**
`tests/unit/api/list.test.ts:40` asserts `submissionQuery.safeParse({ sort: "secret_column" }).success` is `false`, in a test named "the list query defaults, caps, and validates every shared parameter." After adding `.catch(default)`, that parse *succeeds* with the fallback value, so the suite goes red on the literal one-line change. This rejection was deliberate (the file also tests SQL-injection-shaped sort keys against `resolveSort`), so the implementer needs to consciously rewrite the assertion as a contract change — not just delete a failing line to get green.
**Recommendation:** The plan should state: update `tests/unit/api/list.test.ts` to assert the new contract (`sort: "secret_column"` parses to the default sort) and add a regression case for the reported shape (`sort: "score_desc"` on a schema whose keys include `score`/`score_asc`). Note in the PR that unknown-sort now degrades rather than rejects, and that the injection safety net remains intact one layer down at `resolveSort` (which only ever sees whitelisted keys after this change — worth keeping its test as-is).

**[MINOR] WHAT BREAKS vs FIX SHAPE — The dropdown symptom is not fixed by the server-side change**
The ticket lists two symptoms: the hard load failure *and* "the sort dropdown renders with no option selected." The `.catch()` fix resolves the first (the page loads with default-sorted data), but the second is client-side: `src/ui/submissions/SubmissionsPage.tsx:234` reads the raw URL value (`queryValue(params, "sort", "newest")`) and feeds it to `<select value={sort}>` at line 591 — with `sort=score_desc` still in the URL, no option matches and the dropdown still renders unselected (and the client's own fetch identity uses the bogus value). The plan claims the one-liner fixes "WHAT BREAKS" whole; it fixes the defect that matters and leaves a cosmetic residue.
**Recommendation:** Either explicitly scope the dropdown residue out in the plan (defensible — the page now works and any dropdown interaction self-heals the URL), or add a one-line client-side normalization (fall back to `"newest"` when the URL value isn't in `SORT_OPTIONS`), which fully closes the described symptom for the submissions surface. Decide before implementation, not during review.

**[MINOR] Fix shape — Chain order relative to `.openapi()` and verification steps unstated**
The field currently ends in `.openapi({...})` (`src/api/list.ts:46`); `.catch()` should be inserted before the `.openapi()` call so `@hono/zod-openapi`'s metadata registration stays on the outermost schema it inspects — appending `.catch()` after `.openapi()` risks the doc annotation silently dropping from the generated spec. The plan also names no verification step.
**Recommendation:** Specify the chain as `.enum(sortKeys).default(d).catch(d).openapi({...})`, and add the standard verification line: `npm test` (with the updated list test) and `npm run pr-gate` before the PR. Zod 4.4.3 is in the lockfile, so `.catch()` availability is not a concern.

**[MINOR] Scope — The same failure class exists on `page`/`per_page`/`q`, deliberately untouched**
`page=0`, `per_page=101`, or a 201-char `q` still hard-400 the surface the same way. The task correctly scopes to `sort` only (those rejections are arguably correct — a capped `per_page` is a real constraint, not a plausible guess), but the plan should say this is intentional so a reviewer of the eventual PR doesn't reopen it.
**Recommendation:** One sentence in the plan/PR: "Other list params keep strict rejection on purpose; `sort` is unique in having an always-safe fallback." If the operator later wants graceful degradation there too, that's a separate ticket.

## 4. Positive Observations

- **The root cause is verified, not guessed.** The plan cites exact file:line for both the defect and the whitelist, correctly explains the `.default()` vs `.catch()` Zod semantics, and states the live sha it was confirmed against. Every claim checked out against source.
- **The fix targets the right layer.** Patching `createListQuerySchema` once fixes all four list endpoints built on the shared contract simultaneously — the plan explicitly recognizes this leverage rather than patching the one route that surfaced the bug.
- **Scope discipline is excellent.** Trivial size honestly declared, no dependency, no invented adjacent work, and the urgency rationale (first failure an agent driving by URL hits, bearing on "agent-native by design") ties the fix to a project principle rather than generic goodness.
- **Provenance is traceable** — sbek run, judgement, and defect index are all recorded, so the eventual PR can close the loop against the originating finding.
