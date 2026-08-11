# Plan Review: MRQ-29 — Quick search

## 1. Verdict

**PASS** — Plan is complete, feasible, and aligned. Implementation can proceed. The four issues below are minor and can be resolved inside the implementation pass under the plan's own `## Plan-Review Cycle K Resolutions` block; none requires returning to `in_planning`.

## 2. Summary

Reviewed the MRQ-29 plan (AC-101–AC-104, quick search in the shared admin shell) against the task description, EVALUATION.md/SPEC.md/USER_STORIES.md, and the live codebase. The plan is verified-accurate on every load-bearing claim I checked: `src/ui/shell/Topbar.tsx` exists with an `openSearch` placeholder ready to be wired, `route-table.ts` provides the manifest AC-101 iterates, `search_blob` and event indexes already exist (no migration needed, as claimed), `requireSubmissionRead` exists in `src/lib/auth/program-access.ts`, the `global-search-painted` budget id is registered in `scripts/checks/speed-budgets.mjs` with the honest API-timing placeholder in `speed.ts:282` the plan proposes to replace, MRQ-23 only *exercises* AC-103 so ownership is clean, and the `*.routes.ts` manifest convention is real. The key residual concern is the Speaker-result landing target: `/onboarding?person=` currently renders the shell's placeholder because MRQ-24 (chase board) is still `planned`, and the plan's live validation quietly omits Speaker selection.

## 3. Issues

**[MINOR] Approach §3 / Verification — Speaker results land on a placeholder route until MRQ-24 merges**
The plan routes Speaker results to `/onboarding?person=<id>`. The route table defines `/onboarding`, but MRQ-24 (chase board) is still in `planned` status, so that route today renders AppShell's honest EmptyState — not a record. AC-104's oracle is "selecting a result lands on the record," and the walkthrough rule is zero dead ends. The plan documents this as a handoff dependency (correctly), but its live-validation step selects only "an Abstract/Session/Form result," which sidesteps rather than surfaces the gap.
**Recommendation:** At `in_validation` time, check MRQ-24's merge status. If merged, add a Speaker selection to the live validation. If not, explicitly record in the Lattice completion comment that Speaker hrefs are contract-correct but land on the placeholder pending MRQ-24, so the master validator reads it as a documented handoff rather than a dead end. The API test should still assert Speaker href shape either way.

**[MINOR] Approach §4 — the "ten existing terms" may not actually include misspellings**
The plan reuses the existing `speed.ts` term list and parenthetically asserts it includes misspellings. Inspecting the list (`"agent", "Casey", "RAG", "zzzz-no-match", "Leadership", "Marriott", "Aïcha", "session", "xq-19", "workshop"`), it contains a no-match probe and a diacritic case but no obvious misspelled variant of a seeded name or title. EVALUATION.md's AC-103 row requires "≥10 queries incl. misspellings," and AC-104 separately requires a fixture of partial *and misspelled* seeded names.
**Recommendation:** Audit the term list against the seed data during implementation; add or substitute genuine misspellings of seeded names/titles (keeping ≥10 samples) rather than inheriting the assertion. The AC-104 fixture should share or derive from the same misspelled set.

**[MINOR] Acceptance mapping — AC-101's "route-table-wide static contract" should literally iterate the route manifest**
EVALUATION.md's AC-101 oracle says "iterate every admin route in the route manifest," and the task description bolds **every**. The plan's phrase "route-table-wide static contract" is compatible with that but also with a weaker test that merely asserts one `QuickSearch` mount exists in `AppShell`. The route table also contains entries that are not admin screens (`external: true` portal/event-site rows, `/api/docs`), so "every admin route" needs a stated filter.
**Recommendation:** Have the Node test enumerate `routeTable` entries, assert each admin route renders through the single shared mount, and encode the exclusion rule for external/non-admin entries in the test with a one-line rationale — matching the plan's own note that AC-101 applies to the admin route table mounted by AppShell.

**[MINOR] Approach §3/§4 — debounce strategy is unstated but directly determines whether AC-103 passes**
The budget is keystroke → results painted, p95 ≤ 200 ms. A conventional 150–300 ms input debounce would consume or blow the entire budget before the request even fires. The plan specifies an abortable request per query but never states whether input is debounced or which keystroke starts the clock.
**Recommendation:** State the policy explicitly during implementation: no debounce (or ≤ 50 ms) with per-query abort as the coalescing mechanism, and define the harness timer as starting at the final keystroke of each term. This also protects the "results update as typed" clause of AC-103.

## 4. Positive Observations

- **The plan is verified against the tree, not imagined.** Every concrete claim I spot-checked held: file inventory (including `Topbar.tsx` and `route-table.ts`, which a lazier plan would have missed since the shell also has undocumented files), the existing `search_blob` column and its write paths, the `global-search-painted` budget id and its honest placeholder caveat, the `*.routes.ts` → `_manifest.ts`/`check:api` parity requirement, and MRQ-23's exercises-not-owns relationship to AC-103. The "no migration needed" call is correct and saves scope.
- **The AC-103 replacement is exactly right.** The current sample is an API timing with an explicit disclaimer that it is not a paint claim; the plan replaces it with a real keystroke-to-painted browser measurement while keeping the budget id and classifier so `check:speed` gates it — honoring the project's speed-as-graded-feature rule instead of relabeling the API number.
- **Shell discipline is respected.** Mounting once from `AppShell` beside the existing topbar, wiring the already-present `openSearch` placeholder, additive scoped CSS, and no per-screen search code precisely matches the task's "in M-05a's shell, not bolted onto individual screens" constraint and minimizes conflict surface with the concurrently dispatched MRQ-28/MRQ-32 shell-adjacent work.
- **Security thinking is present at plan level:** event scoping, form-admin restriction to assigned forms, and leakage controls (asserting both status *and* absence of ids/titles, with an authorized positive control) are named before implementation begins.
- **Risks and non-goals are honest** — the MRQ-24 handoff is declared rather than hidden, and the plan explicitly refuses to pull a second module into the ticket to resolve it.
