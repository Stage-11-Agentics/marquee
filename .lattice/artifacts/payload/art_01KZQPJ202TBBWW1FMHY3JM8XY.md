# Code Review: MRQ-21 — Agenda track swimlane and conflicts

Reviewer note on scope: the diff embedded in the review prompt was truncated (5,000 of 12,360 lines shown; the bulk was `.lattice` artifact metadata). I reviewed the **full real diff** from the worktree instead: `git diff forgejo/master...HEAD` — 11 files, +495/−86, all source and test changes examined in full. I also independently re-ran the evidence (see Verification below).

## 1. Verdict

**PASS** — Implementation is correct, matches the plan and its cycle-1 resolutions, and meets the acceptance criteria. All findings below are minor; none warrant rework before merge.

## 2. Summary

The change extracts the track view into a structural `src/ui/agenda/track-board.tsx` (one `section[data-track-lane]` per track with day bands and fixed slot columns — genuinely structural, not a color overlay), and introduces `src/lib/conflicts.ts` as the single role-aware participant projection feeding person conflicts, Transit `person_ids`, and the display dedupe. The one-conflict-path constraint is honored: `getConflicts` in `agenda.queries.ts` remains the sole aggregator, and no placement blocking was added. Independently verified: full hermetic suite 40/40 in 22s (within the 30s budget), targeted new suites 14/14 including the explicit MRQ-63 transit regression, `tsc --noEmit` clean, `trace:ac` pass with 0 uncovered and no manifest errors.

## 3. Issues

**[MINOR] src/ui/agenda/track-board.tsx:90 — Off-slot sessions are counted but invisible in the grid**
Slot assignment requires an exact `sessionTime(...) === "HH:00"` match within 09:00–20:00. A session whose `starts_at` lands off the hour or outside the axis (possible via the API, which accepts arbitrary `starts_at` — the integration test itself POSTs a raw `NOW`) renders in no slot, while the lane header still counts it in "N scheduled". This is inherited verbatim from the old `TrackBoard` (all boards share hourly `TIME_SLOTS`), so it is pre-existing behavior, not a regression from this ticket — but the count/render mismatch is now easier to notice because the lane count is computed from `laneSessions` while the grid renders a filtered subset.
**Fix:** Not required for MRQ-21. When the agenda grows finer-grained placement, snap or bucket `sessionTime` to the containing slot (`floor` to the hour) rather than exact-matching, or derive the header count from the rendered set.

**[MINOR] src/ui/agenda/AgendaPage.tsx:576-589 — `jumpToSession` silently no-ops if the tile isn't in the DOM at rAF time**
The jump sets view/track/day state, then queries `[data-session-id]` inside a single `requestAnimationFrame`. Preact flushes state on a microtask so this works in practice, but if the re-render is ever deferred past the first frame (large snapshot, concurrent updates), or if the target session is off-slot per the issue above, `tile` is `undefined` and the jump quietly does nothing after having already switched the view and closed the drawer — a confusing half-jump.
**Fix:** Cheap hardening: double-rAF (`requestAnimationFrame(() => requestAnimationFrame(...))`), or retry once when the first query misses. Not blocking; the happy path is covered and the failure mode degrades gracefully.

**[MINOR] src/ui/agenda/agenda.css:81-96 — Time axis and slot columns live in separate grids and can drift a few pixels**
The axis row uses `110px repeat(12, minmax(105px, 1fr))` with no gap/padding, while each day's slot row nests a grid with `gap: 6px; padding: 8px` plus a `repeating-linear-gradient` at 8.333% for column lines. At the stated min-widths the accumulated offset stays ≤ ~8px (the gap/padding arithmetic nearly cancels), so it reads fine, but the two grids are only coincidentally aligned — a future width tweak to one without the other will visibly shear the axis from the columns.
**Fix:** Cosmetic; consider a shared `grid-template-columns` custom property or subgrid when the board is next touched.

No correctness, security, or performance issues found. Specifically checked and clean: the `participations.role` column is `NOT NULL` with a CHECK covering exactly the six roles in `SubmissionParticipationRole` (migrations/0001_init.sql:413), so the `role === undefined` legacy branch in `conflictParticipants` can never mask a real row; the SQL injection surface is unchanged (the new `role` column is added inside the existing bound-parameter query); the O(n²) session-pair loop is pre-existing and fine at conference scale.

## 4. Positive Observations

- **AC-81 is met structurally, exactly as the task demanded.** Lane count equals track count with each lane its own `<section>` bounding box, day bands and slot cells carry `data-track-day-band` / `data-track-slot` attributes, and the unit test asserts containment by slicing each lane's markup and checking both presence of its own sessions *and absence of other lanes' sessions* — including the filtered-view case that proves all lanes stay mounted. This is the strong form of the test, not the color-overlay shortcut the task explicitly forbade.
- **The role projection is one helper, used three ways.** `conflictParticipants` feeds person double-booking, Transit `person_ids`, and (via `dedupeParticipants`) the display parse — precisely the cycle-1 resolution. Transit geometry and the MRQ-63 message were untouched, and the transit contract test was run explicitly as a regression gate (passes).
- **Thoughtful dedupe semantics.** `rolePriority` keeps the agenda-relevant role when a person holds e.g. `submitter` + `speaker`, preserves original ordering by replacing in place, and the two-roles fixture asserts exactly one person conflict for the pair — the edge case the plan review called out.
- **"UI never jumps" honored on the conflict flag.** The tile now always reserves the flag's space (`min-height` + `visibility: hidden` placeholder with `aria-hidden`), so a conflict appearing doesn't reflow the tile — same for the fixed-width `min-width: 11ch` scheduled-count in the lane header.
- **Warning-never-block proven at the API seam.** The `AC-75 + AC-79` integration test asserts the conflicting POST returns `201`, the session persists, and the same shared `conflicts` payload reports the room warning — the whole contract in one test.
- **Honest evidence accounting.** `tests/ac-claims/MRQ-21.json` records C5 as an operator verdict on deployed infra rather than self-signing the felt checkpoint, and `trace:ac` validates the manifest with zero uncovered ACs.
- The default suite stayed hermetic and fast (22.4s against the 30s budget) after adding three test files — the inner loop was respected.
