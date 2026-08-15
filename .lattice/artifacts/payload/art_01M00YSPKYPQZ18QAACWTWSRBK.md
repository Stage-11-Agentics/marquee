# Plan Review: MRQ-203 — Sidebar reorg fold

## 1. Verdict

**FAIL (plan-level)** — The submitted plan is a verbatim copy of the task description with a title on top. It contains no planning work: no file-level breakdown, no sequencing, no test mapping, no resolved decision points. The task should return to `in_planning`.

## 2. Summary

Reviewed the MRQ-203 plan (`.lattice/plans/task_01M00Y2ZC6EKQX3BEA1SVN8K9H.md`, 1.5 KB) against the task description and the authoritative scope document, `sequence/sidebar-fold-tickets.md` §T1. The description itself is excellent — dense, traceable, with acceptance sketches — but the plan restates it word-for-word and adds zero information. A plan for a ticket this wide (nav restructure + new flyout component + `/lists` relocation + a layout change touching every admin page) must demonstrate the planner has read the actual code and made the open decisions; this one demonstrates neither.

## 3. Issues

**[CRITICAL] Entire plan — The plan is the task description, copied**
Byte-for-byte, the plan body is the task description's summary paragraph. None of the review checklist can be meaningfully evaluated because there is no proposed approach to evaluate: no statement of which files change and how, no order of operations, no test strategy, no decisions on the forks the scope document deliberately leaves open. Approving this would move an unplanned ticket into implementation, which is precisely what this gate exists to prevent.
**Recommendation:** Return to `in_planning`. The plan should be written *after* reading `src/ui/shell/route-table.ts`, `Sidebar.tsx`, `register.ts`, the People screen, and the three prototypes — and should be reviewable as a diff against the description: everything in it that isn't in the description is the plan.

**[MAJOR] Missing — File inventory and sequencing**
§T1 spans at least: `route-table.ts` (regroup, renames, comment rewrite), `Sidebar.tsx` (group labels, icon column, picker label/eyebrow/6px gap, `+` affordance with stopPropagation), `register.ts` (navLabels rework, `zeroPadNavIcons`, audit of all three registers), a **new** stage-flyout component in `src/ui/shell/`, the People CRM screen (`/lists` as a tab, toolbar Lists entrance, URL compatibility), and a shared centered `.page` column rule. These have real ordering constraints (route-table ids drive navLabels keys drive register audit; the flyout consumes the dashboard snapshot the strip already uses). The plan names none of this.
**Recommendation:** Enumerate the files to be modified/created and the order, with the route-table id scheme decided first since everything downstream keys off it.

**[MAJOR] Missing — Test plan mapped to the acceptance sketch**
§T1's acceptance sketch is unusually concrete: snapshot test on `routesFor` output per group; a route-table completeness test (no existing route loses reachability); flyout opens on hover/focus with counts matching the dashboard snapshot, closes on stage click, absent under 1000px; `/lists` renders inside People with the People row active; register themes render without referencing removed ids. The plan doesn't say which of these become automated tests, where they live, or how they fit the 45s suite budget.
**Recommendation:** Map each acceptance-sketch item to a named test (file + approach), and state which are covered by tests vs. by the visual/computer-use pass. The route-reachability test deserves special care — it's the guard against the classic failure of this ticket (a row quietly dropped in the regroup).

**[MAJOR] Missing — Blast-radius plan for the centered page column**
"One centered content column shared by every admin page (max-width ~1500px, margin auto)" is a global layout change, and it's the part of the ticket most likely to regress surfaces that assume full width — the Program board's horizontal column scroll, wide CRM tables, the agenda grid. The plan neither enumerates the admin pages affected nor proposes how each will be verified.
**Recommendation:** List the admin pages, identify which currently implement their own width/centering (the prototype found crm pinned left, pipeline centered — so at least two divergent patterns exist to unify), and commit to a per-page visual check (c11 browser or computer-use) as part of validation, not just unit tests.

**[MAJOR] Missing — Dependency status for PR #224**
§T1 says "PR #224 (merge or absorb)" and the description says "builds on PR #224." That fork has since resolved — **#224 merged 2026-08-14 (14:45 UTC / 10:45 ET)** — but the plan doesn't acknowledge the dependency or its state, which suggests it wasn't checked.
**Recommendation:** State in the plan that the branch is cut from `github/main` (per repo rules) and therefore already contains #224's removal of the Lists nav row and the "Save filter as list" landing; the `/lists`-as-tab work builds directly on that, and no absorb path is needed.

**[MINOR] Undecided — zeroPadNavIcons: retire vs. repoint**
The scope offers a fork ("retire it or repoint it at the flyout's stage numerals"). A plan is where that gets decided; leaving it open means the implementer decides mid-diff.
**Recommendation:** Pick one in the plan with a sentence of rationale (repointing keeps the AI Engineer register's numbered-chrome character alive in the flyout; retiring is less code — either is defensible, deciding is the point).

**[MINOR] Undecided — Flyout mechanics**
The behavioral contract is specified (150/220ms shared timer, focus-opens, never the only path, retires <1000px, counts from the cached dashboard snapshot with no fetch on hover per R7), but the plan makes no implementation choices: fixed positioning relative to what, matchMedia vs. CSS for the <1000px retirement, how keyboard focus interacts with the hover timer, what renders while the snapshot isn't yet cached.
**Recommendation:** A short design paragraph on the flyout — it's the one genuinely new component in the ticket and the place where an unplanned implementation is most likely to drift from the prototype.

## 4. Positive Observations

- The *upstream* artifacts are exemplary: `sequence/sidebar-fold-tickets.md` §T1 carries a clear "why," a precise scope split (nav structure / flyout / Lists-into-People), acceptance sketches that are directly testable, named dependencies, and an R7 speed note for the flyout. The task description faithfully compresses it with full traceability (prototypes named, rulings dated, R-numbers cited).
- The description embeds the design contract (prototypes/pipeline-v1.1 + crm + sidebar-reorg, rulings in run-state 2026-08-14), so a fresh implementer can find ground truth without parent memory — exactly the self-contained handoff this project wants.
- The centered-page-column fix being folded into this ticket (found at sign-off) rather than minted as a stray follow-up shows good scope hygiene at intake.

None of that, however, is the plan — it's the material the plan should have been built from.
