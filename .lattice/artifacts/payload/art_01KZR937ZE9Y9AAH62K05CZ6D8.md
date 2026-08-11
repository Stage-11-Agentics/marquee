# Code Review: MRQ-52 — Audit: bulk-write path and chunking

Reviewed at HEAD `5213ab7` on `mrq-52-audit-bulk` (3 commits ahead of `forgejo/master`; branch diff is exactly the two files in the review diff — `typescript-ast` was already a master dependency, not smuggled in here).

## 1. Verdict

**PASS**

## 2. Summary

The diff adds a semantic AST source guard (`tests/node/bulk-paths.AC-66-69.test.mjs`) that inventories every D1 placeholder-expansion site in `src/`, pins the `runBulkByIds` caller set, and classifies each site — plus an AC-claims manifest that correctly owns nothing. I verified the guard empirically, not just by reading: it passes green on HEAD (~0.5s; full suite 67/67 in ~15s, inside the 30s budget), and when I planted a scratch file containing a fresh `ids.map(() => "?")` bypass, the guard failed with the intended "inventory changed; classify and re-audit" assertion. The inventory's factual claims all spot-checked true against source, the two NAMED_FINDINGs are real routed defects (with runtime confirmation of the assignment-path HTTP 500 at 150 IDs in the attached self-review artifact), and `trace:ac` passes with the ownership claims matching MRQ-19 and MRQ-12's manifests. Remaining issues are minor hardening gaps in the detector itself.

Verified facts behind the classifications:
- `distributeAssignments` (`src/routes/evaluation.routes.ts:68,698-699`): `submission_ids` is `.min(1).optional()` with **no max** and expands one placeholder per ID — NAMED_FINDING is accurate, and the self-review artifact records a real local Worker drive returning HTTP 500 at 150 seeded IDs with row counts unchanged.
- `handlePublicSubmission` admins query (`src/routes/public-form.routes.ts:645`) binds *only* the admin IDs, and `admin_notify_person_ids` is capped at `.max(100)` (`forms.routes.ts:137`) — exactly at, not over, D1's 100-binding cap. Classification "bounded" is correct.
- `tokens.routes.ts`: `event_ids.max(100)` plus the org binding can indeed reach 101 bindings — the "routed observation" text is arithmetically right.
- `runBulkByIds` callers are exactly `src/jobs/cascade/decisions.ts` and `src/routes/evaluation.routes.ts`, matching the pinned list.
- MRQ-19 owns AC-66–69 and MRQ-12 owns AC-117, exactly as the manifest's notes state; `npm run trace:ac -- --ticket MRQ-52` passes with 0 uncovered.

## 3. Issues

**[minor] tests/node/bulk-paths.AC-66-69.test.mjs:97,156 — Detector idiom coverage is narrower than its `repeat` branch**
`isQuestionMarkLiteral` requires the string to be exactly `"?"`, and the `fill` branch reuses it, while the `repeat` branch accepts any receiver matching `/\?/`. A future writer using `ids.map(() => "?,")`, `.map(() => "(?)")` (both plausible join idioms), or `Array.from({ length: n }, () => "?")` slips past both the map detector (exact-match / method-name `map` only) and the non-map sweep. The guard is explicitly best-effort and the allowlist deepEqual gives strong protection for the covered idioms, but the asymmetry is an easy tightening.
**Fix:** Match callback returns and `fill` arguments with `/\?/` (as `repeat` already does), and treat `Array.from` with a placeholder-returning callback the same as `.map`.

**[minor] tests/node/bulk-paths.AC-66-69.test.mjs:25-38 — `namedScope` silently keeps the last match**
`walk` assigns `match` on every hit, so if a module ever contains two same-named declarations (a local shadow, an overload set, a nested helper reusing the name), the guard audits whichever appears last, with no error. For a guard whose value is loud failure, silent selection is the wrong default.
**Fix:** Collect matches into an array and `assert.equal(matches.length, 1, ...)` before returning the text.

**[minor] tests/node/bulk-paths.AC-66-69.test.mjs:166 — Dead `classification: "UNCLASSIFIED"` property on non-map sites**
`nonMapPlaceholderSites` stamps every site `"UNCLASSIFIED"` but the result is hard-asserted `deepEqual []`, so the property can never carry information, and the failure message's "classify … before changing this allowlist" points at an allowlist that doesn't exist for this branch — a legitimate future `fill("?")` use requires editing the detector function itself.
**Fix:** Either drop the property and reword the message ("add it to a non-map allowlist" → introduce one), or route non-map sites through the same `EXPECTED_PLACEHOLDER_SITES` mechanism.

**[minor] tests/node/bulk-paths.AC-66-69.test.mjs — repeated `createSourceFile` parses**
Each module is parsed by `placeholderSites`, again by `nonMapPlaceholderSites`, again per `callsNamed` sweep, and once more per `namedScope` call. Runtime is ~0.5s today so this is well inside the fast-suite contract; noted only so it doesn't grow unbounded as the guard accretes checks.
**Fix (optional):** Parse once per module into a cached `SourceFile` and pass it to the helpers.

**Scope note (not a diff defect):** the plan's full runtime matrix — 150/1,000 bulk-accept drives, idempotency double-fire counts, AC-69 durable-completion vectors, empty-selection before/after counts — is Lattice-evidence, not repo files, by design ("Shared files: none — audit artifact only"). The attached self-review artifact at HEAD covers the assignment-path 150-ID drive (HTTP 500, counts unchanged) and the routing path at its 8-category cardinality; the remaining drive vectors must be attached during `in_validation` before `pr_open`. The Orchestrator should hold that gate — this review covers the diff and cannot certify evidence that isn't attached yet.

## 4. Positive Observations

- **The guard has verified teeth.** I planted a scratch bypass file and the test failed with the exact intended message, then passed again after removal. That's the property that matters most in an audit artifact, and it's real, not aspirational.
- **Positive controls are genuinely non-vacuous.** The contract test asserts named scopes exist *and* contain their expected call edges (`bulkDecideSubmissions → writeBulkSubmissionDecisions`, `sendComms → recipientsFor → json_each(?)`, `promoteRound → runBulkByIds`), so a dead or empty inventory cannot pass — exactly what the plan's step 1 demanded.
- **Identity is semantic, not positional.** Sites are keyed by file/owner/binding/expression, so the guard survives unrelated refactors and line churn while still failing on idiom drift — including quiet *removal* of a known site, which forces re-audit rather than silent shrinkage.
- **The duplicate-identity-key self-check (line ~474)** protects the allowlist's own integrity — a nice touch that prevents the deepEqual from being weakened by an ambiguous expected list.
- **Classifications carry their reasoning.** Each allowlist entry states *why* it's safe (which schema bound, which taxonomy) or *why* it's a finding, making the next auditor's job a diff of claims against source rather than an archaeology dig. Every claim I checked was accurate, including the subtle at-the-cap-vs-over-the-cap distinction between the admins query (100 bindings, safe) and the tokens query (101, flagged).
- **AC hygiene is exemplary for a fast-track audit:** `owns: []`, exercises only what evidence touches, names the real owners, and `trace:ac` confirms no collision.
