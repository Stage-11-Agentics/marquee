# MRQ-203: Sidebar reorg fold — nav structure, stage flyout, Lists into People, centered page column

Branch `mrq-203-sidebar-fold`, cut from `github/main` @ cdcc4883. Contract ticket of the
sidebar round: MRQ-204/205/206/207 rebase onto this merge, so the diff stays inside §T1 and
lands first. PR #224 is already merged into the base — nothing to absorb.

## 1 · Route table (`src/ui/shell/route-table.ts`)

- `RouteGroup` becomes `organization | conference | speaker-ops | cfp | public-links |
  settings | utility`. The `home`/`pipeline`/`modules` groups retire.
- The seven pipeline rows keep their **paths and ids** and lose `sidebar: true`. Nothing that
  resolves today may 404 after; the flyout is what consumes them now.
- Renames, ids unchanged so sibling tickets inherit them cleanly:
  `people` → "People CRM" · `sourcing` → "Outreach" · `dashboard` → "Program pipeline" ·
  `forms` → "Forms" · `evaluation` → "Evaluation" · `reviewer` → "Reviewer" ·
  `settings` → "Settings" · `delivery-health` → "Follow-ups".
- `submission-new` leaves the nav (the `+` on Abstracts & sessions replaces it); route stays.
- Icon curation: geometry glyphs go; survivors are leading ↗ on external rows, ✉, ⚙, ⌘, ↻.
  The 16px column stays reserved on every row so labels never shift.
- The comment arguing against "CRM" is rewritten — superseded by the R5 operator ruling.
- **MRQ-207 boundary:** the ruled Organization group is Home · People CRM · Outreach ·
  Settings, but the build has no org Home and no org Settings route. Minting rows to pages
  that do not exist would be a dead end, so this ticket ships People CRM · Outreach and
  leaves the group open; MRQ-207 adds `group: "organization"` rows with no Sidebar.tsx conflict.

## 2 · Sidebar (`src/ui/shell/Sidebar.tsx`)

Groups in ruled order, "Conference" group label above the switcher (the eyebrow inside the
button goes, picker-to-first-row gap 6px), `+` affordance on Abstracts & sessions
(stopPropagation → `/submissions/new`), footer API & CLI · System health · Reset demo.
Narrow-rail first-letter fallback ported from the prototype for rows with no glyph.

## 3 · Stage flyout (new `StageFlyout.tsx` + snapshot store)

Fixed-position panel off the Program pipeline row: "Overview · all stages" first (same
destination as the row's own click), then stages 1–7 with live counts. Counts come from a
publish/subscribe snapshot store — `DashboardPage` publishes its existing 5s poll, the
sidebar reads the cache and polls slowly only when nobody else is refreshing. **Zero fetch
on hover.** One shared 150ms-in / 220ms-out hover-intent timer; opens on keyboard focus;
`display: none` under 1000px. `Sidebar.tsx` itself stays free of `apiFetch` (AC-280).

## 4 · Lists into People

`/lists` renders inside the People screen as a tab; the People row stays active
(`activeNavId` already maps it); `/lists` URLs keep working. Toolbar entrance reads
`Lists · N` per the prototype.

## 5 · Centered page column

`.page` already carries `margin: 0 auto; max-width: 1500px`. Audit for per-page divergence
and kill any override rather than re-fixing what is already right.

## Verification

`routesFor` snapshot per group · route-reachability over every pre-existing path · flyout
(hover, focus, counts equal snapshot, closes on click, absent < 1000px) · `/lists` inside
People with active state · register themes with no dangling nav ids · `npm test`,
`check:design`, `check:routes`, `trace:ac`, `pr-gate` · browser smoke of the real dev server.

Contract files this ticket necessarily updates: `scripts/checks/verify-design-contract.mjs`
label list, `tests/unit/route-table.test.ts`, the `people.MRQ-131` "never CRM" assertion
(superseded by R5), swyxy `navLabels`, `docs/ROUTES.md` (regenerated).
