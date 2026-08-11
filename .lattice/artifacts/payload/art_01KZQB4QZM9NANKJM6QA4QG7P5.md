# Plan Review: MRQ-11 — Program dashboard

## 1. Verdict

**FAIL (plan-level)**

## 2. Summary

The plan correctly scopes its dependency (M-08/MRQ-9, merged) and reuses that ticket's status-derivation pattern where it genuinely applies, and its risk section shows real engagement with the prototype's mock-data quirks. But it makes an unflagged architectural choice — deriving an `onboarding` submissions filter — that contradicts the binding SPEC and the already-shipped route table, silently substitutes integration tests for the `e2e:` evidence four of its four ACs are contracted to, and leaves the trickiest verification step (asserting a 5s interval without a wall-clock wait) completely unspecified in a codebase with no fake-timer precedent to draw on. These aren't polish gaps; each one risks a PR that either can't be reviewed against its own AC contract or bakes in a data-model decision another ticket (M-23) will have to unwind.

## 3. Issues

**[CRITICAL] Step 2 / Risk note 2 — `onboarding` submissions filter contradicts SPEC and the shipped route table**
The plan derives `status=onboarding` as a new submissions-list filter (open speaker tasks + format) so the Onboarding tile can link into the reused list contract. But `SPEC.md:415` states "`Onboarding` → **chase board**; the rest → submissions list pre-filtered," and `src/ui/shell/route-table.ts:20` already routes the sidebar's Onboarding entry to `/onboarding`, not a filtered submissions list. The chase board is a separate, not-yet-built ticket (M-23, Wave 2, deps M-15+M-11). The plan's risk note only addresses the *count-shape* mismatch (speaker-oriented prototype value vs. submission-count reality) — it never acknowledges that routing Onboarding into `/submissions?status=onboarding` diverges from a binding SPEC decision and creates a second, competing definition of "Onboarding" that M-23 will later have to reconcile or discard.
**Recommendation:** Either (a) point the Onboarding tile at `/onboarding` per the existing route table and leave it as an honest placeholder/empty-state destination until M-23 ships, explicitly noting that as a temporary gap, or (b) get an explicit SPEC amendment before building a submissions-list `onboarding` filter that SPEC says shouldn't exist. Don't invent the filter silently.

**[CRITICAL] Step 5 — plan substitutes integration/UI tests for the `e2e:` evidence AC-14, AC-15, and AC-240 are contracted to**
`EVALUATION.md` specifies `e2e:` as the required evidence method for AC-14, AC-15, and AC-240 (Tier A, no-waiver for AC-240), and `validation-plan.md:33` explicitly names "MRQ-11 PR; `e2e` dashboard-liveness spec (5 s SWR poll, F-8)" as the expected artifact. `tests/e2e/` does not exist anywhere in the repo — no ticket has stood it up. The plan's step 5 says "AC-tagged integration/UI test under `tests/`" with no mention that this falls short of the contracted evidence tier, and no proposal to either build the missing e2e harness or get the evidence method reclassified.
**Recommendation:** Add an explicit line to the plan: either (a) this ticket stands up `tests/e2e/` (playwright.config.ts already points there) and writes the dashboard-liveness spec validation-plan.md expects, or (b) the plan states it is knowingly deviating from the contracted evidence method and gets that accepted before implementation, so `trace:ac` and the eventual audit don't surface a silent gap.

**[CRITICAL] Step 5 — "assert the five-second revalidation interval without a wall-clock wait" has no specified mechanism and no repo precedent**
There is no `useFakeTimers`/`advanceTimersByTime`/comparable pattern anywhere in `tests/` or `src/`. `vitest.config.ts` sets `testTimeout: 5_000`, which makes a real 5-second wait infeasible inside the suite's own ceiling. The plan states the *outcome* it wants ("assert … without using a wall-clock wait") but not *how* — no timer-injection seam, no fake-timers strategy compatible with `@cloudflare/vitest-pool-workers`, nothing. This is the single most technically uncertain step in the plan and it's the least specified.
**Recommendation:** Name the actual mechanism before implementation starts — e.g., inject the poll interval as a testable constant/seam the component reads, or confirm `vi.useFakeTimers()` actually works under the Workers vitest pool for a Preact `useEffect` interval (untested combination in this repo) before committing to it as the plan.

**[MAJOR] Step 3 — "format/track pressure" has no prototype or SPEC surface**
The prototype (`prototypes/pipeline-v1.1/index.html` "Work in motion" card) and `SPEC.md:418` both describe "review-pressure chips by track" only — there is no format-pressure panel anywhere in the binding design. AC-14 does require counts "by format/track," so something must be added, but DESIGN.md requires divergences from the one-to-one prototype reproduction to be explicitly marked as acknowledged. The plan asserts "format/track pressure" as if it's already in the prototype, without flagging the format half as new surface or specifying where/how it renders.
**Recommendation:** Either cite the SPEC location that authorizes a format-pressure surface, or add an explicit note that this is a new, unprototyped element and describe its intended treatment (e.g., additional chip row) so it doesn't slip through as an untracked deviation from the binding design.

**[MAJOR] Step 2 — file-surface expansion beyond the ticket's declared scope is unacknowledged**
The ticket record states "File surface: `src/routes/dashboard.routes.ts`, `src/ui/dashboard/*`" and "Shared files: none — module-local." Step 2, however, extends `submissions.queries.ts` and `submissions.routes.ts` — MRQ-9's file surface — to add the `onboarding` and `format` filters. Concurrency risk against other in-flight tickets looks low today, but modifying `submissions.routes.ts`'s query schema also changes the published OpenAPI surface that `check:api` guards. The plan does not note that it is operating outside its own declared file surface or that this has `check:api` implications.
**Recommendation:** State explicitly in the plan that the file surface is being extended into `src/routes/submissions.*`, name the `check:api` implication, and confirm no other in-flight ticket (MRQ-7, MRQ-10, MRQ-17, MRQ-61) touches the same files concurrently.

**[MAJOR] Step 1 — "authenticated GET" understates the required access control for this data class**
The codebase convention for admin reads over this kind of data is `policy: { auth: { kind: "grants", grants: ["program:read"] } }` (see `submissions.routes.ts`), not a bare "authenticated" gate — `src/api/route.ts` defines `public`/`authenticated`/`grants` as distinct tiers. This distinction is not academic here: MRQ-60 was a shipping-blocker precisely because a submissions-adjacent route was gated too loosely, exposing unpublished/rejected records. A dashboard endpoint aggregating the same underlying data (including scheduled-but-unpublished and rejected counts) inherits that same sensitivity.
**Recommendation:** Specify the grants-based policy explicitly in the plan (e.g. `grants: ["program:read"]`), matching the submissions route convention, rather than the generic "authenticated" language.

**[MAJOR] Step 3 — several required prototype elements are unnamed**
The binding prototype/skin includes elements the plan's step 3 doesn't mention: the `.rulers` track-color band above the pipeline strip, per-stage `.gauge` bars, the seven distinct `.pipeline-delta` secondary metrics (each a different derived figure, not decoration), the page-head narrative subtitle and named action buttons (`Conference settings`, `Work the pipeline →`, `Plan next wave`, `Export`, `Open onboarding`), the alarm-colored treatment on the Conflicts metric, and the `Not yet public` slot-meta pill inside the task-preview rows (itself part of AC-240's contract). Since the build must reproduce the prototype one-to-one, omissions here are AC-15/AC-240/DESIGN.md risk, not cosmetic.
**Recommendation:** Expand step 3 to explicitly enumerate these elements (or reference the prototype line numbers) so none are silently dropped during implementation.

## 4. Additional Observations (minor)

- No measured baseline test run is recorded (both cited merged exemplars — MRQ-9, MRQ-12 — include one; e.g. "8 Vitest files / 37 tests, 8.599s" pinned to the base SHA). Worth adding for drift detection.
- No explicit non-goals/boundaries section. Risk note 3 partially substitutes ("AC-240's list/record/portal/board … owned by their respective surface tickets") but a dedicated section, as in the MRQ-9/MRQ-12 plans, would make the ticket's edges clearer.
- No AC-by-AC → test mapping table, which both exemplar plans include.
- AC-16's `felt` half is settled at checkpoint C2 per EVALUATION.md — the plan doesn't mention this as a downstream obligation after merge.
- MRQ-7 (`in_validation`, unmerged) independently aggregates pipeline counts for the landing-page preview in `src/routes/landing.route.tsx`. The project's own rule that counts "must agree with the seeded database rather than being computed twice by different rules" is at risk of violation if MRQ-7 and MRQ-11 land with divergent derivation logic; the plan doesn't mention MRQ-7 at all.

## 5. Positive Observations

- Correctly identifies and verifies its sole dependency (M-08 / MRQ-9, merged) and accurately describes what that ticket's contract already provides (status/track/kind filters, `toItem` derivation) — the "reuse rather than reimplement" instinct is right for 5 of the 7 pipeline stages.
- Pins the exact base SHA (`forgejo/master @ 25b234d2`), consistent with the run-state convention.
- Risk note 1 correctly catches a real prototype-vs-API discrepancy — the mock's `Scheduled += Published` behavior — and resolves it in the direction that preserves AC-15's count-to-result invariant rather than blindly copying the visual mock.
- Risk note 3 correctly and narrowly scopes AC-240 to just the dashboard's stage-copy portion, deferring the list/record/portal/board rendering to their respective owning tickets rather than overreaching.
- Step 6's self-review process (exact diff + current HEAD, focused test → full suite → check:api → trace:ac → pr-gate → local runtime curl check) matches the project's standing "headless review suspended" convention and is a genuinely complete validation chain for what it does cover.
- "Wire `/dashboard` in AppShell" is accurately scoped as trivial — the route-table entry already exists and falls through to `EmptyState`, so this really is a one-branch addition matching the existing `communications` pattern.
- The `check:speed` / AC-16 handling ("measured … on deployed infra") matches the actual behavior of `check-speed.mjs`'s stub path and correctly recognizes it isn't part of `pr-gate`.
