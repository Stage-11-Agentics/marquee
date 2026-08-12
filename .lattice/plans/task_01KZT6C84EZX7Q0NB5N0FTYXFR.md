# MRQ-100: Three pipeline stages are empty in seed data — no submitted, no withdrawn, no genuinely ready-to-place submission

Three pipeline stages are empty in seed data, so the organizer's first look at
Marquee shows a conference with no beginning and no exits. Operator, live site,
2026-08-12: *"there's nothing in submitted and there's nothing in withdrawn in
our seed data... Same with ready to place."*

## Evidence — live, current build `2543206187c4`

Pipeline counts scraped from the public landing page (`src/routes/landing.route.tsx:187-192`):

    Submitted     = 0
    In review     = 280
    Ready to place = 0
    Onboarding    = 12
    Scheduled     = 1
    Published     = 23

Seed source confirms it. Literal status strings across `scripts/seed/**`:
`submitted: 0`, `withdrawn: 0` (vs `draft: 5`, `in_review: 4`, `accepted: 5`,
`waitlisted: 5`, `rejected: 4`).

## Why "Ready to place" is empty is NOT the same bug

`Ready to place` is not a stored status — it is the derived *stage*
`acceptedStagePredicate` (`src/routes/submissions.queries.ts:104-112`):

    s.status = 'accepted'
      AND ai.id IS NULL                     -- not on the agenda
      AND NOT (onboardingStagePredicate)    -- no open speaker task
      AND NOT (pendingWavePredicate)        -- wave already sent

Every seeded accepted submission has an open speaker task, a pending wave, or an
agenda slot, so the stage is empty **by construction**. The chip that made this
look like a filter bug is already fixed in open PR #54; this ticket is the data
half, and it is real on its own.

## Required outcome

Seed at least one submission in each currently-empty state, so every sidebar
pipeline entry and every status filter lands on a non-empty list:

1. **Submitted** — a submission with `status = 'submitted'`, not yet reviewed.
2. **Withdrawn** — a submission with `status = 'withdrawn'`. Note MRQ-83
   restored decision buttons on withdrawn records; a withdrawn row is what
   proves that path is reachable.
3. **Ready to place** — an *accepted* submission that genuinely occupies the
   accepted stage: `status='accepted'`, **no open speaker task**, **no pending
   wave** (its wave sent, or no wave), and **no agenda slot**. Verify against
   the predicate above, not against intuition — this is the one that is easy to
   seed wrongly and still see zero.

"Just one of each, let's say" (operator). One is the floor; a small handful for
Ready to place is fine if it reads naturally, since it is a real working queue.

## Constraints

- Seed is **deterministic upserts** — it must converge, not duplicate, on re-run
  (`DEPLOY.md`: `npm run seed -- --remote`). Re-running twice must not add rows.
- Do not renumber, re-key, or re-title existing seeded submissions. Other
  tickets and tests reference them by ID; MRQ-86's evidence cites
  `sub_what-rl-means-for-agents` by name.
- Content must read like a real AI-engineering conference talk, in the register
  of the existing seed (`scripts/seed/submission-content.ts`). No lorem, no
  "Test Submission 1".
- `scripts/checks/check-seed.mjs` must still pass.
- Test titles must begin `AC-<n> · ` or `CONTRACT · ` or `trace:ac` fails.
- Suite budget 45s, gate budget 120s.

## Acceptance criteria

- AC-1 · Seeded data contains >=1 submission with stored status `submitted`, and
  the `?status=submitted` list renders it.
- AC-2 · Seeded data contains >=1 submission with stored status `withdrawn`, and
  the `?status=withdrawn` list renders it.
- AC-3 · Seeded data contains >=1 submission satisfying `acceptedStagePredicate`,
  and `/submissions?status=accepted` ("Ready to place") renders it.
- AC-4 · Running the seed twice in a row produces identical row counts.
- AC-5 · Landing-page pipeline counts show non-zero for Submitted and Ready to
  place.
- AC-6 · Seeded agenda confirmations include at least one `declined` participant,
  at least one `pending` participant, and a multi-role agenda case whose
  `has_declined_participant` projection is true.

## Verification

Reseed locally, then load the running app in a browser and screenshot the
sidebar pipeline with **Submitted**, **Ready to place**, **Onboarding** and the
Withdrawn filter each showing rows. Also open an agenda/session surface that
visibly exposes the declined participant treatment and the pending confirmation
state. A passing test alone does not close this — the defect is that the app
*looks* empty.

## Implementation plan

- Work only in `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-100-seed-coverage`.
- Add deterministic, realistic seed upserts for one submitted submission, one
  withdrawn submission, one accepted submission that has no agenda slot/open
  speaker task/pending wave, and confirmation rows covering confirmed, declined,
  and pending states. Include a multi-role agenda participant with one confirmed
  role and one declined role so `has_declined_participant` is true.
- Preserve every existing seeded ID/title and the existing accepted core. Extend
  seed-focused tests and `SEED-DATA.md` only as needed; do not touch the UI,
  submission query, or migrations named above.
- Verify stored statuses and the accepted-stage predicate against the seeded
  database, run the seed twice and compare row counts, then run `npm test` and
  the MRQ-100 PR gate within their budgets. Reseed and validate the actual local
  app in c11's embedded browser, capturing the three pipeline filters plus the
  declined and pending confirmation treatment.
- Push the branch and open a GitHub PR; do not deploy or apply remote migrations.

## File ownership

OWNS: `scripts/seed/**`, `SEED-DATA.md`, its own tests.
MUST NOT TOUCH: `src/ui/submissions/SubmissionsPage.tsx` (open PRs #54 and #56),
`src/ui/submissions/SubmissionRecordPage.tsx` (open PR #53 and MRQ-101),
`src/routes/submissions.queries.ts`, or any migration.
