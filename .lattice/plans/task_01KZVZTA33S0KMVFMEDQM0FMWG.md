# MRQ-152: V2-3: a newly created committee is ready to distribute

Source: .briefs/eval-gap-v2-human-lens.md section 4, authored by Fable (Eval V2 Audit, surface:55). Operator-approved 2026-08-12. Read that section for the full human-problem framing before starting. (V2-3, ~30 min.)

HUMAN PROBLEM. A chair creates a committee, adds reviewers, opens Distribute — and it is disabled with 'Choose a reviewer pool on this round card', a sentence pointing at a control on a DIFFERENT card. A brand-new committee cannot do the thing committees exist for. The eval recorded exactly this dead end: 'Committee created · add reviewers to begin assignment', yet both round cards still read 'REVIEWER POOL: No pool selected'.

GOOD LOOKS LIKE. Creating a committee attaches it as the pool of every round that has none — the obvious default for the overwhelmingly common one-committee conference. A round's EXPLICIT pool is never overwritten. If a round still has no pool, the gate message names the exact control and links focus to it.

CLOSES. ABS-06 (w2 partial).

VERIFY. Fresh event -> create committee -> invite reviewer -> Distribute is enabled -> run it -> assignments appear. Re-running is idempotent.

## Build plan

1. Update `createEvaluationCommittee` so committee creation and `NULL`-only attachment to all rounds in the event are one D1 batch; return the attached round metadata for truthful UI feedback.
2. Update only the committee-create handler and Distribute dialog seam in `EvaluationPage.tsx`: report attached rounds, label each round option as ready or needing a reviewer pool, and provide an exact recovery control that focuses the existing reviewer-pool select. Do not touch invite-link, export, or score-review lines owned by MRQ-151.
3. Add `CONTRACT ·` integration coverage proving every unassigned round attaches and an explicitly assigned pool remains unchanged.
4. Run the focused evaluation integration test, the full `node scripts/checks/pr-gate.mjs` gate, then validate the fresh-event browser flow including assignment rerun counts. Commit and push the branch, open the MRQ-152 PR, and report the exact evidence to the Eval Fix Orchestrator.

## Non-goals

- No changes to reviewer invitation mechanics, invite-link rendering, exports, score display, or unrelated evaluation UI.
- No client-only attachment path; agents and the UI use the same server-side default.
