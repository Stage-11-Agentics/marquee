# MRQ-215 — Mobile update: drawer nav + phone-width sweep

## Objective

Implement the binding `prototypes/mobile-nav/index.html` fold and the complete M-01..M-35 390px QA register in one reviewable branch and one PR. At phone width (<=760px), the shared Sidebar becomes an overlay drawer behind the hamburger; the bottom strip is removed; the mobile topbar exposes conference identity, QuickSearch, and account access without page overflow. The 761–1000px icon rail remains unchanged.

## Scope and approach

1. Topbar/M-01 first: make the shared topbar fit the viewport (`flex: 1; min-width: 0` search), add the mobile hamburger and conference-name door, collapse search to the QuickSearch icon, keep the avatar reachable with a 40px hit area, and preserve desktop/reviewer/portal shell behavior.
2. Drawer fold: reuse Sidebar markup in AppShell and DeliveryHealthShell, add scrim/close/navigate/Escape dismissal, dialog semantics, focus return, page-scroll lock, 160ms reduced-motion-safe transitions, themed drawer scrollbars, switcher/footer parity, and retire strip geometry plus the 88px bottom reserve together. Keep the ≤1000px media rule prefix-first and banded to `min-width: 761px`.
3. Grid family: constrain outer tracks with `minmax(0, 1fr)` and collapse fixed-minimum inner grids at phone width for dashboard, delivery health, evaluation, and submission record (M-04/M-13/M-14/M-23).
4. Shared touch geometry: apply the <=760px target floor to controls, checkboxes, selects, chips, tabs, buttons, name controls, reorder actions, and public agenda controls without making labels or toggles jump.
5. Table families: make the purpose-bearing status/action fields readable at phone width for roster, onboarding, communications, files, and People/Outreach; use the existing narrow-screen card/priority patterns and keep intentional kanban/matrix inner scrolling discoverable.
6. Pagination: paginate roster and onboarding (and any affected large list where the existing server-side pattern applies), preserving server-side search/filter/sort and stable controls.
7. Polish/edge sweep: portal visually-hidden file input and task title treatment, speaker record drawer overflow, account menu, fixed-width columns toggle/counter, scroll affordances, message status, form action layout, no-jump reservation, and mobile conference identity/a11y cleanup. Keep the strip and `.page` bottom padding change atomic.

## Verification plan

- Baseline before implementation: `npm test` after `npm ci`: 203 files / 1,434 tests passed; status `pass-over-budget`, 60.824s / 45s objective, with existing missing-secret warnings.
- Add or update only the MRQ-203 contract assertions whose <=760 contract changes; keep tests focused and fast. Run affected unit tests after each logical commit, then `npm test` and `npm run pr-gate` under the shared gate lock before opening the PR.
- Browser validation is explicitly approved by the ticket: use c11 embedded browser surface `surface:413` in workspace `workspace:23`, an isolated pane exactly 390px wide. Start `npx vite dev`, sign in through the demo login, walk every admin route, and measure `document.scrollWidth === document.documentElement.clientWidth` on each route. Drive prototype-parity drawer flows: hamburger/conference door, focus to close, scrim, close button, Escape, navigation dismissal, focus return, switcher, footer theme, scrollbar/scroll lock, and account menu. Verify dashboard and delivery-health at rest, roster/files status visibility, and roster/onboarding pagination. Record observed route-by-route measurements and interactions in a Lattice validation comment.
- Keep inference separate from observed browser/runtime evidence in the handoff.

## Artifacts and handoff

- Logical commits follow the numbered scope above and map M-numbers in the PR body.
- Branch `mobile-nav-drawer` is pushed to `github` and the PR is opened against `main`; do not merge.
- Transition MRQ-215 through `in_validation` only after recorded browser evidence, then to `pr_open` with the PR URL and gate result. Send the same completion summary to workspace `workspace:10`, surface `surface:401`.

## Non-goals

- Do not add a second navigation implementation or change the 761–1000px icon rail.
- Do not turn the program board into single-column mode; its intentional kanban scroller remains.
- Do not change reviewer/portal shells beyond the specific M-24/M-25 portal and M-26 record-drawer phone fixes.
- Do not merge or deploy.
