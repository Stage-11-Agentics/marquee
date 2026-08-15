# MRQ-215: Mobile update: drawer nav + phone-width sweep (single PR)

ONE ticket, ONE PR, by operator ruling (2026-08-14): the ≤760px navigation redesign plus every phone-width defect from the mobile QA sweep merge together.

## Binding design
prototypes/mobile-nav/index.html (committed 850ccc58) — drive it. Rulings encoded there:
- ≤760px: the bottom strip is DELETED; nav becomes an overlay drawer off an ink-filled hamburger (primary-action register, 36×30, white 2px lines) top-left in the topbar. 761–1000px icon rail unchanged.
- The drawer is the Sidebar component VERBATIM — CSS repositions it, no second nav implementation. Full parity: brand, conference switcher, group labels, all sidebar rows at 40px touch height, footer.
- Mobile topbar = hamburger + flexing search + avatar, nothing else. Theme select moves into the drawer footer at phone width.
- Dismissal: scrim tap, ✕, Escape, any navigation. aria-modal dialog semantics; focus → ✕ on open, → hamburger on close; page scroll locks; 160ms ease-out, none under prefers-reduced-motion.
- Drawer scrollbar THEMED via tokens (scrollbar-width: thin; scrollbar-color: var(--line-strong) transparent + ::-webkit-scrollbar pair) so dark registers inherit. Never OS-default chrome inside themed chrome.

## Defect register (mobile QA, 390px viewport — full detail in ticket comment M-01..M-22)
Root-cause fixes, in commit order for reviewability:
1. M-01 BLOCKER, fix first: .global-search { width:100% } at ≤760 makes header.topbar 549px wide in a 373px viewport → 176px page-level h-scroll on EVERY admin screen, theme+account off-viewport. Fix: flex:1; min-width:0; theme select to drawer foot. (/reviewer has no topbar and scrolls 373/373 — proof.)
2. Drawer fold itself (see design above). The ≤1000px hides of .event-context-row/.nav-label/.sidebar-foot must band to (max-width:1000px) and (min-width:761px), WRITTEN PREFIX-FIRST so MRQ-203 contract tests' indexOf("@media (max-width: 1000px)") still matches. DeliveryHealthShell mounts Sidebar+Topbar too — wire it identically. .page bottom padding returns to normal (no strip to clear).
3. M-04/M-13/M-14 grid blowout family (BLOCKERS on /dashboard + /delivery-health, major /evaluation): outer grid tracks with auto min-content minimums compute literal 734px/635px columns in 341px containers. minmax(0,1fr) on outer tracks + single-column phone breakpoints on inner grids (344px 344px, 366px 366px, 86px 594px).
4. Touch targets app-wide (M-02/03/09/14/15/16/19 + M-11/M-17 controls): 12px checkboxes, 17-20px inputs/selects, 22-26px chips/tabs/buttons, 15px name-buttons. One breakpoint-scoped pass on shared control geometry: ≥24×24 visual, ≥40px hit at ≤760 (WCAG 2.2 AA floor is 24; Apple floor 44).
5. Tables at phone width (M-07 roster, M-10 onboarding matrix, M-11 comms, M-15 files, M-16 people): the field the screen exists for (STATUS etc.) must be visible without sideways scroll — column-priority or card-collapse. /tasks and /reviewer are the clean references.
6. M-08 + M-15/M-16 pagination: roster/onboarding render all ~508 rows (34,900px docs); /submissions' 50-at-a-time pattern already exists — apply it. R7.
7. Polish where cheap: M-05/M-18 scroll affordances, M-10 chip overflow, M-11 message-status 9px overflow, M-17 name-button above move-select spacing, M-21 public /agenda target sizes. M-06 board stays a kanban scroller (its nested-axis pain dies with M-01); single-column board mode explicitly OUT of scope.

## Acceptance
- At 390px: document.scrollWidth == viewport width on EVERY admin route (the M-20 /reviewer standard).
- Drawer full parity + all dismissal paths + focus discipline as prototyped; strip gone.
- /dashboard and /delivery-health fully readable at rest — "Plan next wave", ACT NOW banner + "Open the list" on-screen.
- Roster STATUS / files STATUS visible without horizontal scroll; roster+onboarding paginate.
- Interactive controls meet the target floor at ≤760.
- MRQ-203 contract tests updated only where the ≤760 contract changed; suite within budget; pr-gate green.
- in_validation: drive the real site at 390px (browser pane) across all admin routes + drawer flows; attach evidence.
