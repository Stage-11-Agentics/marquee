# Plan Review: MRQ-17

## 1. Verdict

**FAIL (plan-level)**

## 2. Summary

The plan for MRQ-17 (BUILDPLAN M-16 — evaluation plan, committees, and reviewer track scopes) is well-structured on authorization, schema, and test-traceability discipline, but its "Data and authorization core" step 2 commits to implementing "the reviewer queue, submission detail, file metadata, export, and evaluation-write endpoints" inside `evaluation.routes.ts`. Those are not this ticket's routes — BUILDPLAN.md and SPEC.md both assign them to `src/routes/review.routes.ts`, owned by the separate, currently-backlog ticket **MRQ-18 ("Reviewer queue", BUILDPLAN M-17, 9h, depends on M-16)**. Building them here duplicates MRQ-18's future work, blows the declared file surface and the 7h budget, and risks a route-manifest collision when MRQ-18 lands its own implementation of the same endpoints. The plan must return to planning to strip this scope back to what M-16 actually owns.

## 3. Issues

**[CRITICAL] "Data and authorization core," step 2 — Plan builds MRQ-18's reviewer-facing routes inside this ticket**

Step 2 reads: *"Implement typed admin plan/round/criterion/committee/scope/assignment endpoints **and the reviewer queue, submission detail, file metadata, export, and evaluation-write endpoints** required by the contract. Every reviewer endpoint will call the helper directly…"*

This is not M-16's scope. Cross-checking the project's own contract documents:

- `BUILDPLAN.md:76` (M-16, this ticket): file surface is `src/routes/evaluation.routes.ts`, `src/lib/reviewer-scope.ts`, `src/ui/evaluation/*` — no `review.routes.ts`.
- `BUILDPLAN.md:77` (M-17 = **MRQ-18**, "Reviewer queue," `.lattice/tasks/task_01KZJHM91S8KRZST6J185QK1K3.json`, `short_id: MRQ-18`, currently `status: backlog`): file surface is `src/routes/review.routes.ts`, `src/ui/review/*`, 9h, **Deps: M-16**. Its scope is verbatim "queue constrained by track intersection; one card opens full evaluator-visible fields/files…; `GET /rounds/:id/export?format=csv` ships…; detail/file/export/write routes all use M-16's helper." Its "Shared files" line: *"none owned — consumes `src/lib/reviewer-scope.ts` (M-16's) on every route including the export."*
- `SPEC.md:371` lists the reviewer-scope route group (`GET /rounds/:id/queue`, submission detail, files, evaluations, comparisons, abstain, export) separately from `SPEC.md:382`'s Evaluation admin route group (`/plans`, `/plans/:id/rounds`, `/rounds/:id/criteria`, `/committees`, `/committees/:id/reviewers/:personId/tracks`, `/rounds/:id/assignments`, `/rounds/:id/promote`) — two distinct groups mapping 1:1 onto the M-16/M-17 file-surface split.
- The plan's own "Shared files" line (copied from the task description) says `reviewer-scope.ts` is "created here, **added to, never rewritten** by M-17" — i.e., MRQ-18 is expected to build atop the helper, not have its routes pre-built by MRQ-17.
- The plan's own Tests section explicitly instructs: *"Do not claim downstream reviewer-queue ACs owned by MRQ-18"* — proving the plan author knows AC-59–65/244–245 (the reviewer-queue ACs) belong to MRQ-18, yet step 2 still plans to build the routes those ACs exercise.

Consequences if built as planned: (1) MRQ-18, when it lands `review.routes.ts` implementing the same `GET /rounds/:id/queue` / detail / file / export / evaluation-write endpoints per its own contract, will either collide with duplicate route registrations (breaking `check:api`'s route-manifest-parity assertion, which fails on any path drift) or require MRQ-18 to delete/rewrite work this ticket just built — wasted effort either way, on a dependent ticket that hasn't started; (2) the 7h budget for M-16 does not remotely cover implementing MRQ-18's 9h scope on top of its own; (3) A-9 (`.lattice audit "Reviewer event+track isolation"`) is explicitly scheduled to start "**From CP-2 (M-16/M-17 landed)**" — i.e., the full cross-route helper scan is designed to run once *both* tickets exist, not be pre-empted by MRQ-17 alone.

**Recommendation:** Narrow step 2 to only the admin-facing endpoints SPEC.md §4.2 assigns to the Evaluation route group (plan/round/criterion CRUD, committee CRUD, `/committees/:id/reviewers/:personId/tracks` scope edits, assignment distribution). Drop "the reviewer queue, submission detail, file metadata, export, and evaluation-write endpoints" from this ticket entirely — they are MRQ-18's. Correspondingly scope the AC-246 test in this PR to what M-16 actually builds (the helper's unit behavior + the admin scope-edit route calling it), rather than a route-scan across queue/detail/file/export/write routes that won't exist until MRQ-18 lands; leave the full cross-ticket route-scan to A-9, consistent with its documented CP-2 start trigger.

**[MINOR] "Tests and AC traceability" — route-scan assertion is vacuous at MRQ-17 build time even if left as written**

Independent of the scope-creep issue above: if `evaluation.routes.ts` does *not* build the reviewer-facing routes (the correct outcome), then the plan's instruction to "keep the route-scan assertion in the AC-246 integration test: every queue/detail/file/export/evaluation-write route must import/invoke the same helper" will find zero such routes in this PR's codebase and pass trivially — proving nothing. As currently worded the plan doesn't distinguish between "the helper-invocation scan we can meaningfully run today" (admin scope-edit route only) and "the full scan A-9 owns after MRQ-18 lands."

**Recommendation:** Rewrite the AC-246 test description to scan only the routes this ticket actually registers, and note explicitly (in the plan and in the completion comment) that the full multi-route scan is A-9's responsibility post-MRQ-18, so a future reader doesn't mistake a narrow, currently-passing test for the complete AC-246 guarantee.

No other issues found — see Positive Observations below for what the rest of the plan gets right.

## 4. Positive Observations

- **Authorization design is sound and appropriately conservative.** The helper's fail-closed behavior, its refusal to leak identity/submission metadata on a 403, and its explicit non-duplication of route-local predicates match the binding requirement in the task description almost verbatim.
- **Non-goal discipline.** The plan correctly declines to build third-round UI/migration work, correctly limits itself to "promotion preview" data rather than the actual promote action (which `BUILDPLAN.md`'s M-27 "Two-round funnel" ticket owns via `POST /rounds/:id/promote`, AC-99) — a boundary it gets right even though it gets the M-17/MRQ-18 boundary wrong.
- **Schema risk correctly identified and resolved.** The "Known risks" section correctly notes `committee_members` has no explicit `event_id` column and commits to deriving committee ownership through the `committees → event` relationship rather than inventing a schema change — verified against `migrations/0001_init.sql:474-489`, which confirms `committee_members` indeed lacks an `event_id` column while `committees` carries one.
- **Good AC-claims hygiene.** The plan explicitly enumerates the exact AC set to claim and explicitly calls out *not* claiming MRQ-18's ACs — the right instinct, just not carried through consistently into the routes it plans to build.
- **Verification and handoff steps are thorough and match project convention** (focused tests, `npm test`, `check:api`, `trace:ac --scope=merged`, `check:design`, self-review artifact, `pr-gate`, worktree-root guard, remote HEAD verification) — no gaps here relative to how other merged MRQ tickets in this repo have operated.
