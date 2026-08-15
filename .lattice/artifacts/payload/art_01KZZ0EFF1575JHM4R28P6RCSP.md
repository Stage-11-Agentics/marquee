# Code Review: MRQ-183

## 1. Verdict

**FAIL (implementation-level)** — The Part 1 (conflict badge) work is sound and well-shaped, but Part 2 (room ordering) is built on a field that does not exist: `AgendaRoom` has no `position` property and the agenda snapshot never sends one. As diffed, the change either does not typecheck or — if the type were patched without the server change — silently does nothing at runtime while displaying a "newest first" label that is false. The task should return to `in_progress`; the fix is small and well-defined.

## 2. Summary

Reviewed the three-file diff (AgendaPage.tsx, agenda.css, new MRQ-183 contract test) against both halves of the ticket. Part 1 — badges that name the double-booked person and counterpart session, hover/focus counterpart pairing, and an aria-wired counter button — projects `src/lib/conflicts.ts` output without redetecting, exactly as instructed, and reserves badge space so nothing jumps. Part 2 fails at the data layer: `orderedAgendaRooms` reads `room.position ?? 0`, but `AgendaRoom` (`src/api/agenda.ts:71-79`) has no `position` field and `readRooms` (`src/routes/agenda.queries.ts:339-350`) neither selects nor returns it, so in the real product every room yields `0`, the stable sort preserves the old order, the newly created room stays off-screen right — and the grid now carries a "newest first" caption that lies. The contract test passes only because it fabricates the `position` field the API never sends.

## 3. Issues

**[CRITICAL] src/ui/agenda/AgendaPage.tsx:280 (orderedAgendaRooms) — Room `position` exists in neither the `AgendaRoom` type nor the snapshot payload**
`orderNewestFirst(rooms, (room) => room.position ?? 0)` reads a field that `AgendaRoom` (`src/api/agenda.ts:71-79`) does not declare, and the diff touches neither `src/api/agenda.ts` nor `src/routes/agenda.queries.ts`. Two consequences, and both are fatal:
- **As diffed, `tsc` rejects it** — `room.position` is TS2339 on `AgendaRoom`, and the test's `room()` factory (tests/unit/agenda-wide-grid.MRQ-183.test.ts:54-65) returns an object literal with an excess `position` property. If the actual branch compiles green, then the diff presented for review is incomplete and the review must be re-run against the real diff.
- **Even with only the type patched, the feature is inert at runtime.** `readRooms` selects `id, name, capacity, av_capabilities, notes` plus building fields — it orders by `room.position` but never returns it (`RoomQueryRow`, `agenda.queries.ts:39-51`; `toRoom`, `:143-161`). Every room maps to `?? 0`; the index tie-breaker in `orderNewestFirst` then preserves the original ascending order. The newly created room remains the farthest-right column, Part 2's acceptance is unmet in the shipped product, and the new `aria-live` note announces "rooms · newest first" — a claim that is untrue, which is worse than the original silence.
The DB and the venues API both carry the field (the venue editor reassigns global flat-list positions on save, `VenuesPage.tsx:28`, so highest-position = newest is a sound premise), it just never flows to the agenda snapshot.
**Fix:** Add `position: number` to `AgendaRoom`, add `room.position` to the `readRooms` SELECT, `RoomQueryRow`, and `toRoom`, and make `orderedAgendaRooms` read it without the `?? 0` crutch. Then extend the contract test to fail if the field goes missing again — e.g. a node test asserting the snapshot route's room payload includes `position` (the current unit test proves only that the component sorts data the test itself invented).

**[MAJOR] tests/unit/agenda-wide-grid.MRQ-183.test.ts:755 — The Part 2 test verifies a fixture, not the product**
The "eleven-room grids lead with the newest room" test seeds rooms with the very `position` values production never delivers, so it stays green while the shipped grid is unchanged. This is the test-shaped version of the critical issue: it satisfies "fails on main / passes on branch" (via the import of new exports) but does not protect the acceptance criterion it names.
**Fix:** After wiring `position` through the API (above), add one assertion at the seam that broke — the snapshot payload — so the projection cannot silently detach from the sort again.

**[MINOR] src/ui/agenda/AgendaPage.tsx:420 (scroll note) — "scroll for more" is a hardcoded `> 4`, not measured overflow**
MRQ-178's onboarding board measures actual overflow via a ref (`matrixOverflows`) and names the farthest column so the organizer knows what they are scrolling toward. The agenda note hardcodes a 4-room threshold that is wrong on wide monitors (note shows with no overflow) and says nothing about what is off-screen. The plan explicitly asked to "prefer the same answer in both places so the product has one idea of a wide grid."
**Fix:** Reuse the onboarding shape: measure overflow on the `wide-grid-scroll` container and name the last (oldest) room in the note, or extract that logic into `wide-grid.ts` alongside `orderNewestFirst`.

**[MINOR] src/ui/agenda/AgendaPage.tsx — Newest-first global sort fragments the building band**
The old order (`building.position ASC, room.position ASC`) kept rooms grouped by building, so `BuildingBand`'s contiguous-run spans were wide and legible. A global newest-first sort interleaves buildings, decomposing the band into many one-column fragments when building comparison is on. `BuildingBand` handles it correctly (it just emits more runs), but the venue-comparison affordance degrades.
**Fix:** When the building band is shown, consider sorting newest-first *within* building groups, or at minimum confirm with a screenshot at 1280px that the fragmented band is acceptable.

**[MINOR] src/ui/agenda/AgendaPage.tsx:418/468/500 — Hover-driven `conflictFocus` re-renders the whole board on every mouseenter/mouseleave**
The focus state lives at board level (and at page level for TrackBoard), so hovering a conflicted tile re-runs the full grid render, including the per-cell `sessions.filter` inside the slots × rooms loop — O(slots·rooms·sessions) twice per hover transition. With 11 rooms and fine-granularity slots this is real work on a surface where "speed is a feature" (R7).
**Fix:** Memoize cell-session buckets (a `Map` keyed by `room_id`+slot built once per render), or mark the counterpart via CSS using `data-` attributes and a scoped selector so hover does not pass through state at all.

**[MINOR] src/ui/agenda/AgendaPage.tsx:417/467/499 — Board-level fallback `conflictDetailsBySession(snapshot.conflicts)` bypasses venue disclosure**
The `conflictDetails ?? conflictDetailsBySession(snapshot.conflicts)` fallback uses unfiltered conflicts, whereas the in-app caller passes details filtered by `visibleVenueConflicts` (transit conflicts hidden when the building comparison is off). Any future caller relying on the default gets badges the marker map suppressed, and the fallback recomputes on every render.
**Fix:** Drop the fallback and make `conflictDetails` required — every real call site already passes it, and the default exists only to soften the prop signature.

**[MINOR] src/ui/agenda/AgendaPage.tsx:576 — `ConflictCounter` call site duplicates the component's default children**
The page passes `⚠ <span class="tabular">{count}</span> conflicts` as children, which is character-for-character the component's own default. One of the two is dead.
**Fix:** Drop the children at the call site (or drop the default from the component).

**[MINOR] src/ui/agenda/AgendaPage.tsx:413 (AgendaList) — List view keeps the nameless badge**
`AgendaList` renders its own `⚠ Conflict` flag from the marker map and was not given conflict details, so the list view retains exactly the defect the ticket describes for the grid. The judged defect named the grid tiles and the counter, so this is arguably in-bounds to leave — but the inconsistency will read as unfinished to the next judge.
**Fix:** Thread `presentationConflictDetails` into `AgendaList` and reuse `conflictBadgeLabel`, or note the deliberate scope cut in the PR.

## 4. Positive Observations

- **Part 1 is the right shape.** `conflictDetailsBySession` is a pure projection of the server's `AgendaConflict[]` — no second detector, exactly as constraint 4 demanded — and it handles `person`, `room`, and `transit` kinds through one path, with `person_id` resolved against both sessions' speaker lists (which correctly covers transit conflicts, whose `person_id` is a `speaker_id`).
- **Counterpart pairing is genuinely legible.** Solid outline on the focused tile, dashed outline on its counterpart, driven by both mouse and keyboard focus (`tabIndex`, `onFocus`/`onBlur`), with the pairing information also in `aria-label`. This answers "which two collide" rather than just decorating.
- **Elements-never-jump was honored.** The badge slot grew from `min-height: 10px` to a fixed `20px` with `nowrap` + ellipsis, and the placeholder keeps the same box — the label can carry a name without reflowing the grid, and the `+N` overflow suffix keeps multi-conflict tiles honest.
- **The counter is now a real door.** `aria-controls`/`aria-expanded` wiring the button to `#agenda-conflicts-panel` (id added to the panel) turns "a number that happens to be next to a panel" into a stated relationship, and the `data-conflict-counter` hook makes it drivable by agents and tests.
- **Test titles comply with `trace-ac-core.mjs` on the first try** (`CONTRACT · …`), which the ticket notes has cost three CI cycles tonight, and the tests import the new exports so they fail on `main` as required.
- **Reuse over reinvention:** `orderNewestFirst` and the `wide-grid-scroll`/`wide-grid-content` primitives from MRQ-178 were reused rather than re-derived, giving the product "one idea of a wide grid" — the intent was exactly right; only the data plumbing underneath it was missed.
