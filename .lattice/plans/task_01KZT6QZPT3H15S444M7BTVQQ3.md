# MRQ-102 execution plan

## Scope

Split the existing delivery-health surface into two real browser routes without
an API or schema change:

- `Speaker follow-ups` in the `modules` sidebar group, carrying owed speakers
  and quota facts that explain whether people can hear from the organizer.
- `System health` in the `utility` sidebar group, carrying only capability and
  infrastructure facts.

Preserve the current external/full-navigation behavior and fixed-shape loading
layout on both pages. Keep all edits inside the ticket's ownership list; do not
touch submissions, Topbar, Sidebar, seed scripts, or migrations.

## Implementation

1. Baseline `github/main` in an isolated `mrq-102-health-split` worktree and
   inspect the existing health derivation, shell, route, and tests.
2. Refactor `src/lib/delivery-health.ts` into explicit speaker-follow-up and
   system-health summaries. Keep quota copy tied to the connected email
   configuration and Resend ceiling. Add a stable urgent-ledger destination
   whose filter semantics and displayed/capped count agree with the headline.
3. Split the owned health UI into the two route shells/pages, preserving the
   fixed capability-row shape and using the new labels and route groups.
4. Update only the health entries in the route table, design-contract sidebar
   labels, and route-table contract tests. Add tests with `AC-<n> ·` or
   `CONTRACT ·` titles covering the seven acceptance criteria and adversarial
   summary separation.

## Verification and handoff

- Run `npm test` within 45 seconds and `npm run pr-gate -- --ticket=MRQ-102`
  within 120 seconds; record actual timings and any contention caveat.
- Start the local app, drive both routes in c11's embedded browser, and capture
  three screenshots: Speaker follow-ups, System health, and the owed-headline
  destination with matching count/cap notice. Attach them to the PR.
- Rebase onto the latest `github/main` immediately before opening the PR, run
  `npm ci`, then re-run the exact-head suite/gate. Push `mrq-102-health-split`
  to `github` and open a GitHub PR for human merge. No deployment or remote
  migration is authorized.
- Comment on MRQ-74 that MRQ-102 supersedes its single-page shape; do not edit
  MRQ-74's plan.
