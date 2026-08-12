# MRQ-94 implementation plan

## Judgment call

The public agenda will show the whole published program by default. Agenda is the
conference site's front door, so the honest and useful default is the complete program;
day one remains an explicit choice. The rendered `All days` state and the server's
selected scope will use the same `day=all` representation.

## Approach

1. Align the server and query contract in `src/lib/public-site.ts` and
   `src/routes/public-agenda.route.tsx`: an omitted day and explicit `day=all` both
   load every published session, while an explicit concrete day remains filtered. Return
   `filters.day = "all"` for the whole-program scope so the UI can show its selection.
2. Update `src/ui/public/agenda/PublicAgendaPage.tsx` to add the fixed-width `All days`
   tab, mark it active for the whole-program scope, remove the attendee-facing raw JSON
   link, and change the public brand link to `/`. Preserve the existing detail-page
   `← Agenda` actions so session and speaker pages remain one click from the agenda and
   the shell is one click from the conference home.
3. Keep the empty-state distinction honest: a concrete track/search/day miss may offer
   `Show full agenda` and clear every query filter; an unfiltered empty published program
   must say `No published sessions yet` and must not claim a filter exists.
4. Add focused regression coverage for the default/all-days/concrete-day scopes, active
   tab state, empty-state copy and reset link, removal of the JSON link, home/agenda shell
   routes, endpoint retention, and the embed surface. The embed only filters track/status,
   so its reset already changes the result and does not share this no-op defect; leave its
   behavior unchanged and record that finding in the PR.
5. Validate the exact branch with focused tests, `npm test` within the 45s suite budget,
   and a local Worker on an isolated port. Drive `/agenda`, a filtered empty state,
   `day=all`, a session page, and a speaker page with the c11 embedded browser; capture
   screenshots. Do not deploy or claim live-site validation. Live production may only be
   read for stale-build context if needed.
6. Commit the plan and implementation separately, push only to the `github` remote,
   refresh exact base/head evidence, open one PR against `main`, and record local
   validation plus the explicit post-merge deployment requirement in the PR and Lattice.

## Scope and non-goals

- Reuse the existing public shell, public classes, loader, and endpoint; no parallel public
  API or visual system.
- Do not remove or alter `/api/v1/public/agenda`, embed configuration, unrelated public
  defects, deployment configuration, or production state.
- Preserve Flight Deck spacing and the no-layout-jump rule by keeping the day controls at
  a stable reserved width across selected states and responsive layouts.

## Reset 2026-08-12 by agent:delegator-mrq-94
