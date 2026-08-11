# Code Review: MRQ-52 — bulk-write path audit guard

Reviewer: independent (did not write this code). Verified against worktree `mrq-52-audit-bulk` at HEAD `068a122`; branch diff vs `master` is exactly the two files under review.

## 1. Verdict

**FAIL (implementation-level)** — the plan is sound and the delivered inventory is accurate today, but the future-proof guard misses trivially adjacent placeholder idioms, which is the one property the plan's step 6 makes mandatory ("must fail on a new direct placeholder expansion"). The fix is small and localized; return to `in_progress` for a targeted rework, not a re-plan.

## 2. Summary

Reviewed the two-file audit artifact: the AST-based repo-wide D1 placeholder inventory/guard (`tests/node/bulk-paths.AC-66-69.test.mjs`) and the AC-claims manifest (`tests/ac-claims/MRQ-52.json`). Quality is high — I independently verified the 12-site inventory is complete (matches a repo-wide sweep exactly), both NAMED_FINDING classifications correspond to real uncapped ID-set expansions in source, the `runBulkByIds` caller allowlist is correct, and the full suite passes hermetically in 16s. The key finding: the placeholder detector keys on `ts.isStringLiteral`, so a new bulk writer using `` ids.map(() => `?`) `` (backtick instead of quotes — verified empirically against the same TypeScript AST library) or a non-`map` expansion like `Array(n).fill("?")` sails through the guard silently, defeating its stated purpose.

Scope note: the plan's runtime evidence (150/1,000 drives, double-fire idempotency counts, empty-selection before/after vectors) is by design not in this diff — it must live in the Lattice validation record. This review covers the diff only and neither confirms nor disputes that evidence; the validation gate should check it independently.

## 3. Issues

**[MAJOR] tests/node/bulk-paths.AC-66-69.test.mjs:91 — Placeholder detector evadeable by near-identical idioms**
`returnsQuestionMark` accepts only `ts.isStringLiteral` nodes (lines 91 and 95). A `NoSubstitutionTemplateLiteral` is not a `StringLiteral` in the TypeScript AST — I confirmed with the repo's own `typescript-ast` package that `ids.map(() => `?`)` yields `isStringLiteral: false`, `isStringLiteralLike: true`. Separately, expansions that don't go through `.map` at all — `Array(n).fill("?").join(",")`, `"?,".repeat(n)`, numbered `?1` construction — are invisible to `placeholderSites`, which only visits `.map` calls. The plan's guard contract is verbatim: "It must fail on a new direct placeholder expansion, a new ID-set bulk writer that bypasses the helper…". A one-token style difference (backtick vs quote) defeating the guard is exactly the regression class this audit exists to close, especially in a codebase built largely by LLM agents whose quoting style varies.
**Fix:** (1) Replace both `ts.isStringLiteral` checks in `returnsQuestionMark` with `ts.isStringLiteralLike` (covers `NoSubstitutionTemplateLiteral`; the existing 12-site allowlist is unaffected since no template-literal sites exist today). (2) Add a complementary sweep that fails or surfaces as `UNCLASSIFIED` any call to `.fill`/`.repeat` whose argument is a string-literal-like `"?"` (or containing `?`,), so non-map expansion idioms force reclassification rather than passing silently.

**[MINOR] tests/node/bulk-paths.AC-66-69.test.mjs:178 — Classification misstates where the admin-notify bound lives**
The `handlePublicSubmission` entry says "bounded by admin_notify_person_ids.max(100) on the public-form schema." The `.max(100)` actually lives on the form create/update schema (`src/routes/forms.routes.ts:137`); the public submission path reads the stored JSON column with no bound of its own, and the bound holds only transitively (the sessionize import, the other writer of that column, hardcodes `'[]'`). The provenance matters: a future writer to `forms.admin_notify_person_ids` (e.g., import mapping admin IDs) would silently void this classification without failing the guard.
**Fix:** Reword the classification to name the real enforcement point ("bounded at form create/update by forms.routes.ts admin_notify_person_ids.max(100); import writes '[]'"), so a future auditor checks the right invariant.

**[MINOR] tests/node/bulk-paths.AC-66-69.test.mjs:264 — Asymmetric sort keys between observed and expected inventories**
Observed sites are sorted by `JSON.stringify` of `{file, owner, binding, expression}` (line 127, before classification is attached), while `EXPECTED_PLACEHOLDER_SITES` is sorted with `classification` included in the string (line 273). Orderings agree today because no two sites share all four key fields, but two textually identical sites in one function (a legal future state — same binding name in sibling blocks) would make ordering ambiguous and the first-match `.find` at line 266 would assign both the same classification.
**Fix:** Sort both arrays by the same `{file, owner, binding, expression}` tuple, and assert the expected list has no duplicate tuples.

## 4. Positive Observations

- **The inventory is genuinely complete.** An independent repo-wide sweep for the placeholder idiom found exactly the 12 sites in `EXPECTED_PLACEHOLDER_SITES` — nothing missed, nothing padded. The `runBulkByIds` caller allowlist (`src/jobs/cascade/decisions.ts`, `src/routes/evaluation.routes.ts`) also matches source exactly, and the recursion check on the helper definition is a nice touch.
- **The NAMED_FINDINGs are real, verified hazards, honestly routed.** `distributeAssignments` (`src/routes/evaluation.routes.ts:699`) binds `1 + N` parameters against an uncapped `submission_ids: z.array(...).min(1).optional()` schema (line 68) — a genuine D1 100-binding blowup at scale — and the guard additionally pins that schema shape with a dedicated regex so a silent bound change forces re-audit. Routing these as findings rather than fixing them respects the fast-track audit's non-goals precisely.
- **Positive controls prevent vacuous passes.** The named-scope assertions (decision cascade, comms, `json_each(?)` in `recipientsFor`, promote-round through `runBulkByIds`, import speaker/session) mean an empty or dead inventory cannot pass — exactly what the plan demanded.
- **Coordinate-free by construction.** The guard asserts file/owner/binding/expression identity, never line numbers, and the second commit's move from a regex to a real AST walk (with owner and hoisted-binding attribution) was the right response to the prior review cycle.
- **Clean integration.** The `typescript-ast` npm alias (`npm:typescript@^5.9.3`) sidesteps the pinned `typescript@^7` toolchain without disturbing it; the manifest follows the established ac-claims shape with an honest `owns: []` (ownership stays with MRQ-19/MRQ-12, matching `MRQ-19.json`); `npm test` passes hermetically at 16.5s of the 30s budget and `trace:ac --ticket MRQ-52` runs clean.
