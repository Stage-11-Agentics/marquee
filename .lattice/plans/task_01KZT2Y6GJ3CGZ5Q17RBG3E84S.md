# MRQ-98 implementation plan

## Scope and base

- Work on the submissions list presentation/performance surfaces named by MRQ-98:
  `SubmissionsPage.tsx`, additive submissions CSS, `src/ui/shell/router.ts` for
  a narrowly scoped replace-navigation option, a pure request helper, and focused
  tests. Leave `src/routes/submissions.queries.ts`, `STATUS_OPTIONS`, the status
  `<select>`, and status styles to MRQ-97.
- The isolated branch is rebased onto current `github/main`; it has no branch-only
  commits before implementation. MRQ-97 is not pre-merged into this branch. After
  MRQ-97 merges, rebase this worktree, run `npm ci`, and re-run the exact-head gate.
  The shared checkout remains the Lattice board only.
- No cache layer, state library, prefetch framework, API contract, or second
  saved-views UI. Preserve the endpoint's 50-row page contract.

## Baseline and falsifiable measurements

1. Run `npm test`, recording the runner status and Vitest duration. Run
   `npm run check:speed` and record its submissions first-interactive and
   filter-sort p95/summary values. These are regression guards, not proof that
   this transition improved.
2. In the local browser, instrument one representative view/filter switch with
   `PerformanceObserver({ type: "layout-shift", buffered: true })`, excluding
   `hadRecentInput`, and record cumulative layout shift plus time from the
   interaction to the first new painted row. Repeat the identical flow after the
   change. Capture a screen recording of the transition and a screenshot of the
   settled list; still frames alone cannot prove no shift.

## Implementation

1. Add `src/ui/submissions/list-request.ts` with pure helpers for the exact outgoing
   submissions query (`per_page=50`), a canonical request key made from that full
   outgoing URL's sorted entries, and a current-request/sequence check. The key
   must include `page` and every parameter actually sent; unit-test order
   independence and that page 2 and page 3 differ. The component will use an
   `AbortController` plus a monotonically increasing request id so an abort-ignoring
   or out-of-order response cannot commit. `reloadKey` remains an explicit
   force-refetch trigger after mutations.
2. Make list loading stale-while-revalidate. On a subsequent query, retain the
   last successful envelope and rows, set `aria-busy`, and show a fixed-height
   inline update/error message. Do not replace usable rows with a blank/loading
   state. Keep the existing `queryIdentity` selection reset as the single authority
   so stale ids cannot reach a bulk action; do not disable focused checkboxes during
   refresh. If a refresh fails while rows exist, retain those rows and expose the
   existing Retry action through the fixed message; retain the full-body error row
   only for a cold error with no envelope. Preserve the `initialEnvelope` seeded
   state and its early-return guard; the live sequence/cancel machinery is not
   engaged for that deterministic seam.
3. Fix the cold frame without predicting a false pixel height. Render up to the
   50-row page of skeleton rows using the same title/meta cell rhythm as a real
   submission row (two-line clamped title, metadata lines, and the reserved slot
   line), rather than treating the 58px `td` height as an exact row height. For a
   warm request, capture the current `.submissions-table-wrap` height at request
   start and apply it as an inline in-flight minimum while the old rows stay
   mounted; clear that temporary reservation after the new envelope commits. Keep
   the modest existing settled-state floor so empty/error actions remain reachable;
   do not impose a permanent 50-row blank area on short filtered results.
4. Keep independently loading strips stable. Make the notification status element
   unconditional (toggle visibility, as the export/status reservations do), give
   the saved-view chips a fixed one-row/scrolling frame or loading placeholder so
   resolving chips cannot wrap the card, and give the page-header copy a stable
   minimum line box. Preserve `saved-view-strip` as the one return path.
5. Diagnose saved views before changing the affordance: the current successful
   save path inserts the returned view into `views` and sets `activeViewId`, and its
   views-loading effect does not refetch on save, so a new chip should appear
   immediately; this is an affordance problem, not a persistence bug. Make the
   existing strip visibly read `Saved views`, use a semantic group/live status,
   keep chips active and reachable, and after success say which named view is ready
   above the filters. Clear success/error messages deliberately around later
   operations; do not redesign persistence or add another destination.
6. Replace the hardcoded search placeholder with `envelope.total`, the same
   filtered number used by the summary line. Before the first envelope use honest
   non-numeric `Search submissions…`. The field's flex/min-width sizing, not the
   placeholder string, will own its geometry; browser validation must compare the
   toolbar bounds before and after the count arrives. Widen only
   `.submissions-toolbar .search-field` and `.submissions-toolbar .toolbar-spacer`
   and add `flex-shrink: 0` to the non-search control labels so growth comes from
   the spacer, not MRQ-97's selects. Do not edit the shared input/select rule,
   status styles, or status markup. Verify desktop, tablet, and mobile widths.
7. Add progressive search only after continuity works. Debounce at 180ms (borrowed
   from the public agenda's interval), reuse the request/cancel/sequence guard and
   the `QuickSearch.tsx` ordering pattern, and keep the submit button. Extend the
   router's `navigate` API in `src/ui/shell/router.ts` with an optional
   `{ replace: true }` mode that calls `replaceState`, updates router state
   directly, and skips `scrollTo(0, 0)`; do not silently mutate history without a
   render signal. Debounced URL updates use that mode, so typing does not create
   one back-stack entry per pause or scroll the operator away. Avoid writing URL
   state back over a focused input, retain focus/caret, and keep selection safe
   through the existing query reset. If this path creates a jump or threatens the
   core fixes, ship the button path and document the stretch-goal deferral.

## Verification and handoff

1. Add focused unit coverage for canonical outgoing query construction and
   latest-request acceptance/rejection. Add source-wiring assertions only where
   this repository's node tests require them; browser automation is the behavioral
   proof for skeleton/warm geometry, no stale overwrite, focus/caret, saved-view
   confirmation/reachability, and responsive placeholder rendering.
2. Run `npm test` within the 45s suite objective where machine contention allows,
   `npm run check:speed`, and the exact `npm run pr-gate -- --ticket MRQ-98`.
   A passed-but-over-budget baseline or gate is reported as such, not relabeled.
3. Start the local Worker without deploying. In c11's embedded browser, exercise
   initial load, saved-view load/save/reopen, view/filter switching, rapid search
   edits, and representative widths. Collect the layout-shift and first-row
   timings, capture the transition recording/screenshot, and note unrelated
   live-site defects in Lattice without fixing them.
4. Commit the focused diff, verify `github/main` ancestry and exact HEAD, push to
   GitHub, and open `gh pr create --repo Stage-11-Agentics/marquee --base main`.
   The PR will state that the change is locally validated but still needs the
   post-merge deploy; do not run `wrangler deploy`. It will also record the
   intentional build-over-prototype divergence for the dynamic count placeholder:
   the prototype retains its static mock-data copy, while the live build uses the
   real envelope total as MRQ-98 requires.

## Judgment calls

- Warm stale rows plus a measured in-flight frame are preferred to a permanent
  50-row reservation: the operator sees no blank/collapse gap, while short-result
  pagination and empty-state actions remain reachable after commit.
- The placeholder follows `envelope.total`, even under non-search filters, because
  that is the real count paired with the summary line; pre-load makes no numeric
  claim.
- Saved-view feedback is inline and names the destination. The existing chips are
  the canonical return path; no parallel saved-view navigation will be built.

## Plan-review refinements carried into implementation

- Cold skeletons will cover the visible frame (about 8–10 rows, capped by the
  50-row request page), not all 50 rows; warm requests use the measured previous
  frame because stale rows remain mounted. This avoids replacing the current
  430px floor with a larger filtered-load jump.
- A successful save will make the returned chip visible without requiring the
  operator to discover horizontal scrolling; the browser check will cover six or
  more saved views at 1280px and the responsive <=1000px/<=760px branches.
- The effect will compare the canonical full outgoing key with the last committed
  key and skip an equivalent request; `reloadKey` still bypasses that comparison.
  Server TTFB and client paint will be measured separately, and any uncapped
  drafts query or per-request schema probe observed in the MRQ-97-owned route will
  be reported rather than changed here.
- Reuse the existing dashboard stale/error surface pattern where its geometry
  fits; a submissions-specific fixed band may remain only where the table needs a
  Retry control without displacing stale rows. The focused-input URL guard and
  router replace mode are required for search-as-you-type.
- Add the standard `tests/ac-claims/MRQ-98.json` manifest so the PR gate can trace
  this ticket's claims instead of relying on a missing-manifest warning.

## Reset 2026-08-12 by {'name': 'merge-agent-1', 'base_name': 'merge-agent', 'serial': 1, 'session': 'sess_01KZT4CNZA5J534NFWXB4DDE8Y', 'model': 'claude-opus-5', 'framework': 'claude-code', 'agent_type': 'merge'}
