# Plan Review: MRQ-65 — disclosure fold

## 1. Verdict

**FAIL (plan-level)** — the plan is directionally sound and its non-goals are exactly right, but two gaps would force the implementer to invent contract-level answers mid-build: the page-header naming rule is undefined in reachable folded states, and a cross-cutting ticket that touches every venue surface ships with no inventory of the composition points it must change — including an existing agenda behavior that is currently the *inverse* of AC-263. Both are cheap to fix with a short plan revision; both are expensive to discover in code review.

## 2. Summary

Reviewed the MRQ-65 plan against BUILDPLAN M-60, SPEC Amendment 14 (AC-263), the EVALUATION grading row, and the merged code from MRQ-57–64. The plan correctly separates comparison (folds) from instruction (never folds), protects the canonical `getConflicts` producer and ICS data, and pre-registers a layout decision that honors structural stability. The key concern is that "name the single pinned building in the relevant page header" is undefined precisely in the folded states the SPEC itself declares first-class (a single *unpinned* building — "a streamed venue never takes a pin"), and the plan does not map where the "· Building" suffix is actually composed, which is in at least four places across two layers.

## 3. Issues

**[MAJOR] Approach step 3 — Header naming is undefined in reachable folded states, and the plan silently picks one side of an artifact seam**
The fold triggers whenever pinned buildings < 2 (this is the graded predicate: EVALUATION's AC-263 row and BUILDPLAN M-60 both say "fewer than two pinned buildings," while SPEC §Amendment 14 prose says "fold when there is one building" — these diverge for a conference with two buildings and 0–1 pins). The plan's rule "name the single pinned building in the relevant page header" fails in two reachable states:
- **One building, unpinned.** Amendment 14 makes the null-coordinate building a first-class state ("a streamed venue never takes a pin"), and any new conference starts here. The fold is active, zoom-2 instruction (address, entrance note, access minutes) must still render, and the building has a name the header should carry — but there is no *pinned* building, so the plan's rule names nothing.
- **Two or more buildings, fewer than two pinned.** The suffix must fold (per the graded predicate), yet rooms genuinely span multiple buildings and "name *the* building once in the header" has no single referent.

The task description makes header naming part of the contract ("name the building once in the page header instead"), so leaving this to improvisation sets a UI contract silently — the exact failure mode the MRQ-30 precedent exists to prevent.
**Recommendation:** Revise the plan to (a) state the governing predicate explicitly (pinned-building count < 2, per EVALUATION/M-60) and note the SPEC-prose seam; (b) define the header rule for all folded states — e.g., "when folded and exactly one building exists, name it in the header regardless of pin state; when folded with multiple under-pinned buildings, [decided behavior]" — or flag the multi-building case to the operator as a one-line ruling request before build.

**[MAJOR] Scope / Approach — No file inventory on a cross-cutting ticket; existing partial implementation and duplicated label composers unacknowledged**
The plan identifies no files, and the checklist's cost is concrete here because the codebase already contains half a fold, partly inverted:
- `src/ui/agenda/AgendaPage.tsx:305` already gates the building band on `pinnedBuildingCount(rooms) >= 2` — a local predicate the "one shared disclosure predicate" must consolidate, not duplicate.
- `AgendaPage.tsx:309` + `RoomHead` (`AgendaPage.tsx:141`): `bare={showBuildingBand}` means that with fewer than two pinned buildings the room head renders `room.label` — *with* the "· Building" suffix. Current behavior is the inverse of AC-263 for the suffix, and the plan doesn't note that this wiring flips.
- The suffix is composed in at least four independent places across two layers: server-side in `roomLabel` (`src/api/agenda.ts:122`, feeding agenda snapshot room labels via `src/routes/agenda.queries.ts:151`) and `roomDisplayLabel` (`src/lib/venues.ts:35`, feeding public site and embeds via `src/lib/public-site.ts:414`); client-inline in `AgendaPage.tsx:179` and `:244` (tile and list views), `SubmissionsPage.tsx:104`, and `SubmissionRecordPage.tsx:136`. The server-side composers do not currently receive pinned-building counts, so "use the predicate only at presentation boundaries" requires threading that datum into two query/lib layers — a real architectural step the plan doesn't name.
**Recommendation:** Add a short inventory of composition points (the six above, plus `VenueMap`/`VenuesPage` for the map collapse) and state that the agenda's existing local predicate and `bare` wiring are absorbed into the shared predicate. This converts the ticket's main risk — a missed surface — into a checklist.

**[MINOR] Approach step 3 — "The relevant page header" is unenumerated**
Which headers name the building when folded: operator agenda, public agenda (`PublicAgendaPage`), embed (`EmbedPage`), submissions? The embed is a constrained surface where a header line is a real design decision.
**Recommendation:** List the surfaces that gain the header name. (Folds naturally into the issue-1 revision.)

**[MINOR] Approach step 2 — Transit-conflict filtering is vacuous in the folded state; say so, and bound the filter**
A `transit` conflict requires two sessions in *different pinned* buildings, so with fewer than two pinned buildings `getConflicts` cannot produce one — the proposed presentation filter is defense-in-depth, not the mechanism. That's fine, but the plan should say so, because it changes what the tests assert (absence through the natural pipeline, not filter behavior) and because the only real risk the filter introduces is accidentally dropping room/person conflicts it should never touch.
**Recommendation:** Note the vacuity explicitly; constrain the filter to `kind === "transit"` only; have the AC-263 test assert room/person conflicts survive the folded state.

**[MINOR] Verification — Test harness and AC-claims mechanics unstated**
EVALUATION grades AC-263 as `e2e:`, but `tests/e2e/` is empty and project practice to date (e.g., MRQ-64's AC-260, also graded `e2e:`) covers these rows with unit/integration tests plus a `tests/ac-claims/MRQ-N.json` owns-file that `trace:ac` (inside `pr-gate`) enforces. The plan says "focused tests" without naming the harness or the claims file.
**Recommendation:** State that AC-263 will be claimed via `tests/ac-claims/MRQ-65.json` (`owns: ["AC-263"]`) with unit/integration coverage in the existing pattern (e.g., `tests/unit/…AC-263.test.ts`), consistent with how AC-260–262 were landed.

## 4. Positive Observations

- **The non-goals are exactly the right ones.** Leaving `getConflicts`, `getTransitConflicts`, and `walkingMinutes` untouched keeps the fold purely presentational — matching the amendment's design where geometry is truth and disclosure is attention. Protecting ICS `LOCATION`/`GEO` and the `access_note`/AV public boundary (AC-253) shows the author read the adjacent contracts, not just this ticket.
- **The instruction/comparison split is correctly internalized.** The plan explicitly keeps address, entrance note, access minutes, leave-by, portal location data, and merge fields in both states — the "zoom 2 is independent of building count" rule, applied faithfully.
- **The layout decision is pre-registered.** Committing up front that the folded map keeps its structural slot and that opening the disclosure doesn't reflow the grid honors both the tile-mosaic's no-reflow contract (AC-257) and the project-wide elements-never-jump rule, and promising the rationale in the PR body is good practice.
- **Verification is two-sided.** Testing both the one-pinned and two-pinned states, rather than only the fold, guards the regression direction (comparison surfaces must survive at ≥2) that a fold-only test suite would miss.
- **Dependency awareness.** The plan respects M-60's lands-last position and treats MRQ-64's arrival surfaces as fixed points to preserve, which is the correct reading of "cross-cutting."
