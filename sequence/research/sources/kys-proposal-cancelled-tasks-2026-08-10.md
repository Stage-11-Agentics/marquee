> **Disposition, recorded 2026-08-12.** Both proposals below were ratified and have shipped.
> Cancellation landed as `migrations/0004_calendar_reversal.sql` (`speaker_tasks.cancelled_at`),
> threaded through the un-accept cascade, the chase board, the portal, and the derived overdue
> predicate — MRQ-72, merged. The US-23 stack-rank note was folded into `sequence/USER_STORIES.md`
> (US-23 · Submit on behalf of someone else) and `SPEC.md`, where AC-223/AC-224 hold the
> submitter-versus-speaker behaviour in the post-competition band. The third priority, the Airtable
> inbound concurrent-edit guard, is untouched because the mirror itself is unbuilt (MRQ-25/MRQ-26).
> Archived here for provenance: this is where the cancellation design came from.

# Proposal for Atin — task cancellation + one stack-rank note

From Aditya (KYS support lane), 2026-08-10. Sits alongside the competitor-context precedent in this folder: external input, yours to ratify or decline. Numbers deliberately unminted —
consolidation is yours. Evidence chain available on request.

---

## Proposed user story (mint US-number at consolidation)

> As an **organizer**, when I reverse an acceptance or a speaker withdraws, the
> speaker's assigned tasks stop counting everywhere — **without destroying the
> record of work already completed** — so the chase board and portal never nag
> anyone about homework for a dead talk, and a later re-acceptance restores
> their credit instead of re-opening finished work.

**The scenario that motivates it** (found by walking the schema, stress test
scenarios #3–#5): speaker uploads slides Tuesday (task `done`), talk is
un-accepted Wednesday, talk is re-accepted off the waitlist Thursday. With
`status ∈ open|done` only, Wednesday has nowhere to write "cancelled" — AC-123's
reversal dialog promises a cancel option with no schema value behind it — and
any overwrite destroys Tuesday's completion, so Thursday's chase board nags a
speaker who already did the work. R6 (the outstanding-tasks dashboard) is then
wrong in the exact demo the judges run.

## Proposed acceptance criteria (letters, not numbers)

- **(a)** `speaker_tasks` gains nullable `cancelled_at`. `completed_at` is never
  overwritten by cancellation or reversal. While no real D1 exists this is a
  one-line edit to `0001_init.sql`, not a migration.
- **(b)** The un-accept cascade and speaker withdrawal stamp `cancelled_at` on
  that submission's tasks — open **and** done. Contact-scoped tasks
  (`submission_id NULL`) are untouched.
- **(c)** Cancelled tasks leave the portal list, chase-board glyphs, and
  dashboard overdue counts. The derived overdue predicate becomes
  `status='open' AND due_at < now AND cancelled_at IS NULL` — consistent with
  SPEC's own "overdue is derived, never stored" rule.
- **(d)** Re-acceptance clears `cancelled_at`. Previously completed tasks
  reappear as **done**, never re-opened.
- **(e)** AC-123's reversal-dialog "cancel tasks" option writes `cancelled_at`
  — closing the current gap where the promised control has no landing spot.
- **(f)** Manual one-off waive ("skip this task for this speaker") writes the
  same field. One mechanism, two doors.

## Stack-rank note: US-23 (submitter ≠ speaker)

Currently tiered post-competition while `submitter_person_id` ships Tier A —
meaning an assistant who submits on someone's behalf receives the portal login,
confirmation, and calendar invite meant for the speaker.

Aditya's read: **this is a killer feature for the real AIE NYC deployment and
worth reconsidering — but ranked below the cancellation fix for the contest
window.** Minimum for now: name it in the gate report as a known limitation so
it cannot surface as a live-demo surprise.

## Priority order as we'd rank it

1. This proposal (cancellation) — cheap now, expensive after first real deploy.
2. Airtable inbound concurrent-edit guard — reuse the ETag/If-Match/409 pattern
   Amendment 7 already commits elsewhere.
3. US-23 gate-report naming (one sentence), reconsideration post-contest.
