# MRQ-4 self-review (fast-track; headless code-review suspended this run)

**Reviewed commit:** `b503e12` (== branch HEAD, `mrq-4-seed`)
**Base:** `forgejo/master @ c1ef186`
**Reviewer:** agent:delegator-mrq-4 (Opus), independently of the Sonnet implementer
**Verdict: PASS**

## What was verified independently, not accepted from the implementer's report

### 1. The inherited-code defect is real — confirmed against the source's own counts

The implementer changed `_source.ts::contentSessions()` from a `type ∈ {TALK, WORKSHOP}`
filter to "grid items naming at least one speaker". I re-derived both selectors
directly from the capture rather than trusting the claim:

```
OLD filter: sessions 60 speakers 72
NEW filter: sessions 60 speakers 75
OLD wrongly included: AI Leadership Welcome · Workshop Day and Online Track
                      Welcome · Workshop Afternoon Break
OLD wrongly excluded: Building (Agents) with Model Context Protocol ·
                      An Opinionated Blueprint for the Future of GenAI
                      Applications · Agent Memory and the LLM OS
```

The source file asserts its own ground truth in `_counts`:
`content_sessions_talk_or_workshop: 60`, but `content_sessions_with_named_speakers: 57`,
versus `all_items_with_named_speakers: 60` / `unique_speakers: 75`. The old filter hit
the right *count* by coincidence while seeding **a coffee break as an accepted
conference abstract** and losing three real workshops and three speakers.

This defect predates this ticket's Claude custody and would have reached MRQ-5, MRQ-7
and MRQ-9 silently — every one of them consumes this spine. The fix is correct and the
docstring records the reasoning. Note the inherited plan's "synthetic staff submitter
for the three speakerless program items" was a *workaround for this same bug*: the
three speakerless items were the tell, and were rationalized rather than diagnosed.

### 2. Live-database validation, re-run from scratch on my own queries

Fresh throwaway D1, `0001_init.sql` applied, then `npm run seed`. Seventeen invariants,
written independently of the implementer's test file:

```
formats 4 · tracks 8 · buildings 3 · rooms 10 · rooms_orphaned 0 · waves 3
task_templates 6 · people 76 · submissions 60 · subs_accepted 60 · participations 77
BAD_real_emails 0 · BAD_headshots 0 · BAD_subs_no_speaker 0 · BAD_orphan_particip 0
BAD_dup_person_email 0 · BAD_break_seeded 0
failed invariants: 0
PRAGMA foreign_key_check → 0 violations
```

`BAD_break_seeded` (submissions titled Break/Welcome) is the regression guard for
finding 1 above and reads 0.

### 3. Idempotency proven against a live DB, not against generated text

Seed run a second time against the same populated database; row counts snapshotted
across **every** populated table before and after and compared as whole objects:

```
IDEMPOTENT: identical row counts across every populated table
```

This is the property MRQ-5 depends on to layer the 940-row pool onto the spine without
a wipe, so it was worth proving on the real path rather than on the SQL string.

### 4. Public-repo hygiene

Full committed diff scanned for credentials, tokens, internal hostnames, c11 refs and
absolute paths: clean. Every email string in the seed tree is `@example.com`
(`firstname.lastname@example.com`, `program.committee@example.com`). No headshots
seeded (`BAD_headshots 0`). Real names appear only on the real accepted core, which is
public program data — as SPEC §6 intends. Working tree clean; `ac-coverage.json` is
gitignored.

### 5. Gate

`npm run pr-gate -- --ticket MRQ-4` → **pass**, 5396 ms. `trace:ac` merged scope: 197
live criteria, 0 uncovered, 0 errors, 0 warnings. Default suite 2.55 s against a 30 s
budget — the fleet's inner-loop clock is not degraded.

## Findings

**No blocking findings.** `scripts/seed/index.ts` holds its ownership contract
correctly: it discovers siblings by glob and never names them, so MRQ-5 adds
`order >= 30` seeders with no edit to this ticket's flagged shared file — verified by
reading the discovery code, not by assertion. `--remote` + `--persist-to` are rejected
as a pair, and the temp workspace is removed in a `finally`.

Nits, none worth blocking on: the seed writes `CI=1` into wrangler's env unconditionally,
which is right for determinism but undocumented; and `buildSeedSql` duplicates the two
lines of `main`'s SQL assembly rather than being called by it.

## Carried forward (not defects — routing)

1. **Zero accepted submissions land on the Lightning format.** The plan's mapping is
   `<=10 min -> Lightning` and the shortest real 2025 session is 12 minutes. Nothing in
   the DB is inconsistent (submissions carry no duration) but the demo shows an empty
   Lightning format until MRQ-5's pool populates it. Implemented as the plan specifies
   rather than re-litigated mid-ticket.
2. **`memberships` are unseeded**, including the `speaker` membership SPEC §3.2 says
   acceptance grants. Correctly M-04b per the B-5 split — but the speaker portal step of
   the walkthrough needs it, so it is MRQ-5's to land.
3. **Adversarial B-3** (demo organizer reviewer membership, all-track scopes, round-1
   assignments over ~40 unreviewed submissions) remains MRQ-5's. Without it walkthrough
   step 8 dead-ends on "no matching track scope".
4. **`buildings` has no geography columns** while commit `222a7fe` makes building
   `lat`/`lng`/`accessMinutes` binding for travel-conflict detection. MRQ-2 is merged, so
   a follow-up migration is owed. This ticket seeds what the schema can hold.
5. **Test placement deviation accepted.** `tests/node/seed-spine.test.mjs`, not
   `tests/unit/`: the vitest suite runs in the Cloudflare Workers pool where real
   filesystem reads throw, and the seed reads its source data off disk and never enters
   the Worker. `tests/node` is the runtime the seed actually ships on. Both machine
   contracts still hold — `npm test` runs it and `trace:ac` registers the `AC-8 ·` /
   `AC-252 ·` coverage. The alternative was a test-only injection seam in production
   code, which is a worse trade.
