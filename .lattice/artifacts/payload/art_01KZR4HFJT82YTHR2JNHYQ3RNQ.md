# Code Review: MRQ-65 — disclosure fold (AC-263)

**Reviewed:** `forgejo/mrq-65-fold` @ `e0157a1` (diffed against merge-base `3332a85` with master).

> Review note: the diff embedded in this prompt was truncated by Lattice at 5,000 of 61,573 lines, and every line shown was `.lattice/` artifact metadata — zero product code made it into the prompt. This review was performed against the real branch diff pulled from git (27 files, +344/−71, excluding `.lattice/`). Future review dispatches for this repo should exclude `.lattice/` from the diff or the truncation will silently swallow the code again.

## 1. Verdict

**PASS**

## 2. Summary

The implementation delivers AC-263 cleanly: a single shared disclosure module (`src/lib/venue-disclosure.ts`) applied only at presentation boundaries, with the canonical `getConflicts` producer, `getTransitConflicts`, and `walkingMinutes` untouched (verified — `src/lib/venue-geometry.ts` and `src/lib/conflicts.ts` have no changes). All five surfaces from the plan fold correctly at <2 pinned buildings while retaining address, entrance note, and access minutes, and both fold states are exercised by integration tests. I ran the suite on the branch in an isolated worktree: full default suite **pass (13.0s, hermetic, within the 30s budget)** including 58 node tests, and the three modified integration files pass **29/29** under the Workers+D1 pool. Remaining findings are minor.

## 3. Issues

**[MINOR] src/routes/agenda.queries.ts:488, src/lib/public-site.ts:89 — a single *unpinned* building is never named in the header**
The disclosure queries filter to pinned buildings (`lat IS NOT NULL AND lng IS NOT NULL`) for both the count and the primary name. An event whose only building has no coordinates yet (a common early-setup state) gets `pinned_building_count = 0` → the `· Building` suffix is stripped everywhere, but `primary_building_name`/`buildingName` come back `null`, so nothing names the building "once in the page header instead." Public pages degrade gracefully to `event.venue ?? "Online"`; the agenda builder and venues headers show nothing, and the building's name disappears from those surfaces entirely (previously the suffix carried it). Same shape in the two-unpinned-buildings case, where the suffix folds (per the ruling's literal "fewer than two **pinned**") but rooms in different buildings lose their disambiguation with no header substitute. The client ruling is keyed on pins, so this is conformant-as-written — but the header-naming intent has a gap at 0 pins.
**Fix:** when the pinned set is empty, fall back to naming the sole building row regardless of pin state (i.e., `pinned[0]?.name ?? (allBuildings.length === 1 ? allBuildings[0].name : null)`), or confirm with the client that 0-pinned events intentionally show no building name.

**[MINOR] src/ui/submissions/SubmissionsPage.tsx:435 — header venue name is derived from the visible page of rows**
`singleVenueName` scans the currently rendered rows (paginated at 50) for the first slot with `show_building === false`. If the active page or filter contains no scheduled submissions, the single-venue name silently drops out of the header even in a one-building event, and it can flicker in/out as the user pages or filters — a soft violation of the "psychologically solid" header this project holds to. It degrades to omission, never to a wrong name, hence minor.
**Fix:** carry the disclosure at the list-envelope level (the queries already compute `pinned_building_count` per row via `itemSelect`; one envelope-level field would do) instead of inferring global venue state from whichever rows happen to be on screen.

**[MINOR] src/ui/agenda/AgendaPage.tsx:189, 261 — per-tile recomputation of the disclosure predicate**
`SessionTile` and each `AgendaList` row call `agendaShowsBuildingComparison(snapshot)` per render; on the fallback path (no `snapshot.venue`) that maps all rooms and builds a Set per tile. With the server now always supplying `venue`, the hot path is a cheap integer compare, so this is a quality nit, not a measurable R7 defect — but it's trivially hoistable to the board components, which already compute it once (`DayBoard`, `RoomBoard`).
**Fix:** compute once in `AgendaPage`/board scope and pass down, as `RoomBoard` already does for `RoomHead`.

No critical or major issues found.

## 4. Positive Observations

- **The predicate lives in exactly one place and is applied only at presentation boundaries.** `venue-disclosure.ts` is small, pure, and every surface routes through it (`displayRoomLabel`, `visibleVenueConflicts`, `showsBuildingComparison*`). The non-goals held: no changes to `venue-geometry.ts`, `conflicts.ts`, or ICS/`GEO` data — the API still carries `walk_minutes` and full geometry, and only the rendering folds.
- **Instruction surfaces survive the fold, verifiably.** The portal test seeds the one-pinned-building state and asserts `room: "Room 101"` (no suffix) *while* asserting `address`, `access_note`, and the newly-asserted `access_minutes: 5` remain — then inserts a second building and asserts the comparison state returns (`"Room 101 · North Hall"`, `show_building_comparison: true`). The public-site test does the same both-states dance for the anonymous agenda and session pages, and re-verifies the AC-253 boundary (`operator secret — never public` present in the authed portal, absent from the public body) in both states. This is exactly the test shape the plan promised.
- **Conflict presentation is consistent across the three places it appears.** The agenda header button count, the `ConflictPanel` list, and the dashboard "Conflicts" gauge all filter through `visibleVenueConflicts`, and the dashboard's affected-session count is computed from the *filtered* set — no surface shows a transit count another surface hides.
- **The layout decision from the plan was actually honored.** Both `<details>` folds (`venue-map-fold`, `portal-arrival-map-fold`) keep the map's structural slot — the venues page adds a 360px `venue-map-reserved` block hidden by an `[open] +` sibling selector, and the portal fold carries `min-height: 142px` — so folding doesn't collapse the surrounding grid. The fold summaries carry useful copy ("pin a second building to compare") rather than bare chrome.
- **Defensive degradation follows the codebase's own idiom.** `readDashboardBuildingComparison` mirrors the existing `readDashboardConflicts` `no such table/column` guard; `itemSelect` gates the correlated subquery behind the existing `hasColumns` probe so older fixtures keep working; both `toItem` call sites (`listDraftsNeedingAttention` and `listSubmissions`) get the new column.
- **API surface changes are complete:** the agenda snapshot Zod schema, portal response schema, submissions slot schema, TS interfaces, and `cli/api-registry.json` document hash all moved together, and the agenda API test pins the new `venue` object shape.
- Duplicated client-side `pinnedBuildingCount` logic in `AgendaPage` was deleted in favor of the shared module rather than left to drift — good hygiene for a cross-cutting ticket that lands last.

## Verification performed

- Full default suite on the branch (fresh worktree, fresh `npm install`): **pass**, `elapsedMs: 13022`, hermetic, 58/58 node tests.
- `tests/integration/api/agenda.AC-70-74-252-253.test.ts`, `tests/integration/api/portal.AC-43-52-233-237-240.test.ts`, `tests/integration/public-site.AC-83-86-240-252-253.test.ts` under the Workers pool: **29/29 pass** (2.2s).
- Grepped the branch for residual `Room · Building` renderings and walking-time renderers outside the gated paths: none found (comms/ICS carry location data but render no walk minutes, matching the non-goals).
