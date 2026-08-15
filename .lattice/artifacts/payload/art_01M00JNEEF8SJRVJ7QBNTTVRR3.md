# Plan Review: MRQ-200

## 1. Verdict

**PASS** — Plan is complete, feasible, and aligned. Implementation can proceed. The issues below are refinements the implementer should absorb, not gaps requiring a return to planning. The one major issue (live-list `member_count` vs. the "one query" acceptance) is a design decision the plan leaves undiscovered; it is resolvable inline but should be decided deliberately, not stumbled into.

## 2. Summary

Reviewed the MRQ-200 implementation plan against the four review follow-ups from PR #224 and against the actual code (`person-lists.routes.ts`, `people.routes.ts`, `people.queries.ts`, `components.css:135`, `evaluation.css`, `PeoplePage.tsx`, the MRQ-131 tripwire test — all claims in the task description check out, with one stale file path noted below). The plan is well-decomposed, covers all four items and their acceptance criteria, names the correct gate scripts, and honors the repo's no-deploy freeze and merge-after-review contract. The key concern is that the plan copies item 1's field list without engaging the live/fixed list distinction that makes "one query" nontrivial for live lists.

## 3. Issues

**[MAJOR] Work unit 1 — live-list `member_count` conflicts silently with the "one query" acceptance**
The task's first acceptance criterion is "Resolving one list for display costs one query and returns no member rows." For a **fixed** list this falls out of the existing `LIST_SELECT`, whose correlated subquery already computes `member_count` in one statement. For a **live** list, `member_count` today comes from `liveCount()` (`person-lists.routes.ts:90-94`) — a *second* query that compiles the saved filter through `buildPeopleQuery` and runs its `countSql`. The plan specifies the projection's exact field list including `member_count` but never mentions the live/fixed distinction, so the implementer will hit this mid-flight with no recorded intent. Options differ meaningfully: batch both statements in one D1 round trip, compose the filter-count into the SELECT, or decide the band's display doesn't need a live count at single-query cost.
**Recommendation:** Add one sentence to work unit 1 deciding how a live list's `member_count` is produced within the acceptance's cost budget (a single `db.batch` round trip is a defensible reading of "one query"; say so explicitly so the reviewer of the PR can hold the line that was intended).

**[MINOR] Work unit 1 — the projection's API surface shape is undecided**
"Add a members-free single-list projection" could be a new route, a query parameter on `GET /org/lists/{listId}` (e.g. `?members=false`), or a change to `openList`'s response shape. These have different OpenAPI/registry/gate consequences, and the last is a breaking change for the Lists page, which uses `openList` precisely to show members. The plan lists the files to inspect but not which shape it intends.
**Recommendation:** Name the chosen surface in the plan (a sibling summary route or a query flag both preserve `openList`'s contract; changing its 200 shape should be explicitly ruled out).

**[MINOR] Work unit 4 — the task's cheaper acceptable outcome is dropped**
The task's acceptance for facet counts is explicitly disjunctive: counts reflect the in-view population, **or** "the panel says plainly that they do not. Either is honest." The plan pursues only the computed-counts branch, with split-out-to-a-new-ticket as the fallback. The honest-label branch is the sanctioned cheap resolution and should sit between those two — it satisfies the acceptance without a query redesign and without deferring the item entirely.
**Recommendation:** Add the label option as the intermediate fallback: attempt scoped counts; if that isn't a clean change, ship the honest label in MRQ-200 and split the scoped-counts work out.

**[MINOR] Task description carries a stale path the plan should not inherit**
The task cites `src/styles/evaluation.css:136` and `:14`; the file actually lives at `src/ui/evaluation/evaluation.css` (both cited rules verified there: `.scope-check input` at :136, `.round-toggle input` at :14). `EvaluationPage.tsx` line references are also off by one (954/989, not 953/988). The plan's "enumerate every `.field` usage before editing" covers this in practice, but a fresh implementer grepping `src/styles/` for the hand-patches will come up empty and may conclude they were already removed.
**Recommendation:** Note the corrected path in the plan or ticket comment. Also preserve the plan's existing nuance when removing patches: `.round-toggle input { flex: none; margin: 0; }` is only partially an undo of the shared overreach — `margin: 0` may be doing independent work and needs the browser check the plan already mandates.

**[MINOR] Work unit 2 — per-assertion base-failure verification is heavier than the payoff**
Proving each new assertion fails on the base commit is good discipline, but the plan requires it per assertion, in a fresh detached scratch worktree, for every work unit — item 4 alone lists five behaviors. One scratch worktree per work unit, running the new test file once against base, gives the same signal at a fifth of the ceremony. Also, per repo rules, any scratch worktree must be cut from `github/main` (never local `main`), and `git stash` is forbidden repo-wide — worth restating in the plan since this is the step most likely to tempt both.
**Recommendation:** Batch base-failure verification per work unit; add "cut from `github/main`, no stash" to the scratch-worktree step.

## 4. Positive Observations

- **Correct decomposition.** Items 1+2 as one touch on the list-scope seam, item 3 independent, item 4 with an explicit split-out guard — exactly the grouping the task's own notes prescribe, with a concrete anti-scope-creep tripcord ("stop this work unit and create/link a separate ticket rather than smuggling a broad redesign into MRQ-200").
- **The tripwire test is handled in the right order.** "Remove or restate the old index-completeness tripwire *only after* the band no longer depends on the list index" sequences the guard's retirement behind the thing that makes it obsolete, which is the only safe order.
- **Verification matches how the original bug was found.** Real-browser Playwright inspection of the Evaluation checkboxes and the People band honors the task's warning that "the bug that started this was invisible to a green suite and obvious on screen," and the 1440x900 viewport and post-change `.field` re-enumeration are concrete rather than aspirational.
- **Gate literacy is exact.** The named scripts (`check:design`, `check:api`, `check:routes`, `check:schema`, `trace:ac`, `pr-gate -- --ticket`) all exist under those names, and the plan reads suite statuses correctly (`fail` blocking, `pass-over-budget` a warning, `timeout` unknown-and-rerun) instead of treating wall clock as a verdict.
- **Repo contract awareness.** No-deploy and the freeze respected, merge-after-external-review stated as the implementer's own responsibility, OpenAPI/registry updates bundled with the 404 change rather than discovered by the gate, and empty-list-200 vs. unknown-list-404 correctly distinguished — including that an empty *live* list (filter matching nobody) must remain a 200.
