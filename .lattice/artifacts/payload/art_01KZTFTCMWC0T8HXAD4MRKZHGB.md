# MRQ-106 review — Wave 0: eval free wins and truthful notes

**Reviewed commit:** `e7a85d5` (== branch HEAD `mrq-106-wave0-sweep`)
**Base:** `github/main @ 23a06b0`
**Reviewer:** self-review (fallback). The auto-fired single reviewer
(`lattice code-review`, pid 84684) died at 159s with
`exited with code 1 · stderr: "You've hit your session limit · resets 6am (America/New_York)"`.
Per COMMON's timebox rule, a dead review does not block the PR; it is replaced
by this one and the fallback is named in the completion comment.

**Verdict: PASS**

## What the diff lets a caller do that it should not

Reviewed adversarially, the way a caller would probe it.

- **`check-routes.mjs` runs at build time only.** It reads three repo files and
  writes one. It is not imported by the Worker and adds nothing to the bundle.
  It imports `route-table.ts` — a module with no runtime imports and no side
  effects — so the import cannot execute anything unexpected.
- **The route map exposes no secret.** It lists paths that are already public in
  the served bundle. Nothing account-shaped, nothing from `.eval-kit` (which is
  gitignored, was edited only in the primary checkout, and appears nowhere in
  `git status`).
- **The new count request cannot widen access.** It is the same list endpoint
  the page already calls, with the same session, a `status` value the endpoint
  already accepts from the filter dropdown, and `per_page=1`. A caller could
  reach it by choosing "Accepted (any stage)" from the visible filter.
- **The escape link cannot navigate anywhere unexpected.** `acceptedAnyParams`
  copies the *current* params and sets one key; the target is always
  `/submissions?…`, an internal push.
- **`external: true` on `/embed/config` is load-bearing, not decoration.**
  Without it the shell would client-push to a route `app.tsx` classifies as
  public and `AppShell` does not render, drawing "this route is not installed"
  over a working builder. Verified in a real browser: the builder renders
  tracks, formats, and a snippet (`hasSnippet: true`).

## Findings

| # | Severity | Finding | Resolution |
|---|---|---|---|
| 1 | Major | Both the above-table note and the empty-state row rendered the same "N accepted overall / View all accepted" message when the stage list was empty — two competing escapes on one screen. | Fixed in `e7a85d5`: exactly one owner per state. The table's 300px empty state carries it at zero rows; the note above carries it when the list is non-empty. Asserted in `tests/node/wave-0-sweep.MRQ-106.test.mjs`. |
| 2 | Minor | `data-accepted-escape` was an unused attribute. | Removed. |
| 3 | Nit | The count `useEffect` sits between `const rows` and `const selectedCount` rather than with the other effects. | Left as is — it must read `envelope`, which is derived there. Hook order is unconditional and stable. |

## Elements-never-jump audit (house rule)

- `.accepted-any-note`: rendered from the moment the filter is on, `min-height: 30px`, text `transparent` until known, its button `visibility: hidden` until known. Nothing below it moves when the count lands.
- `.accepted-escape` (empty state): `min-height: 18px`; the escape button is rendered in both states and hidden, so "Clear filters" never slides sideways. `visibility: hidden` also removes it from the tab order, so no control is offered that does not work.
- The empty-state cell was already a fixed `height: 300px`.
- Both counts use `font-variant-numeric: tabular-nums`.
- `.event-context` replaces `.event-switcher` at the same place in the flow with the same two-line shape; the responsive rules that hid the old class hide the new one.

## Contract checks

- `verify-design-contract.mjs` asserts route-table labels are present, not absent — the three added rows pass.
- `tests/unit/route-table.test.ts` CONTRACT order updated deliberately and annotated; this is the one departure from the binding prototype's navigation, and it is flagged to the Orchestrator rather than resolved by editing `DESIGN.md`.
- `tests/node/mrq-99-organizer-copy.test.mjs` keeps MRQ-99's real intent (no `unavailable` overlay, no dead end) while asserting the honest new element.
- No contract doc edited. No AC ID minted (`tests/ac-claims/MRQ-106.json` claims none).

## Evidence

Real-browser and real-HTTP, not asserted:

- Live headshot upload on `marquee.stage11.dev` — passes (the gate result).
- Sidebar hrefs read from the live DOM include `/submissions`, `/submissions/new`, `/embed/config`; `.event-context` reads "Conference / AIE NYC 2026"; `.event-switcher` is gone.
- `/embed/config` renders its builder with real tracks and a snippet.
- `/agenda` serves `Agenda data ↗` → `/api/v1/public/agenda?event=aie-ny-2026` → `200 application/json`.
- The premise, on real data both locally and live: `status=accepted` → **1**, `status=accepted_any` → **62**.
- `check-routes.mjs` passes clean and fails on injected drift.

**One gap, stated plainly:** the accepted-count note was not observed rendering
in a browser. Every client-side `fetch` in the c11 WKWebView surface returns
`unauthenticated` against the local dev server, because the session cookie is
`Secure` and the dev origin is plain `http` — so no client-fetch behaviour can
be validated there. The predicates behind the note are covered by unit tests
against the real seed's numbers, and its reserved-space markup by source
assertions.
