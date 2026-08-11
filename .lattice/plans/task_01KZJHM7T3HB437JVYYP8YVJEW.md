# MRQ-5: Seed generator — pool, evaluation, and deliberate ugliness

BUILDPLAN: M-04b — Wave 0 table (§3), runs in parallel with Wave 1's opening tickets

Scope (verbatim): The 940-row rejected/pending pool including ~40 incomplete Drafts, multi-track distribution (≥15%; ≥3 scheduled), participations, tasks, evaluations/recommendations, agenda with **two live double-bookings**, and the deliberate ugliness list. **Seeds the *demo organizer* persona a `reviewer` membership on the demo event, `reviewer_track_scopes` covering every track, and round-1 `round_assignments` over ~40 unreviewed submissions** — so the Review queue the admin sidebar links opens populated instead of on "no matching track scope", and AC-62's 20-advance speed run has material (B-3). Runs in parallel with M-09/M-10; off the CP-1 chain.

Deliberate ugliness (§1.1 / `check:seed`): a speaker on 3 submissions, a 4-person panel, an overdue task set, a live double-booking.
Amendment 5 fold: multi-track distribution ≥15% with ≥3 accepted-and-scheduled two-track sessions, asserted by `check:seed`.
Amendment 8 fold: seed obligations for the saved-views/Drafts queue (AC-247–249) land here.

File surface: `scripts/seed/pool.ts`, `scripts/seed/evaluations.ts`, `scripts/seed/agenda.ts`, `scripts/seed/ugliness.ts`

ACs: AC-3, **AC-234, AC-245, AC-246, AC-249**
Hours: 5
Workflow: inline-full
Shared files: none — per-entity seeder files only. **Never edit `scripts/seed/index.ts`** (M-04a owns it; it globs these files).
Deps: M-04a
## Ground truth and baseline

- Worktree: `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-5-seed-pool`
- Branch: `mrq-5-seed-pool`
- Planning base: `forgejo/master @ 5b9199f82be79316cbfafce54e00e38d078475f1`
- MRQ-4 spine retained unchanged: 60 real accepted abstracts, 75 real speakers,
  deterministic IDs/upserts, taxonomy/venue/waves/forms/task templates, and
  `SEED-DATA.md`. In particular, do not edit `scripts/seed/index.ts` and do not
  reintroduce filtering on the capture's unreliable `type` field.
- Baseline `npm test` cannot start because this clean worktree has no
  `node_modules/vitest/vitest.mjs`; install from the lockfile before the first
  post-plan gate, then rerun the baseline suite.

## Implementation plan

1. Add `scripts/seed/pool.ts` (order 30) for a deterministic 940-submission
   synthetic pool, bringing the total to exactly 1,000. Preserve the specified
   60 accepted core and use a status distribution of 550 rejected, 280
   in-review, 70 waitlisted, and 40 incomplete drafts. Seed one synthetic
   submitter/participation per pool record, deterministic timestamps and
   `example.com` addresses, no headshot attachment or external image request,
   and no real name or company in the fabricated pool. Give at least 150 total
   submissions a second track while preserving exactly one primary track per
   submission.
2. Add `scripts/seed/evaluations.ts` (order 40) for the demo organizer's
   event-scoped `owner`, `program_lead`, and `reviewer` memberships; a `speaker`
   membership for every person participating in an accepted submission; all
   eight organizer reviewer-track scopes; the evaluation plan, two rounds,
   rubric and committee/reviewer rows; completed assignments/evaluations with
   score fields null across approve/maybe/deny; and 40 organizer round-1
   assignments deliberately left unreviewed so the evaluation entry point has
   margin over the required 20.
3. Add `scripts/seed/agenda.ts` (order 50) to schedule a representative accepted
   slice across ballrooms, the five parallel workshop rooms, and the expo stage.
   At least three scheduled accepted submissions receive a deterministic second
   track. Build two separate person-overlap conflicts by assigning the same
   participant to overlapping accepted sessions; conflicts remain visible and
   non-blocking as required.
4. Add `scripts/seed/ugliness.ts` (order 60) for the named edge cases: long
   diacritic/hyphenated synthetic names, truncating and absurdly long titles, a
   synthetic speaker on exactly three fabricated submissions, a four-person
   fabricated panel, two required onboarding tasks for every accepted speaker,
   optional task spread, and an open overdue task set relative to the frozen
   demo clock. Keep all headshot columns null so the local deterministic
   initials-on-colour avatar path remains the only presentation path.
5. Add an AC-tagged Node test under `tests/node/` that inspects the generated
   rows and proves AC-3's submission/agenda shape, AC-234's multi-track seed
   thresholds, AC-245's nullable-score recommendations, AC-246's reviewer
   membership/all-track scope/populated unreviewed queue, AC-249's draft seed,
   the general speaker-membership grant, deliberate ugliness, idempotence, and
   hard public-data prohibitions. Add `tests/ac-claims/MRQ-5.json` with the five
   owned ACs.

## Validation and evidence

1. Run `npm ci`, then `npm test`, type checking/build checks exposed by the
   repository, `npm run trace:ac -- --scope=merged`, and targeted seed tests.
2. Create an ephemeral D1 persistence directory, apply `migrations/0001_init.sql`
   with Wrangler, run `npm run seed -- --persist-to <dir>` twice, and query the
   resulting live local D1 for exact submission/status/membership/scope/
   assignment/evaluation/task/agenda counts and the two person conflicts. This
   is running-system evidence, distinct from generated-row unit assertions.
3. Self-review the complete `forgejo/master...HEAD` diff. After moving MRQ-5 to
   `review`, attach a standard-shape review naming the exact reviewed HEAD and a
   PASS verdict (headless `code-review` is suspended for this ticket).
4. Move to `in_validation`, attach the live-D1 command/query evidence, run
   `npm run pr-gate -- --ticket MRQ-5`, and paste the result into the completion
   comment. A red gate stops the PR.
5. Rebase on the freshly fetched `forgejo/master`, commit only owned paths,
   push to `forgejo/mrq-5-seed-pool`, verify remote HEAD equality, open a Forgejo
   PR against `master` citing M-04b and AC-3/234/245/246/249, attach the URL,
   transition to `pr_open`, and notify workspace:9 surface:60.

## Deviation flag

AC-3's `>=150 accepted speakers` clause conflicts with the same binding seed
contract and handoff that require retaining MRQ-4's exact 60-session/75-speaker
real accepted core while M-04b adds a 940-row rejected/pending pool, and prohibit
fabricated accepted people. This implementation preserves the verifiable real
accepted core and satisfies AC-3's `>=800 submissions` and positive agenda
density. It will report the remaining 75-accepted-speaker gap to the
Orchestrator rather than fabricate accepted identities or rewrite MRQ-4.
