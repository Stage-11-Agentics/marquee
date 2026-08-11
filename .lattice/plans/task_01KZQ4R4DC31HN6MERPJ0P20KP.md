# MRQ-58: Venue geography migration — buildings lat/lng/access_minutes

## Decision

Use per-building geography columns, not a pairwise travel join table. Commit
`13d37eb`'s venue-map brief defines walking time as a calculation from the
origin/destination coordinates and treats `accessMinutes` as ingress overhead
on the destination building. The database therefore needs nullable `lat` and
`lng` plus non-negative `access_minutes` on `buildings`.

## Implementation

- Add `migrations/0002_venue_geography.sql` with additive `ALTER TABLE`
  statements. `migrations/0001_init.sql` remains untouched and immutable.
- Mirror the three columns in `BuildingRow` in `src/db/schema.ts`.
- Add the SPEC §6 seed values in `scripts/seed/event.ts`: the Sheraton and
  Workshop Annex share the verified 811 7th Avenue coordinate; Online has null
  coordinates and zero access minutes.
- Keep schema verification and integration-test migration setup on the full
  migration chain so the new migration is exercised without changing their
  existing fixture semantics.

## Evidence

- Add contract-shaped tests for the migration declarations and the three
  seeded geography records. This ticket owns no AC IDs directly, so no
  `tests/ac-claims/MRQ-58.json` file will be created and the PR body will say
  so explicitly.
- Run the hermetic suite, inspect the exact diff, run the required
  `npm run pr-gate -- --ticket MRQ-58`, and perform a direct migration/seed
  smoke check before opening the PR.

## Non-goals

- Do not edit contract documents or `0001_init.sql`.
- Do not implement the travel-conflict detector here: no such detector exists
  in this branch; the new columns are the schema/seed contract its follow-up
  reader will consume.
