# MRQ-184 implementation plan

## Scope

- Trace the existing embed configuration, persistence, renderer, and builder flow.
- Add the two missing output formats (basic HTML and XML) without changing the existing styled HTML, JSON, or iCal contracts.
- Add per-surface field selection with all existing fields enabled by default, preserving old saved embeds.
- Make preview content follow every selected output, including iCal.
- Restore the complete saved embed configuration when "Get code" is used.
- Add regression coverage that fails on the base branch for each acceptance gap and passes on this branch.

## Non-goals

- Do not add itinerary/personal-schedule embeds unless the first three gaps and the existing defects are complete, green, and the implementation is clearly bounded.
- Do not add a migration or alter the database schema. If persistence cannot represent backward-compatible field selections, stop and flag MRQ-184 for operator direction.
- Do not deploy or merge.

## Investigation targets

- `src/routes/embed*`, `src/routes/*public*`, and `src/ui/*Embed*` / `src/ui/*embed*` for route, builder, and renderer seams.
- Existing embed schema/migrations and API tests for the current saved configuration shape.
- Existing embed/e2e tests and the seeded public embed route for output and persistence behavior.

## Verification

- Run focused embed tests first, including an explicit base-branch failure check for each regression.
- Run typecheck/build and the relevant API/design checks.
- Validate the running seeded Worker or browser path if the local harness supports it; record observed output/restore behavior separately from unit assertions.
- Run `npm test` and `npm run pr-gate` only through `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/.gate-lock/gate-lock.sh`.
- Commit, push, open the GitHub PR, comment the ticket with root cause, exact verification commands/A-B evidence, and PR number, then transition the ticket through the required Lattice validation/PR lifecycle.
