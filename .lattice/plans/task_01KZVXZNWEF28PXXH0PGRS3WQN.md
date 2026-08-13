# MRQ-149 — ABS-14: agent evaluator score, reasoning, and a human override that sticks

## Honest gap analysis against the three rubric requirements

MRQ-134 landed. Verified against a live `vite dev` on the seeded database, submission
`sub_synthetic-pool-0002` = "Taming 40-Minute CI":

- **(a) numeric score + written reasoning attributed to the agent — ALREADY EXISTS.**
  `scripts/seed/evaluations.ts` seeds the `Triage agent` seat (`people.kind='agent'`) with a real
  evaluation on that submission: `score 4.5`, per-criterion scores, and a comment specific to the
  abstract. `GET /api/v1/events/{e}/submissions/{s}` returns it with `reviewer_kind: "agent"`.
- **(b) the results view distinguishes agent from human — ALREADY EXISTS.**
  `ReviewerName` renders an `Agent` chip in a reserved-width slot (`src/ui/shell/components.tsx:29`)
  on the record page, and `SubmissionsPage` renders agent scores on their own `Agent score` line,
  outside the human aggregate. `review-aggregate.ts` and `evaluation-results.routes.ts` already join
  `people.kind = 'human'`, so an agent's 4.5 never lifts the committee average (R1).
- **(c) an admin override to a different value that persists and stays distinguishable — MISSING.**
  Nothing in the product overrides a recorded score. §1 of `sequence/agent-evaluator-design.md`
  claims "a chair can override any of them"; that sentence is not true today. The only write path is
  `POST …/evaluations`, which requires the writer to be an *assigned reviewer* on that round — a
  chair generally is not — and it records a peer review, not an override.

So this ticket closes (c) only.

## The claim is made, so the item is judgeable

The conditional clause resolves to *judge it*: the product claims agent evaluation in its own UI —
the `Agent` chip on the record page and the assign select, `Evaluator seat · <name>` on
`/settings/api`, and the "Add agent evaluator" control on `/evaluation`. No flag needed.

## Build

A chair's override is recorded **on the evaluation it overrides**, never as a second peer review.
The reviewer's original judgment stays intact (audit integrity, design §4.3.6) and the override sits
beside it, attributed to the chair. This is a general chair capability over any reviewer's score,
human or agent — which is what §1 actually promises — not an AI-specific side door.

1. `migrations/0014_evaluation_overrides.sql` — `override_score REAL`, `override_comment TEXT`,
   `override_person_id TEXT REFERENCES people(id)`, `override_at INTEGER` on `evaluations`.
   Bump the exact foreign-key assertion in `scripts/schema-verify.mjs` (104 → 105).
2. `PUT` / `DELETE …/rounds/{r}/submissions/{s}/evaluations/{evaluationId}/override` in
   `evaluation.routes.ts`, `program:write` + `requireProgram`. No change to `reviewer-scope.ts` and
   no relaxation of any reviewer check.
3. Record payload carries the override; `SubmissionRecordPage` renders an `Override` chip, the new
   value, the superseded value, and the chair's reasoning, with an override control for program
   staff. Reserved width — no reflow (`CLAUDE.md`).
4. `review-aggregate.ts` counts `COALESCE(override_score, score)`. Agent rows stay excluded from the
   human aggregate, so R1/AC-292 are untouched.
5. Tests: integration for persist / authorization / clear / agent row, unit for the aggregate.
6. Real browser validation on `vite dev`: override the agent's 4.5 to a different value, reload,
   confirm it persists and reads as an override beside the agent's original.

## Non-goals

No Marquee-hosted inference (R3). No change to reviewer authorization. No second results table.
