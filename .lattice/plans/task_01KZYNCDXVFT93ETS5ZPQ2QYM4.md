# MRQ-172: CFP-11: the reviewer's comment is filed behind the applicant's biography

Rubric item **CFP-11** — `call-for-papers`, weight **2**, lane **convert**
(`partial` → `pass` recovers 1.0). Scored `partial` in round 4 and again in round 9
(build cb2794d78fbf) for the same reason, and round 4 also logged it independently
as a MAJOR defect ("The reviewer's free-text comment never reaches the organizer").
Two rounds, two different browsing agents, same miss. Scenarios: **CFP-S3**, **CFP-S4**.

## Acceptance criterion — the rubric's `pass_criteria`, verbatim

> A reviewer can record a review on an assigned submission (a rating plus a text
> comment) and the organizer's view of that submission shows the same rating and
> comment

## Why it fell short — the judge's own reasoning, round 9 (confidence medium)

> Most of the criterion is verified. The reviewer recorded a review on the assigned
> submission — recommendation Approve, Overall score 4, per-criterion 4s on Program
> fit / Audience value / Clarity, and the fixture comment 'Strong practical content
> and a clear narrative arc; abstract could name the specific tooling used.
> Recommend accept for the Platform track.' — and after saving, the reviewer
> dashboard's COMPLETED panel reads '1 review submitted' with '✓ Taming 40-Minute CI
> … Approve · Reopen →', so completion state updates. On the organizer side the
> rating clearly propagated: the submission record's EVALUATION PANEL reads '1
> scorecard result' with 'Sam Whitfield 1/1 reviewed', and the submissions list shows
> WEIGHTED SCORE 4.00 · '1 review'. **The gap: no captured organizer-side surface
> renders the reviewer's comment text.** The evaluation panel shows only a collapsed
> count and the weighted score; none of the four organizer screenshots of this record
> (top, mid, answers, participants) display the comment, so 'the organizer's view
> shows the same rating AND comment' is only half-evidenced.

## This is a discoverability defect, not a missing feature — read this first

**The comment is rendered.** `SubmissionRecordPage.tsx:215` prints
`evaluation.comment` inside `EvaluationEvidenceRow`, the API projects it
(`submission-record.routes.ts:601`), and the data round-trips correctly. Do not
build a second one.

The defect is **where it lives**. I read the round-9 pixels rather than the judge's
prose, and they agree with the judge for a reason he did not state:

- The **EVALUATION PANEL** — the card that summarizes the reviewer's work, high on
  the record — renders only `N scorecard result(s)` and `N conflict(s) declared`
  (`SubmissionRecordPage.tsx:614-615`). A count, no content.
- The comment sits in a *different* card further down called **"Answers and
  evaluation evidence"** (`:607`), and that card leads with **every form answer
  first**: session title, abstract, takeaway, format, tracks, speaker name, email,
  role, company, biography, headshot. The scorecard rows are appended after all of
  it. See `CFP-S4/screenshots/005-review-evidence-scorecard-recorded.jpg` — that is
  the *top* of the card, and it is entirely the applicant's own answers.
- `CFP-S4/screenshots/006-review-record-with-score-and-comment.jpg` catches the card
  heading at the very bottom edge of the viewport. The agent named the file for what
  it was looking for and then stopped scrolling.

A judgement the organizer needs in order to decide is filed behind the applicant's
biography, under a heading that reads like an archive. Two independent agents walked
this record and neither found it. PHILOSOPHY.md's "the organizer's language" and
"respect the operator" both land on this: the reviewer's verdict is the most
decision-relevant text on the page and it is the hardest thing on the page to find.

## What to build

The reviewer's actual words appear where the organizer already looks for the review
— the EVALUATION PANEL — alongside the rating that is already there.

1. In the EVALUATION PANEL, each scorecard result renders the reviewer's name, the
   recommendation, the overall score, and **the comment text itself** (a clamped
   excerpt with a disclosure is fine; the text must be reachable without leaving the
   panel and without hunting).
2. The rating and the comment are shown together, from the same row. A reviewer who
   abstained keeps its current honest line rather than an empty comment.
3. Where a comment is long, clamp it — but **the control that expands it must not
   move the rest of the page**; reserve the space (standing rule: elements never
   jump).
4. Keep the existing `EvaluationEvidenceRow` rendering where it is. Duplication of
   the *content* between the panel and the evidence card is acceptable and better
   than a move that breaks the evidence card's own contract; if you would rather
   move it, make sure nothing else depends on it first.
5. An override (`override_score` / `override_comment`) must remain visibly
   distinguishable from the reviewer's own words — the record must never let the
   organizer read their own override as the reviewer's judgement.

**Definition of done, stated the way the judge will read it:** an organizer opens
the submission record, and without scrolling past the applicant's form answers, sees
both the rating and the reviewer's comment text for each recorded review.

## Constraints

- Your **own linked worktree**, created first:
  `git worktree add ../Marquee-worktrees/mrq-171-reviewer-comment -b mrq-171-reviewer-comment main`.
  Verify with `pwd` and `git branch --show-current`. Never the primary checkout (it
  is the Lattice board's home); never `mrq-auto-eval*`.
- **Never `git stash` anywhere in this repo** — the stash stack is shared across all
  worktrees and two agents stashing at once swap each other's work.
- **No migration without the operator.** This needs none; if you think it does, stop
  and say so on the ticket.
- **Do not deploy.** An eval round is running and a `.deploy-freeze` marker sits at
  the primary checkout. Merging is wanted; deploying is not, and is not yours.
- Ship a regression test that fails on `main` and passes on your branch.
- Gate serialized. macOS has no `flock(1)`; wrap it, e.g.
  `python3 -c 'import fcntl,subprocess,sys; f=open("/tmp/marquee-gate.lock","w"); fcntl.flock(f, fcntl.LOCK_EX); sys.exit(subprocess.run(["npm","run","pr-gate"]).returncode)'`
- PR: `gh pr create --repo Stage-11-Agentics/marquee --base main`.

## Reset 2026-08-14 by agent:eval-triage
