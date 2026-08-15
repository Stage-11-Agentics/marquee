# Plan Review: MRQ-142

## 1. Verdict

**PASS** — Plan is complete, feasible, and aligned. Implementation can proceed. The issues below are refinements the implementer should fold in, not gaps requiring a re-plan.

## 2. Summary

Reviewed the four-step implementation plan for reconciling the conference date window with the session data window across the public agenda, the agenda builder, and the settings date-change path. The plan is terse but correctly scoped: it names the settled product decision (render all days, label empty ones), commits to one canonical divergence calculation, pairs its regression assertions, and respects every stated constraint (no migration, no deploy, push before verification, `pr_open` handoff). I verified the plan's premise against the code: the seam is real and exactly where the plan expects it — two independent day enumerations (`eventDays()` in `src/lib/public-site.ts:328`, `dayOptions()` in `src/ui/agenda/AgendaPage.tsx:88`) and a date-change handler (`src/routes/event-settings.routes.ts:532`) that validates only date ordering. The key concern is that "one canonical divergence calculation" spans a server-rendered surface and a client-side React surface, which constrains where that module can live and how it is fed.

## 3. Issues

**[MINOR] Step 2 — The "one canonical calculation" spans two runtimes with two existing, non-identical day enumerations**
The public agenda's day list is built server-side in the Worker (`eventDays()`, UTC ISO-string iteration, UTC labels), while the builder's is built client-side (`dayOptions()`, epoch-ms iteration from noon, labels formatted in the event's timezone). A shared module is feasible only if it is a dependency-free pure function importable from both bundles, and a naive unification would change one surface's labels (UTC vs. event-timezone rendering of the same date). The plan should not accidentally treat label formatting as part of the shared seam.
**Recommendation:** Scope the canonical calculation to the divergence question only — given the window and the session dates, which days are empty and how many sessions fall outside the window — and leave each surface's existing day-label formatting alone. Place it in `src/lib/` where both the Worker and the client bundle can import it, or compute it server-side and deliver it on the payloads both surfaces already receive (`loadPublicAgenda` and the builder's `AgendaSnapshot`).

**[MINOR] Step 3 — Red-on-main demonstration is an acceptance criterion but not a plan step**
The task's acceptance explicitly requires "Regression test red on `main`, green on the branch." Step 3 adds regression coverage and step 4 runs it green, but nothing commits to demonstrating the red side. Without that evidence recorded on the ticket, the reviewer cannot distinguish a regression test from a test that would have passed before the fix.
**Recommendation:** Add to step 4: run the new tests against the base commit (e.g., `git stash`-free via a scratch checkout of `github/main` or `git checkout <base-sha> -- <src paths>` in the worktree — never `git stash`, per repo rules) and record the red output in the MRQ-142 comment alongside the green run.

**[MINOR] Step 2 — The empty-day state must be distinguished from the existing filter-miss empty state, and must carry an exit**
Today `?day=<empty-day>` falls into the generic `hasFilters` branch of `PublicAgendaPage.tsx:868` ("No published sessions match / Clear a filter…"), which describes a valid conference day as a filter mistake. The task requires the empty day to state "nothing scheduled on this day" in the conference's own language, and requires that no day tab be a dead end. The plan says "public empty-day state" but doesn't note it is carving a new case out of an existing conditional, nor that the new state needs an affordance (e.g., the existing "Show full agenda" link pattern) to satisfy the no-dead-end criterion.
**Recommendation:** In step 2, name the split explicitly: valid-day-with-no-sessions gets its own copy and retains a navigational exit; genuine filter misses keep the current copy. This is also where the "elements never jump" constraint bites — the new state must occupy the geometry of a populated day.

**[MINOR] Step 1 — No files named; the tracing is deferred to implementation**
The checklist asks whether the plan identifies files to be created or modified; step 1 defers this to a tracing pass. The seam is small and already discoverable, so this is not a feasibility risk, but naming the anchors would tighten the plan.
**Recommendation:** Record the known anchors in the plan: `src/lib/public-site.ts` (`eventDays`), `src/ui/public/agenda/PublicAgendaPage.tsx` (tabs and empty states), `src/ui/agenda/AgendaPage.tsx` (`dayOptions`, grid empty state), `src/routes/event-settings.routes.ts` (date-change PATCH, where the outside-window count is computed and returned), `src/ui/settings/EventSettings.tsx` (where that count is surfaced), plus the builder's snapshot route for the persistent builder-side warning.

**[MINOR] Step 2 — The out-of-window warning needs to be live-computed on the builder, not only echoed at change time**
The acceptance requires the count "on the settings surface and the builder." A count returned only in the PATCH response satisfies settings but evaporates on reload; the builder warning must be derived from current data (sessions whose date falls outside `starts_on..ends_on`) every time the snapshot is built, or an organizer who changed dates yesterday sees silence today. The plan's single sentence doesn't distinguish these.
**Recommendation:** Compute the count from live data in both places using the same canonical calculation — settings can show it in the PATCH response *and* on subsequent loads; the builder shows it whenever the count is nonzero.

## 4. Positive Observations

- **The plan inherits a well-settled product decision and doesn't relitigate it.** The task description carries the full "render all days, label the empty one" ruling, and the plan builds to it without re-opening the hide-vs-show question. That is exactly the right altitude for a plan under a settled ruling.
- **"One canonical divergence calculation" is the correct architectural instinct.** The defect exists precisely because two surfaces independently derive days from the window while a third path mutates the window with no reconciliation. Unifying the calculation, rather than patching three symptoms, kills the class of bug — and the code confirms the duplication is real.
- **The paired-assertion discipline is carried into the test plan.** Step 3's "paired public populated/empty days" directly answers the task's warning that "everything is empty" must not be able to pass for "the empty day is labelled" — a subtle test-design trap the plan explicitly avoids.
- **Constraint compliance is complete:** no migration, no deploy, push-before-verification, gate via the shared gate-lock, `CONTRACT`/`AC-` test naming, and the `pr_open` handoff to the merge captain are all present in steps 3–4.
- **Scope discipline is good.** The embed widget (`EmbedPage.tsx`) shared the original sighting's provenance but has no day-tab navigation, so the plan's restriction to the public agenda and builder — the two surfaces that actually render day navigation — solves what the task asks for, not more.
