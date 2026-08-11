# Code Review: MRQ-51 — Reviewer event and track isolation audit (A-9)

**Reviewed:** branch `mrq-51-audit-isolation` at `2022071` (identical to `forgejo/mrq-51-audit-isolation`), 3 commits, 6 files, +757/−14 against `master` (`7b1db18`).

> Note on the prompt diff: the diff embedded in this review prompt was generated against a stale base — it includes `.lattice` bookkeeping and already-merged MRQ-41/49/50 work, and was truncated at 5,000 lines. This review is against the actual branch delta, which is small and fully inspectable: one 2-line product change (`src/lib/auth/auth-middleware.ts`), one new runtime isolation suite, one new AST guard, and three extended existing test files.

## 1. Verdict

**PASS**

## 2. Summary

The audit delivers exactly what the plan (including both authoritative plan-review cycles) authorized: a single product change closing the cookie/bearer authority mismatch — the cookie session loader now uses the same org-filtered membership loader as bearer credentials (`loadMembershipsForOrg(db, person.id, person.org_id)`) — plus a 393-line runtime isolation proof, a 241-line AST machine guard, and parity/fixture extensions to three existing suites. I independently verified the proof is **non-vacuous**: reverting the one-line fix makes both the credential-resolver parity test and the reviewer-isolation suite fail; with the fix, all 4 touched integration suites (17 tests), the node guard, and the full default suite pass hermetically in 19.2s (within the 30s budget). No other authority layer was touched, no claims file was added — both explicit Cycle-2 constraints honored.

## 3. Issues

**[MINOR] src/lib/auth/scope-resolution.ts:115 — `loadMemberships` is now dead code**
After the fix, `loadMemberships` has no callers anywhere in `src/` or `tests/` — only `loadMembershipsForOrg` is used. A dangling unfiltered membership loader is exactly the kind of footgun a future route author reaches for by accident. The AST guard only pins the two call sites inside `auth-middleware.ts`; it would not catch a new caller elsewhere.
**Fix:** Delete the `loadMemberships` export (a trivially safe cleanup this audit could carry), or extend the guard to assert zero `loadMemberships` call sites across `src/`.

**[MINOR] tests/node/reviewer-boundary.AC-214-246.test.mjs:~200 — evidence-insert inventory is order-sensitive**
`assert.deepEqual(evidenceInserts.map(...), [...])` depends on `readdir(..., { recursive: true })` sort order and on line order within files. This is intentional tripwire brittleness (any new `INSERT INTO evaluations|comparisons` must be consciously enrolled), which is correct for an audit guard — but a legitimate refactor that merely moves an insert within the same file will fail with a confusing diff rather than a named message like the route-guard assertions have.
**Fix (optional):** Sort the collected inserts by `[table, file]` before comparing, or add a short assertion message explaining the enrollment contract, matching the style of `"unreviewed reviewer operation ..."`.

No critical or major issues found. Specifically checked and clean:
- **Security:** the product change strictly *narrows* authority (cookie sessions lose cross-org membership rows; nothing gains access). All fixture SQL uses bound parameters; the two template-literal interpolations in queries (`count(table)`, `IN (${placeholders})`) draw only from a TypeScript union literal and generated `?` placeholders. 403 bodies are byte-checked against submission IDs, titles, and filenames — the "no metadata" half of the AC-214 probe is genuinely asserted, not just the status code.
- **Correctness of the fix against the malformed-row probe:** the fixture plants a membership whose `org_id` (`org-reviewer-other`) disagrees with both the person's org and the event's org; with the fix, the cookie path drops it and Event C returns 403 with no metadata and no assignment-row drift. The bearer parity token (org_1, `event_ids: [A, B]`) confirms both credential kinds now agree.
- **Cycle-2 constraints:** membership CHECK, `authorizeReviewerScope`, `reviewerCanBeAssignedToSubmission`, and category-routing product code are all untouched; no empty AC claims file exists in the diff.

## 4. Positive Observations

- **The proof was empirically validated as a proof.** This is the rare audit ticket where the tests demonstrably detect the bug they claim to guard: reverting `auth-middleware.ts` to `loadMemberships` fails `credential-resolver.test.ts` ("cookie and bearer credentials agree...") and `reviewer-isolation.AC-214-246.test.ts` ("every reviewer read surface is event- and track-bound"). I ran this revert-and-rerun myself.
- **Positive controls everywhere, per the plan.** Every denied surface is paired with an authorized control that succeeds and reads/writes the expected row (queue contents, record, files, export CSV, evaluation +1, comparison +1 with assignment status flipped to `complete`, assignment distribution 201). The denials cannot pass vacuously.
- **Denied writes assert both row counts and assignment snapshots unchanged**, across both rounds (scorecard and comparison modes), both denial dimensions (out-of-event and in-event/out-of-track), and the MRQ-35 automatic routing path — where the new "Non-vendor other-event reviewer" trap rule proves routing refuses a committee whose member is scoped to another event, without leaking the committee or reviewer IDs in the 422 body and without creating people/submissions/outbox rows.
- **The AST guard is a genuine authority-path tripwire**, modeled faithfully on the existing `tests/node/` inventories (`typescript-ast` aliased dependency, same walk/parse idioms): it pins the 8-route reviewer inventory to `review.routes.ts` alone, maps each operation to its named guard, requires `authorizeReviewerScope` inside all three queue helpers, pins every `round_assignments` / `evaluations` / `comparisons` insert site, enforces guard-before-write ordering in public-form routing, and — the sharp part — asserts *both* membership loads in `auth-middleware.ts` are the org-filtered form with the exact argument shapes, so the cookie fix cannot silently regress.
- **Fixture honesty:** aligning the hand-built `people` table in `submissions-list.test.ts` with the real migration's `org_id NOT NULL` keeps the local-schema fixture from drifting into a shape the product no longer accepts.
- **Speed discipline held:** the full default suite remains hermetic at 19.2s against the 30s budget despite ~640 new test lines.
