# Plan Review: MRQ-110 — Cycle 2

Reviewer: Claude (plan review), 2026-08-12. Claims verified against the working tree at `github/main` (23a06b0) and the remote branch list.

### 1. Verdict

**PASS**

### 2. Summary

Reviewed the MRQ-110 plan (per-round committee pools, recusal with chair-side truthfulness, reviewer Remind via outbox) against the task description and the actual codebase. The plan is unusually well-grounded: every load-bearing claim I checked is true in the source — the hardcoded `abstained` write, the existing `distributeAssignments`/`listRoundAssignments` seams, the mail outbox infrastructure, and the inline aggregate the recusal exclusion must touch. The key remaining concern is stacking reality: the parent branch now exists but carries only a plan commit, and no MRQ-109 branch is published at all, so two of the plan's "compose with the sibling/parent" steps need explicit fallbacks rather than assumptions.

Verified facts (for the implementer's benefit):

- `abstained` is hardcoded `0` at `src/routes/review.routes.ts:742` (insert) and `:749` (upsert), exactly as the task describes.
- `evaluations.recommendation` is **already nullable** in the schema (`migrations/0001_init.sql:521` — `CHECK (recommendation IS NULL OR ...)`), so abstention needs no schema change to that column; the only migration required is `evaluation_rounds.committee_id`, as planned. Next migration number is `0008`.
- `distributeAssignments` (`src/routes/evaluation.routes.ts:646`) already accepts `committee_id` and validates via `committeeForEvent`; `listRoundAssignments` is at `:736`. The plan's data seams are real.
- The outbox/mail stack (`src/jobs/mail/outbox.ts`, `templates.ts`) and the guarded surfaces (`recipientsFor`, `reminderSelectorSchema` in `src/routes/comms.routes.ts:46,298`) exist as named; the "do not add `reviewer` to the role enum" resolution targets the right symbol.
- The current chair aggregate is an inline `AVG(evaluation.score)` at `src/routes/submissions.queries.ts:462` with **no** abstained filter — confirming the task's claim that a silent recusal would drag the average today.
- `src/ui/review/ReviewerPage.tsx` and `src/ui/evaluation/EvaluationPage.tsx` exist on `main` (note: under `src/ui/review/` and `src/ui/evaluation/`, not a `pages/` directory).

### 3. Issues

**[MAJOR] Contract / step 5 — Parent branch exists but is implementation-empty; no fallback defined for the UI step**
`github/mrq-108-review-depth` is now published, but its tip (6ab5c3a) is a plan-only commit — zero implementation, no ReviewerPage changes. The plan's base-fallback clause ("parent ref is not published at planning time") is stale, and "rebase onto the parent as soon as it exists" is now technically satisfiable while gaining nothing. Step 5 gates all UI work on "after rebasing onto MRQ-108," but if MRQ-108's implementation is slow to land, this ticket has no defined path: wait indefinitely, or implement `Declare conflict` against main's ReviewerPage and absorb a rebase conflict when the parent rewrites the page.
**Recommendation:** Amend the contract line to reflect reality: cut from `github/main` (still correct — the parent adds no code), watch the parent branch for implementation commits, and define the fallback explicitly — if MRQ-108's ReviewerPage rework has not landed by the time steps 1–4 are complete and gated, implement the conflict control against main's ReviewerPage in a minimal, conflict-tolerant diff (one adjacent control + handler, no layout restructuring) and note in the PR body that the stacked rebase owns final placement.

**[MINOR] Outcome 3 / Cycle-1 resolutions — MRQ-109's shared aggregate helper may not exist at implementation time**
No `mrq-109` branch exists on the remote. Outcome 3 mandates composing with "MRQ-109's shared aggregate helper rather than creating a second aggregate implementation," and the cycle-1 resolution says to inspect its projection "after the parent/sibling rebase" — but there may be nothing to rebase onto or inspect. Today the aggregate is inline SQL at `submissions.queries.ts:462`.
**Recommendation:** State the fallback: if no shared helper is published when step 3 lands, add the abstained exclusion directly to the existing inline aggregate(s) (`WHERE evaluation.abstained = 0` in the score subquery and any review-count denominators), keep the change minimal, and flag in the PR body that MRQ-109's helper should absorb it on merge. Do not block on the sibling, and do not invent the helper on MRQ-109's behalf.

**[MINOR] Files step 2 — Precedence between the distribute body's `committee_id` and the round's persisted pool is undefined**
The distribute route's body currently *requires* `committee_id` (`evaluation.routes.ts:65`). The plan says distribution should "consume the selected round pool" and the input should "select the round's persisted pool," but doesn't define the API contract when both exist: does body `committee_id` become optional with the round's pool as default? What happens if a caller supplies a committee that differs from the round's persisted one?
**Recommendation:** Specify: make the body's `committee_id` optional; default to the round's persisted pool when omitted; if both are present and disagree, either reject with a 4xx or let the explicit body win — pick one and test it. (Rejecting is safer and matches the "round card shows its pool" mental model.)

### 4. Positive Observations

- **The plan is checked against real code, and it shows.** The line numbers, symbol names, and seams (`listRoundAssignments`, `recipientsFor`, `reminderSelectorSchema`, the outbox enqueue path) all resolve to real code on `main`. This is the difference between a plan and a wish.
- **The scope guards are precise and correctly targeted.** "Do not add `reviewer` to `reminderSelectorSchema.role`" names the exact symbol whose widening would constitute the scope creep the task forbids. Same for "no per-round membership rows" — the plan reuses the persisted pool reference instead.
- **The chair-side truthfulness requirement is treated as in-scope, not deferred** — matching the task's explicit "a recusal that silently drags the average is worse than not shipping." Outcome 3 and the test list both encode the denominator exclusion.
- **Abstention semantics are thought through**: clearing recommendation/score/criteria, completing the assignment so it leaves the queue, repeat-safety, and the natural un-abstain path (a later real save writes `abstained = 0` via the existing upsert) all hold up against the actual table schema, which already permits NULL recommendation.
- **The cycle-1 self-review resolutions are substantive** — the `submissions.queries.ts` consumer identification and the program-authorized reminder route design both close real gaps rather than restating the plan.
- **Verification is concrete and budget-aware**: named test surfaces, the exact chair copy string, the 70-turn judge reachability constraint, and the machine-load guard before the PR gate.
