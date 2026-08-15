# MRQ-169: Abstract management rebuild: one idea of an assignment — scope-aware distribution, honest queue, revisable reviews

# Abstract management: one idea of an assignment

Round 5 (build f9630de0) graded abstract-management at 75.0% — the only area that did not
move from round 4, holding every serious defect in the run: ABS-06 fail (Distribute
assignments never distributes), ABS-05 partial (the reviewer queue ignores explicit
assignment), ABS-02/03 partial, plus three minors. Evidence:
`.eval-kit-agent/runs/2026-08-13T20-13-03/judgements/abstract-management.json` and the
ABS-S1/S2/S3 screenshots beside it. This ticket is the whole rebuild — one ticket, not six,
because the six symptoms share one root.

## Root cause

`round_assignments` holds two different ideas of what an assignment is: an explicit
per-reviewer row (`reviewer_person_id` set) and a committee-blanket row
(`reviewer_person_id NULL`, `committee_id` set, meaning "everyone in this pool"). The two
halves of the product each believe a different one:

- The reviewer queue (`src/routes/review.routes.ts` `assignedSubmissionIds`,
  `src/lib/reviewer-scope.ts` `REVIEWER_ASSIGNMENT_SCOPE_SQL`) unions both and captions the
  union "assigned to you". The seed (`scripts/seed/evaluations.ts` ~line 290) writes 100
  blanket rows, so Sam Whitfield — assigned exactly two abstracts by the organizer — opens a
  queue reading "1 of 37 assigned to you". The organizer's deliberate assignment decisions
  are drowned, not disobeyed.
- The progress dashboard and reminders (`listRoundAssignments summary=1`,
  `remindRoundReviewer`) count ONLY per-reviewer rows (`WHERE reviewer_person_id IS NOT
  NULL`). Blanket-assigned work is invisible to coverage counts and unchaseable by Remind —
  directly against "the system does the chase work". The two surfaces disagree about the
  same table.

On top of that model split, three compounding defects:

1. **Distribution assigns blind, then validates all-or-nothing.** `distributeAssignments`
   round-robins pool members over submissions ignoring track scope, then validates every
   (submission, reviewer) pair — one D1 query per pair, `Promise.all` over ~2,000 of them —
   and throws 422 on the FIRST out-of-scope pair, writing nothing. With any track-scoped
   reviewer in the pool (Sam: Evals+Infra) and ~600 in-scope submissions, failure is
   guaranteed by construction. It also targets ALL submitted/in_review submissions for
   every round — round 2 should target promoted submissions (`round_promotions`), so
   distributing an empty round 2 "succeeds" into meaninglessness or fails identically.
2. **The UI erases the server's diagnosis and hides the failure.** The API's 422 messages
   are well-written ("reviewer is outside the submission's track scope"), but
   `ERROR_TREATMENTS.unprocessable` in `src/ui/shell/api-client.ts` replaces every one with
   "That change would leave the program in a state it cannot be in." — and
   `EvaluationPage.distribute` renders that into the page-level banner BEHIND the still-open
   dialog (screenshots 017 vs 020). The judge saw two silent clicks and one opaque banner.
3. **The reviewer's own record is buried and locked.** The completed-list "Reopen →"
   opens the full-submission modal whose "Your saved review" section sits below the fold of
   four other sections (screenshot 005 — the judge never found it), and there is no edit
   path at all even though `writeEvaluationRoute` is an upsert (`ON CONFLICT DO UPDATE`).
   The rubric's scripted re-score (4/2/Accept) was impossible, which also capped ABS-03 and
   ABS-04 evidence.

Why this area lagged while others converged: it is the one place in the product where two
roles' surfaces must agree on one noun across an authorization seam. Each subsystem
(committee provisioning, queue authorization, distribution, progress) is locally coherent;
the disagreement lives between them, and the seed's blanket rows guarantee every demo run
walks into it.

## Design

**One idea of an assignment: a (round, submission, reviewer) row — always.** Committees
remain what they are (per-round reviewer pools); they stop being an assignment shape.
Distribution becomes the materializer that turns a pool into rows.

### D1 — Scope-aware, load-balanced distribution (ABS-06)

- Rewrite the bulk arm of `distributeAssignments`:
  - Target set: round position 0 → submissions in `submitted`/`in_review` with
    `bypass_evaluation = 0`; round position > 0 → submissions promoted into this round
    (`round_promotions.to_round_id`). An empty target set is a plain-language refusal:
    "No submissions have been promoted into Final Review yet — promote from Initial Review
    first."
  - Eligibility in ONE set-based query: pool members × submissions joined through
    `submission_tracks` ∩ `reviewer_track_scopes`. No per-pair queries, ever.
  - `n_per_submission`: for each submission pick N eligible reviewers by lowest current
    load (stable tiebreak), skipping pairs that already exist. `everyone`: all eligible
    pool members per submission. Optional per-reviewer cap input (`max_per_reviewer`);
    when the cap binds, the report says so.
  - Partial coverage is a REPORT, not an error. Write what can be written; return
    `{assigned_new, already_assigned, submissions_total, fully_covered, partially_covered,
    uncovered, uncovered_tracks}`.
  - Writes in bounded batches (multi-row INSERT OR IGNORE), well under subrequest limits
    at 1,000 submissions × N reviewers.
- Dialog UX: on execute, the dialog stays and shows the coverage report in place —
  "Assigned 1,988 new reviews across 6 reviewers · 214 already assigned · 3 abstracts have
  no eligible reviewer — Leadership has no scoped reviewer" — with Done. Errors render
  INSIDE the dialog in a reserved slot (elements never jump). Idempotent re-run tops up.

### D2 — The queue is exactly the assignments (ABS-05)

- `assignedSubmissionIds`, `completedSubmissionIds`, `comparisonCandidateIds`, and
  `REVIEWER_ASSIGNMENT_SCOPE_SQL` drop the committee-blanket arm: membership comes from
  direct rows only. Track scope stays as defense in depth (rows are written scope-valid).
- Queue rule text updates to match: "A submission appears when it is assigned to you in
  this round and carries a track in your scope."
- Seed: replace the 100 blanket rows with materialized per-reviewer rows using the same
  scope-aware balanced allocation, keyed by criterion **id** (not name) in any seeded
  `criteria_scores`, so demo dashboards show live coverage and Remind has someone to chase.
  No schema change and no D1 migration: the demo rebuilds from seed on reset, and blanket
  rows simply stop being read or written. If you conclude a migration IS required, stop and
  raise a c11 flag — do not apply one.

### D3 — Reviews are revisable, and the record leads (ABS-03, minor-1)

- Completed-row click re-enters the standard review layout (submission card + scorecard)
  pre-filled with the stored values — including dropdown and free-text answers — under a
  status line "Recorded <date> · saving updates your review"; primary button "Update
  review". Server side already upserts; this is UI wiring.
- In the full-submission modal, move "Your saved review" to directly under the header —
  the reader who clicked "see exactly what was recorded" gets the record first.

### D4 — Honest, actionable refusals (defect-3)

- `ERROR_TREATMENTS`: for 422 (and 409 where the server message is authored), surface the
  server's own sentence with the ref code; the generic sentence becomes the fallback for
  absent/technical messages only.
- Improve the direct-assignment refusal server-side to name the rule and the fix:
  "Sam Whitfield reviews Evals and Infra; this abstract carries RAG/Retrieval. Widen their
  responsibilities or pick another reviewer."
- Every dialog that can refuse renders the refusal inside itself, space reserved.

### D5 — Pools you can actually define (ABS-02, minor-2)

- "Manage committee" becomes a real pools surface: list every pool with its members,
  create a new pool, remove a member (new `DELETE
  /committees/{committeeId}/reviewers/{personId}` — removal keeps their recorded
  evaluations and existing assignments; copy says so).
- Invite dialog gains a pool selector (default: the round's pool) instead of silently
  targeting `committees[0]`. Round cards keep their existing per-round pool selector.
- Result: Sam can be in Round 1's pool while Round 2 uses a different (possibly empty)
  pool, visibly.

### D6 — Small honest surfaces (minor-4, ABS-09 polish)

- Results-table SPEAKERS cell: "+1" carries the full names and roles (title attr or
  expansion); the record page already shows them.
- Speaker portal talk blocks list co-presenters with role labels, so a submitter can
  confirm a co-speaker is on the record.
- Per-round "Remind all N behind" button beside the committee header, looping the existing
  per-reviewer reminder endpoint (per-day idempotence already dedups); confirmation notice
  states how many were queued.

## Acceptance floor (rubric pass_criteria — the floor, never the goal)

- ABS-05: "Sam Whitfield's queue lists 'Taming 40-Minute CI' and 'Your AI Pair Programmer'
  and does NOT list the unassigned 'Docs That Answer Back'; a portal that exposes all
  submissions to every reviewer fails."
- ABS-06: "The assignment UI offers a per-reviewer limit, an auto-assign/distribute
  action, or track/bulk filtering, and the agent exercised it without error; assignment
  strictly one-submission-at-a-time with no caps, filters, or auto-distribution fails."
- ABS-02: "The UI attaches reviewers (or a pool/committee) to a specific round rather than
  only globally, and Sam Whitfield could be added to the Round 1 pool while Round 2 shows a
  different (possibly empty) pool."
- ABS-03: "Organizer could build the round-1 scorecard with numeric Originality/Relevance,
  a Recommendation dropdown (Accept/Maybe/Reject), and a Comments text area; the reviewer
  view rendered all three types; the submitted evaluation (values 4, 2, Accept, sample
  comment) is stored and visible after submission." — visible now means the reviewer can
  reopen and READ (and revise) all three stored value kinds.
- Must not regress (round-5 passes): ABS-01 (two rounds persist), ABS-04 (weights persist,
  aggregate labeled weighted — `src/lib/review-aggregate.ts` is correct, leave its
  semantics alone), ABS-07 (blind review), ABS-08 (progress counts match reality — they
  now cover ALL assigned work, since all of it is materialized), ABS-09 (remind gating),
  ABS-10 (aggregate sort), ABS-11 (participants with roles on the record), ABS-12 (declare
  conflict), ABS-13 (CSV export).
- All six round-5 defects in `judgements/abstract-management.json` addressed as designed
  above.

## What "beautiful and effective" means here

An organizer running a real 1,000-submission CFP can work entirely from /evaluation:
build pools, invite scoped reviewers, distribute with a coverage report that answers
"will everything get reviewed, and by whom" in numbers, watch per-reviewer progress that
agrees with every other screen, chase the lagging in one click, and read weighted results
— with zero dead ends, zero silent failures, and zero numbers that disagree between
surfaces. Every refusal names the rule and the fix in the organizer's language. The
reviewer can always see, and correct, exactly what they recorded. The queue header is
true by construction, not by caption.

## Non-goals

- No in-product AI evaluation runs (ABS-14's in-run scoring needs a model credential;
  the Agent-seat API design is deliberate and MRQ-165 carries the agent-native note).
- No schema migration (flag the operator if you believe one is unavoidable).
- No changes to decision/lifecycle flows, CFP forms, or the board.

## Constraints

- Work in a linked worktree off github/main; never touch the primary checkout.
- `npm run pr-gate` green before PR; suite budget 45s / gate 120s — if a run fails on time
  alone, check machine load before believing it.
- Deploy freeze is on: MERGE, do not deploy, do not touch `.deploy-freeze`.
- Tests: allocator as a pure unit-tested function; focused integration tests for the
  distribute endpoint (small fixture, both modes, partial coverage, promoted-round
  targeting), queue direct-only membership, review revision upsert, and the 422
  message surfacing. Verify each new test fails on unfixed main where practical.
