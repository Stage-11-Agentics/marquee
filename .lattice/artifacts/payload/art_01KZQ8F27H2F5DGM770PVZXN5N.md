# MRQ-58 validation

Validated commit: `dc3903f47f88cca45668a0b38c801290da080074`
Lattice-Validated-Commit: dc3903f47f88cca45668a0b38c801290da080074

## Verdict

PASS

## Observed evidence

- The `migrations/0001_init.sql` object hash matches `forgejo/master`; the
  immutable migration was not edited.
- Seed rows observed from `buildSeedRows()`: Sheraton and Workshop Annex each
  have `lat=40.7625188`, `lng=-73.9814528`, `access_minutes=0`; Online has
  `lat=NULL`, `lng=NULL`, `access_minutes=0`.
- `npm run seed -- --sql-only` emitted all three `buildings` upserts with the
  new columns.
- `node scripts/schema-verify.mjs` passed: 46 tables, 116 named indexes, 89
  foreign keys, 3 triggers.

## Scope note

MRQ-58 owns no AC IDs directly; validation is contract evidence, not an AC
claim.
