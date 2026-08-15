# Plan Review: MRQ-209 — Organization Home: the between-conferences view

### 1. Verdict

**FAIL (plan-level)** — The task should return to `in_planning` for revision.

### 2. Summary

What was submitted as the plan is a verbatim copy of the task description (verified against `.lattice/plans/task_01M00YMCSRVB6WAH2J389Q239D.md` — its body is byte-for-byte the ticket text). The ticket itself is excellent — precise scope, a named design contract, explicit honest-empty and no-shell-dependency rulings — but restating it adds zero planning content. There is no route, no file list, no query design, no dependency-handling decision, and no test strategy, so there is nothing here a plan review can actually de-risk.

### 3. Issues

**[CRITICAL] Entire plan — The plan is the task description, not a plan**
A plan's job is to turn "what to build" into "how it will be built here." This document makes no decision the ticket didn't already make: it names no files to create or modify, no route path, no API endpoints, no SQL, no component decomposition, no test approach. Every question this review gate exists to catch early (wrong query shape, missed dependency, convention violation) is deferred to code review, which the prompt itself notes is the expensive place to catch it.
**Recommendation:** Return to `in_planning`. The revised plan should at minimum specify: the route and its mount point, the API endpoint(s) and their query shapes, the files touched in `src/routes/`, `src/api/`, `src/ui/`, and `tests/`, and the test plan.

**[MAJOR] Dependencies — No handling strategy for the two in-flight dependencies**
MRQ-209 `depends_on` MRQ-203 (nav row that points at this page) and MRQ-205 (the next-touch data feeding the overdue-follow-ups line), and both are still `in_progress`. The ticket anticipates this ("each source that does not exist yet renders an honest empty"), but the plan must decide the mechanics: how the implementation detects whether MRQ-205's next-touch data exists (schema/table presence? merged-first ordering? a capability check?), what the honest-empty copy and link target are for each attention-strip line, and what happens if MRQ-209 merges before MRQ-203's nav row exists (page reachable by URL but unlinked — acceptable, but should be stated).
**Recommendation:** For each of the three attention-strip sources and the nav entry point, name the concrete integration mechanism and the fallback rendering, including whether the branch will rebase on MRQ-205's merge or ship honest-empties regardless.

**[MAJOR] Queries — KPI and season queries are non-trivial and unspecified**
"Returning speakers (2+ conferences via participations)" is a grouped aggregate across `participations` joined to `people`; "headline stats" per event, "in-outreach count," and the seats-scoped-to-ended-conferences line each imply their own query. The ticket demands server-side queries under R7 budgets, and the repo rules require leaning on existing indexes (`idx_people_org_name`) and the one-list-query convention. Whether these run as one composed endpoint or several, and whether they need new indexes, is exactly the kind of feasibility question a plan must answer — an N+1 per event card here would be an R7 defect.
**Recommendation:** Sketch each query (or name the existing query it reuses), state the endpoint shape (likely one `/api/org/home` payload to keep the page a single round trip), and confirm no new index or migration is needed — or plan the migration if one is.

**[MINOR] Design contract — No verification step against the binding prototype**
The plan names the contract (prototypes/pipeline-v1.1 v1.15 `#org/home` + org-settings-design.md iteration 3) but includes no step to reproduce it one-to-one or verify the result against it, which `DESIGN.md` makes binding. A visual pass against the prototype belongs in the plan as an explicit gate, not an assumed habit.
**Recommendation:** Add a validation step: drive the built page and compare against `#org/home` (layout, tokens, copy), plus `npm run pr-gate` before the PR.

### 4. Positive Observations

The underlying ticket is one of the best-specified on this board, and the plan inherits that by copying it: the four-part composition is enumerated crisply, the honest-empty rule pre-empts the fake-number failure mode, the returning-speakers definition ("2+ conferences via participations") is precise enough to test against, and the "own route, not a settings tab" ruling explicitly severs the MRQ-207 shell dependency so the two tickets can land in either order. The Lattice dependency links to MRQ-203 and MRQ-205 are correctly recorded. All of that is real planning value — it just lives in the ticket, and the plan document needs to add the implementation layer on top of it.
