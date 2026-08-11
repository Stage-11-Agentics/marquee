# Code Review: MRQ-4 — Seed generator spine

## 0. Reviewer's note on the review packet

The "Diff" section embedded in the review prompt only contains the
`sequence/run-state.md` decision-log edit (the Kimi→Claude fleet-switch
note) — it does not contain the actual MRQ-4 implementation. That
implementation exists as 5 real commits on the `mrq-4-seed` branch/worktree
(`b503e12`, 5 commits ahead of `forgejo/master`, working tree clean, nothing
uncommitted). I reviewed that branch directly — `git diff forgejo/master...mrq-4-seed`
— rather than the packet's diff, and ran the actual build/test/gate commands
against it. The findings below are against the real, committed implementation.

## 1. Verdict

**PASS**

## 2. Summary

`scripts/seed/` builds the full Wave-0 spine (org/event/formats/tracks/venue
model/waves/forms/task templates) plus the 60-session, 75-speaker accepted
core, exactly matching the source data's own asserted counts. I ran the seed
for real (`node scripts/seed/index.ts --sql-only`), diffed two consecutive
runs (byte-identical, confirming idempotency), ran `node --test
tests/node/seed-spine.test.mjs` (7/7 pass), `npm test` (12/12 pass, 2.6s),
`tsc -p tsconfig.test.json --noEmit` (clean), and `npm run pr-gate --
--ticket MRQ-4` (pass, including `trace:ac` with 0 uncovered claims). Every
row shape checked against `migrations/0001_init.sql`'s CHECK constraints and
foreign keys with no mismatches found. The five deliberate deviations from
the ticket's verbatim text (building trio not quartet, `package.json` seed
script + engines bump, the extra `Online` room, `forms.kind='session'` for
the hotel/travel task form, the invented 8th track color) are each
correctly justified against binding docs (SPEC Amendment 11, the schema's
own CHECK constraints, DESIGN.md) and were flagged in the plan as required
by the fast-track contract.

## 3. Issues

No issues found.

## 4. Positive Observations

- **Collision handling is actually correct, twice.** Both `syntheticEmail`
  (`src/lib/ids.ts:35`) and `personIds` (`scripts/seed/accepted-core.ts:125`)
  guard against two source speakers producing the same slug/email with a
  deterministic `-2`, `-3`, … suffix loop, rather than assuming the 75 names
  are collision-free. Easy to have skipped given the small speaker count.
- **Idempotency is proven, not just asserted.** `tests/node/seed-spine.test.mjs`
  has a dedicated `buildSeedSql()` × 2 byte-identity test, and I independently
  verified this by running the CLI twice and diffing stdout — identical.
- **`index.ts`'s glob-discovery contract is real, not just documented.**
  `discoverSeedFiles()` excludes `index.ts` and `_*.ts` by filename pattern
  rather than an explicit registry, and a test (`the orchestrator discovers
  seeders by glob, not by name`) locks that in — exactly what M-04b needs to
  add `pool.ts`/`agenda.ts`/etc. without ever touching the owned shared file.
- **Track/format/room assignment logic is well-reasoned and tested.** The
  `primaryTrackKey` keyword scorer and `formatIdFor` mapping both have
  doc comments explaining *why* (e.g. why type-based filtering would wrongly
  seed a coffee break as an accepted talk), and the counts they produce were
  cross-checked against the source JSON's own self-reported totals
  (60 sessions / 75 speakers / 60 unique slugs) — they match exactly.
- **Every schema deviation is honestly surfaced.** The `forms.kind`
  gap (no dedicated task-form kind exists in the schema; `session` is used as
  the least-wrong value) and the invented 8th track color are both called out
  in code comments *and* in the plan's "Deviations" section, not silently
  smoothed over.
- **No security concerns.** No stdlib HTTP calls (trap 16 correctly assessed
  as N/A), `spawnSync` invoked with an argument array (no shell injection
  surface), SQL string values escaped via quote-doubling, table/column names
  always hardcoded internal identifiers rather than derived from data.
- **Test suite stays inside the repo's fast-suite budget.** `npm test`
  completes in ~2.6s against a 30s budget, consistent with the project's
  "fast tests are non-negotiable" convention.
