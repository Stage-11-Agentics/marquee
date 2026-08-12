# MRQ-98 implementation plan

## Scope and base

- Work only on the submissions list presentation/performance surfaces named by
  MRQ-98: `SubmissionsPage.tsx`, additive submissions CSS, a small pure request
  helper, and focused tests. Leave `src/routes/submissions.queries.ts`,
  `STATUS_OPTIONS`, the status `<select>`, and status styles to MRQ-97.
- The isolated branch is rebased onto the current `github/main`; it must have no
  branch-only commits before implementation. MRQ-97 is not pre-merged into this
  branch; after MRQ-97 merges, rebase this worktree then re-run `npm ci` and the
  exact-head gate. The shared checkout remains the Lattice board only.
- Do not add a cache layer, state library, prefetch framework, API contract, or
  second saved-views UI. Preserve the endpoint's 50-row page contract.

## Baseline and falsifiable measurements

1. Run `npm test`, recording both the runner status and Vitest duration. Run
   `npm run check:speed` and record its submissions first-interactive and
   filter-sort p95/summary values. These are regression guards, not proof that
   the UI transition itself improved.
2. In the local browser, instrument one representative view/filter switch with
   `PerformanceObserver({ type: "layout-shift", buffered: true })`, excluding
   `hadRecentInput`, and record cumulative layout shift plus time from the
   interaction to the first new painted row. Repeat the identical flow after the
   change. Capture a screen recording of the transition and a screenshot of the
   settled list; still frames alone cannot prove no shift.

## Implementation

1. Add `src/ui/submissions/list-request.ts` with pure helpers for a canonical
   submissions request key, the exact `per_page=50` query construction, and a
   current-request/sequence check. Unit-test those helpers with real assertions;
   keep existing source-text tests as wiring checks only. The component will use
   an `AbortController` plus a monotonically increasing request id so an abort-
   ignoring or out-of-order response cannot commit. The key will be independent
   of URL parameter order, while `reloadKey` remains an explicit force-refetch
   trigger after mutations.
2. Make list loading stale-while-revalidate. On a subsequent query, retain the
   last successful envelope and rows, set `aria-busy`, disable selection inputs
   during refresh, and show a fixed-height inline update/error message. Do not
   replace usable rows with a blank/loading state. Skip equivalent query changes
   through the canonical key, but never skip a `reloadKey` refetch. Keep the
   existing selection reset authoritative when a new result commits so stale ids
   cannot be bulk-mutated.
3. Replace the current 430px table floor with a real first-load frame: render 50
   skeleton rows at the existing 58px row height while there is no envelope, and
   reserve the same 50-row body height for the table frame after load. This is a
   deliberate fixed-page tradeoff: a short result may leave quiet space below it,
   but the organizer's toolbar and rows never collapse/re-expand between the
   50-row page states. Use existing tokens and a small skeleton treatment; no
   decorative animation.
4. Keep every independently loading strip stable. Make the notification status
   element unconditional (toggle visibility, as the export/status reservations
   do), give the saved-view chips a fixed one-row/scrolling frame or loading
   placeholders so chips cannot wrap the card when their request resolves, and
   give the page-header copy a stable minimum line box. Preserve the existing
   `saved-view-strip` as the one return path.
5. Make saved views legible and confirm saves in place. Label the existing strip
   visibly as `Saved views`, use a semantic group/live status, keep chips active and
   reachable, and after a successful save say which named view is ready above the
   filters. Clear success/error messages deliberately around later operations; do
   not redesign persistence or add another destination.
6. Replace the hardcoded search placeholder with `envelope.total`, the same
   filtered number used by the summary line. Before the first envelope use the
   honest non-numeric `Search submissions…`; do not flicker through a fake count.
   Widen only `.search-field` and toolbar-spacer flex rules so the search control
   grows and the existing status/type/track controls remain outside MRQ-98's CSS
   ownership. Do not edit the shared input/select rule, status styles, or status
   markup. Keep the full placeholder visible at representative desktop/tablet/
   mobile widths.
7. Add progressive search only after the continuity path works. Debounce at 180ms
   (borrowed from the public agenda's interval), reuse the same request/cancel/
   sequence guard as the list and the `QuickSearch.tsx` pattern, and keep the
   submit button. Debounced URL updates use `history.replaceState` plus the
   router's `popstate` signal rather than `pushState`/`scrollTo(0, 0)`, so typing
   does not create one back-stack entry per pause or scroll the operator away.
   Avoid writing the URL value back over a focused input, retain focus/caret, and
   keep selection safe while refresh is active. If this path creates a jump or
   threatens the core fixes, leave the button path as the shipped behavior and
   document the stretch-goal deferral.

## Verification and handoff

1. Add focused unit coverage for canonical key/query construction and latest-
   request acceptance/rejection. Add source-wiring assertions only where the
   repository's node tests require them; browser automation is the behavioral
   proof for row continuity, skeleton geometry, no stale overwrite, focus/caret,
   saved-view confirmation/reachability, and responsive placeholder rendering.
2. Run `npm test` within the 45s suite objective where machine contention allows,
   `npm run check:speed`, and the exact `npm run pr-gate -- --ticket MRQ-98`.
   A passed-but-over-budget baseline or gate is reported as such, not relabeled.
3. Start the local Worker without deploying. In c11's embedded browser, exercise
   initial load, saved-view load/save/reopen, view/filter switching, rapid search
   edits, an out-of-order response probe if the local surface permits it, and
   representative widths. Collect the layout-shift and first-row timings, capture
   the transition recording/screenshot, and note unrelated live-site defects in
   Lattice without fixing them.
4. Commit the focused diff, verify `github/main` ancestry and exact HEAD, push to
   GitHub, and open `gh pr create --repo Stage-11-Agentics/marquee --base main`.
   The PR will state that the change is locally validated but still needs the
   post-merge deploy; do not run `wrangler deploy`.

## Judgment calls

- Fixed 50-row reservation is chosen over releasing to natural short-result
  height because this page's contract is a 50-row working frame and the ticket's
  through-line is no movement during view changes. The empty space is quieter
  than a 2,500px collapse/re-expansion and is measurable in the browser.
- The placeholder follows `envelope.total`, even under non-search filters, because
  that is the real count paired with the summary line; the pre-load state makes no
  unsupported numeric claim.
- Saved-view feedback is inline and names the destination. The existing chips are
  the canonical return path; no parallel saved-view navigation will be built.
