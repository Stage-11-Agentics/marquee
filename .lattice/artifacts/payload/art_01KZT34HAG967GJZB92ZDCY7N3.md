# MRQ-91 exact-head self-review

Verdict: PASS.

Reviewed `github/main...mrq-91-venue-map` at `61b42ed6dae4cdafbafb7d8bc0fa6be68711f0cd` from the isolated worktree `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-91-venue-map`. The tracked diff is limited to the MRQ-91 plan, the portal ArrivalCard and portal styles, the reused venue map primitive, and the two related contract tests. The worktree also contains an unrelated untracked `mrq91-m2.tmp.mjs`; it was not inspected, staged, or changed.

## Review of the prior findings

- The prior major UI finding is resolved: `.portal-arrival-map-directions` is top-left, while `VenueMap`'s tiles-failed status remains bottom-left, so the degraded-state copy is readable.
- The fixed-height contract is single-sourced: `MAP_HEIGHT` is exported by `VenueMap` and used for both portal map states; the wrapper passes the same height and min-height inline, while the shared shell retains its own matching inline height.
- Portal map accessibility is named through `role="group"`, and the shared map accepts the portal-specific `ariaLabel` instead of exposing organizer-only wording.
- AC-263 no longer owns MRQ-91 portal assertions. Its organizer comparison assertions remain; `portal-arrival-map.MRQ-91.test.mjs` owns the portal map contract with one Directions count, no fold, named/fallback copy, fixed-height source, and Google Maps target.
- Source-shape assertions in the MRQ-91 test were loosened to contract-level forms; the runtime proof covers the actual rendered behavior.

## Acceptance audit

- `ArrivalMap` adapts one `slot.location` into the existing `VenueMap`; no projection or tile implementation was forked.
- A pinned local speaker session rendered 18 `tile.openstreetmap.org` images, a `Sheraton New York Times Square` pin label, a fixed 360px map slot, and exactly one map Directions link.
- DOM evidence at the final head: Directions `href=https://www.google.com/maps/search/?api=1&query=40.7625188,-73.9814528`, `target=_blank`, zero `.portal-arrival-map-fold` elements. Clicking the link opened a separate Google Maps tab, which was closed.
- The final screenshot is attached as Lattice artifact `art_01KZT33DBH4QZNJG5BT5FQX13T`.
- Focused portal/venue tests pass 6/6; TypeScript, design, API, and AC trace checks pass. The final gate's 497/497 tests passed; its only red status was the wrapper's time budget under fleet contention (150.941s against 120s), not a test or contract failure.

No production deployment was attempted. The live site remains read-only evidence only; human merge and the post-merge ship-owner deployment remain outside this branch.
