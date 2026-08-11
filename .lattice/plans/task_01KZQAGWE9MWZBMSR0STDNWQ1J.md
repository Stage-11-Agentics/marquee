# MRQ-65 — disclosure fold

## Scope

Implement M-60 / AC-263 at the presentation layer. When fewer than two pinned
buildings are available, fold comparison-only affordances while retaining the
arrival instruction surfaces introduced by MRQ-64. With two or more pinned
buildings, preserve the comparison presentation.

The fold applies consistently to the agenda, venue authoring view, speaker
portal, public agenda/embed, and submission slot labels where those surfaces
render the same comparison data. The underlying agenda conflict pipeline and
venue-geometry helpers remain unchanged.

## Approach

1. Add one shared, threshold-based disclosure predicate for pinned-building
   comparison and use it only at presentation boundaries.
2. Filter transit/conflict comparison presentation after the canonical
   `getConflicts` result is produced; retain room/person conflicts and all
   underlying geometry data.
3. Render room names without the building suffix when folded, and name the
   single pinned building in the relevant page header. Keep address, entrance
   note, access minutes, arrival timing/leave-by, portal location data, and ICS
   `GEO`/location instructions in both states.
4. Fold the embedded map with an explicit disclosure structure that preserves
   the surrounding layout; the PR body will document this layout choice.
5. Add focused tests that exercise both one-pinned-building and two-pinned-
   building states, including the AC-253 public/operator boundary.

## Non-goals

- Do not change `getTransitConflicts`, `walkingMinutes`, or the single
  `getConflicts` producer.
- Do not change the approved prototype, SPEC, EVALUATION, BUILDPLAN, DESIGN,
  or USER_STORIES artifacts.
- Do not expose `access_note` or AV capabilities on public surfaces.
- Do not alter ICS location or `GEO` instruction data.

## Verification

- Baseline: `npm test` (green before implementation).
- Focused AC-263 tests: one-building fold and two-building comparison,
  instruction retention in both states, and AC-253 boundary.
- `npm run pr-gate -- --ticket MRQ-65` before opening the PR.
- Confirm exact branch/base/head refs and push `mrq-65-fold` to Forgejo.

## Layout decision

Use explicit disclosure containers for folded maps. The map card/column keeps
its own structural slot and the map component retains its fixed expanded box;
opening the comparison does not change the surrounding grid's structure. This
is deliberate restructuring rather than removing the instruction card.
