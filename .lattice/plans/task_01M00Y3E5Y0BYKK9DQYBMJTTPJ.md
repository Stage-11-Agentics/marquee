# MRQ-205: Outreach: rename, target conference on cards, overflow hygiene, person-record linkage

## Approach

- Inspect the current sourcing pipeline routes, schema, seed, people drawer, compose path,
  and list-query seam on `github/main`; preserve MRQ-203's nav work and the org-scoped
  `people` model.
- Add a nullable `target_event_id` foreign key to outreach cards with a migration,
  repository/API round-trip, and seed data that points one org-level funnel at two events.
- Rename only the outreach surface's page title, breadcrumb, definition, KPI/copy, and
  add-prospect action. Keep all filters, sorting, pagination, and search server-side.
- Render conference targets, next-touch dates (overdue tint and ordering), full-name
  tooltips, bounded target text, and a contained stage control. Link a live card from the
  person drawer back to the outreach board.
- Add the ruled CRM affordances: person-level do-not-contact toggle and named exclusions
  in compose/bulk mail, plus Export CSV beside Import. Do not put workflow state on
  `people`.

## Verification plan

- Add hermetic unit/API regressions for target-event create/list/update and legacy null
  rows, two-event seed coverage, drawer linkage, do-not-contact exclusion notice, and
  server-side list/filter behavior.
- Add DOM/browser assertions for the von-Habsburg-length name: name and target ellipsize,
  full-name tooltip exists, and the stage selector's rectangle stays inside its card.
- Add a grep-style outreach-copy assertion rejecting any four-digit year in static
  outreach copy.
- Run focused tests, `npm test`, and `node scripts/checks/pr-gate.mjs`; record each status
  field rather than treating timing warnings as failures. Start the local Worker with
  `INSECURE_LOCAL_COOKIES=1` as needed and smoke the actual outreach/list/drawer/compose
  flows. Attach validation evidence before opening the PR.

## Handoff and boundaries

- Work only in `../Marquee-worktrees/mrq-205-outreach`, cut from `github/main`; do not
  merge or deploy. Rebase only on the captain's order or a conflicting PR.
- Commit meaningful units early, push the branch, and open one PR against `main` with
  exact check statuses. The merge captain owns review, rebase coordination, and merge.
