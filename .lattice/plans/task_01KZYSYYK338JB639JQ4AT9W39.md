# MRQ-183 implementation plan

1. Trace the agenda placement grid and its existing conflict projection. Confirm the
   live `AgendaConflict` records already carry the person/session pairing and identify
   the room ordering field used by venue authoring.
2. Establish focused baseline behavior and add a regression test with a `CONTRACT ·`
   title. The test will prove named conflict counterparts, focus pairing, the conflict
   counter's panel door, newest-room-first rendering, and the shared sticky wide-grid
   seam. It must fail against `github/main` before the implementation.
3. Project `AgendaConflict` records into tile presentation data without recomputing
   conflicts. Make the tile badge visibly name the affected person and counterpart
   Session, add hover/focus pairing with outline-only geometry, and make the header
   counter expose its existing live-detection panel with explicit accessible state.
4. Reuse `src/ui/shell/wide-grid.ts` and `src/styles/wide-grid.css` for the agenda
   placement grid. Include room position in the agenda projection, put newest rooms at
   the leading edge, keep the time column sticky, and add a reserved scroll affordance
   so a newly authored room is visible at the initial 1280px view without a blind hunt.
5. Run focused tests and A/B the regression against `github/main`, inspect the exact
   diff, then run serialized `npm test` and `npm run pr-gate` through the box-wide gate
   lock. Commit, push, open one PR, comment the root cause/evidence/PR on MRQ-183, and
   transition the task to `pr_open`; do not merge or deploy.

Non-goals: migrations, schema migrations, a second conflict detector, changes to the
evaluation machinery, deployment, or unrelated agenda views.
