# MRQ-110: Per-round reviewer pools, recusal, reviewer reminders

## Contract

- Rubric: ABS-02 (w2), ABS-12 (w1), ABS-09 (w1); register rows 7, 12, and 14; full scope T-C2.
- Base fallback: parent ref `github/mrq-108-review-depth` is not published at planning time, so this branch is cut from `github/main`. Rebase onto the parent as soon as it exists, then run `npm ci` and re-gate the exact head.
- Stacked PR body must say: `stacked on MRQ-108 — merge that first; this rebases.`
- Do not edit contract docs, mint AC IDs, add per-round membership rows, or widen the participation-shaped communications audience engine.

## Outcomes

1. Each evaluation round can reference one event-scoped committee pool through nullable `evaluation_rounds.committee_id`. The round detail/card renders the selected pool, and distribution uses that round's pool while preserving the existing committee membership and track-scope machinery.
2. A reviewer can choose `Declare conflict` beside the save action. The existing evaluation write records `abstained: 1`, clears recommendation/score/criteria values for the abstention, marks the assignment complete so it leaves the queue, and allows an optional comment. The reviewer detail and chair-facing evidence identify the recusal truthfully.
3. Chair aggregates and denominators exclude abstained evaluations. The chair-facing progress/results surface shows the exact outstanding signal, e.g. `1 recusal · needs reassignment`, without silently counting a recusal as a review. This must compose with MRQ-109's shared aggregate helper rather than creating a second aggregate implementation.
4. Each reviewer progress row with outstanding assignments has a narrow `Remind` action. It validates the round/reviewer and outstanding count, queues exactly one reviewer-specific outbox message through the existing enqueue path with an idempotent reviewer template, and exposes the logged message. It does not route through `recipientsFor` or permit speaker/audience selectors to address reviewers.

## Files and implementation sequence

1. Add the smallest migration needed for nullable `evaluation_rounds.committee_id`, update `src/db/schema.ts`, and preserve existing rows with `NULL`.
2. Extend `src/routes/evaluation.routes.ts` round input/patch/detail/create paths and round pool validation; have distribution consume the selected round pool. Add the narrow reviewer reminder endpoint beside `listRoundAssignments`, deriving assigned/reviewed/outstanding counts from that query's same data seam and using the shared mail/outbox helpers.
3. Extend `src/routes/review.routes.ts` evaluation input/read projection and upsert semantics for abstention. Keep authorization and queue completion behavior intact; a recusal must not become a recommendation or a numeric result.
4. Add a reviewer-only default mail template in `src/jobs/mail/templates.ts` and the merge fields needed for recipient name, round name, and outstanding count. Keep it out of `recipientsFor` and the general audience-role enum.
5. After rebasing onto MRQ-108, add the `ReviewerPage.tsx` conflict control adjacent to the existing save control, with stable feedback space and no false claim that a message was sent. Update the chair/progress UI (`EvaluationPage.tsx` and the parent result surface as applicable) to render round pool, outstanding counts, Remind, and the recusal reassignment label. Resolve any MRQ-109 aggregate collision by using its helper.

## Verification

- Targeted API/integration tests cover: round committee create/read/update and event scoping; distribution uses the round pool; abstention accepts no recommendation, persists `abstained=1`, completes the assignment, and is repeat-safe; aggregates/counts ignore abstentions; reminder rejects completed/nonexistent reviewers, queues a reviewer template to the correct recipient, is idempotent, and leaves speaker audience behavior unchanged.
- Targeted UI/source tests cover visible `Declare conflict`, `Remind`, round pool labeling, and the exact `1 recusal · needs reassignment` copy. The reviewer action must be reachable within the judge's 70-turn budget.
- Run targeted Vitest only for touched files during implementation. Before the PR gate, check `uptime`; if 1-minute load exceeds 24, wait 2–3 minutes and retry. Run `npm run pr-gate -- --ticket MRQ-110`, paste the passing output into the completion comment, attach review and live validation evidence, open the GitHub PR against `main`, attach its URL, and stop at `pr_open`.

## Plan-Review Cycle 1 Resolutions (AUTHORITATIVE)

Verdict: PASS-WITH-NITS (self-review, 2026-08-12).

- The original plan left the chair result file implicit. Resolved: after the parent/sibling rebase, inspect the exact MRQ-109 result projection and update its aggregate consumer(s), including `src/routes/submissions.queries.ts` / the submissions results UI when those are the landed surfaces; use the existing shared helper and do not fork it.
- The reminder path must not accidentally become a general audience feature. Resolved: implement it as a program-authorized evaluation route that directly loads the event-scoped reviewer person and `listRoundAssignments`-equivalent outstanding count, then calls the canonical outbox enqueue helper; do not add `reviewer` to `reminderSelectorSchema.role`.
- The round pool must remain optional for existing plans. Resolved: validate any supplied committee belongs to the round's event, preserve `NULL` on old rounds, and make distribution's UI/API input select the round's persisted pool rather than inventing membership rows.
