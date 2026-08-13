# Plan Review: MRQ-108 — Cycle 2

Reviewer: plan-review agent (Claude). Verification performed against the worktree
`Marquee-worktrees/mrq-108-review-depth @ 6ab5c3a` (on `github/main @ 23a06b0`) and the spec
`sequence/eval-response-tickets.md` § T-B.

## 1. Verdict

**PASS**

Implementation can proceed. The issues below are minor; fold them in during the build — none
requires a return to `in_planning`.

## 2. Summary

The plan covers all six numbered items of the task description plus the § T-B acceptance criteria,
and its "what is actually true today" section is unusually trustworthy: every line reference I
spot-checked is accurate (`EvaluationPage.tsx:97/126/167/237/297/149-151`, `review.routes.ts:22/125/427`,
`ReviewerPage.tsx:270/420`, `evaluation.routes.ts:41/60/175/353/439/519`, `rubric_criteria` in
`0001_init.sql`, seed round 2 `mode: "comparison"`, `schema-verify.mjs`'s exactly-48 assertion and
`*_new` filtering). The Cycle-1 self-review resolutions already caught the traps I would otherwise
flag (N+1 on completed, `.min(1)` on `criteriaInput`, position reindexing, UTC date round-trip,
kind-change tolerance, layout stability, criteria-never-a-gate). The remaining concerns are edge
cases around criterion-ID churn, migration numbering across the fleet, and validation bounds on the
widened wire schema.

## 3. Issues

**[MINOR] §3 / Resolution 6 — Criterion-ID churn can orphan stored `criteria_scores` keys**
The criteria PUT is delete-all-then-insert, and `criterionInput.id` is optional. The existing editor
preserves ids on edit, but the new add/remove controls introduce paths where a criterion is removed
and re-added, or the operator rebuilds the list — leaving stored reviews keyed by criterion ids that
no longer exist in `round.criteria`. Resolution 6 handles kind *changes* but not criterion
*disappearance*: the read-only reopen view labels values "by criterion name," which fails when the
id no longer matches any current criterion.
**Recommendation:** Two clauses: (a) the editor always sends existing `id`s on PUT (never strips
them); (b) the reopen view renders unmatched keys under a neutral label (e.g. "Removed criterion")
rather than dropping them — stored evidence stays visible, which is exactly what ABS-S3 step 5 is
proving.

**[MINOR] §1 / Risks — Migration `0009` numbering is a fleet-level collision the risk section omits**
Main tops out at `0008`; the untracked `0009_criterion_kinds.sql` scratch in the worktree is fine
today, but MRQ-107/109/110 are in flight and § T-C2 also carries a "small migration." Whoever lands
second inherits a duplicate `0009`, and D1 migrations are ordered by filename.
**Recommendation:** Add to the risks section: before opening the PR, re-check `github/main`'s
`migrations/` and renumber if `0009` is taken; treat the migration filename as a rebase-time check,
same discipline as the `EvaluationPage.tsx` merge.

**[MINOR] §3 — The widened `criteria_scores` union should keep numeric and string bounds**
Today the wire schema is `z.number().min(0)`. The plan's `z.union([z.number(), z.string()])` as
written drops the `min(0)` and adds an unbounded string — a free-text criterion value has no length
cap while `comment` is capped at 20 000.
**Recommendation:** `z.union([z.number().min(0), z.string().max(20_000)])` (or similar) — one line,
keeps the existing floor and prevents an unbounded-payload path into `JsonText`.

**[MINOR] §4 — Date-clearing behavior for the round date pickers is unspecified**
`roundPatch` accepts `opens_at`/`closes_at` as `nullable()`, and the schema CHECK tolerates NULLs —
so clearing a date is a legal state the API supports. An emptied `<input type="date">` yields `""`;
the plan doesn't say whether that PATCHes `null` or is ignored.
**Recommendation:** One sentence in §4: empty date input → PATCH `null` (the API and schema already
support it); the card's read-only display already handles null dates today.

## 4. Positive Observations

- **The "verified in this worktree" section is the plan's backbone, and it holds.** Every claim I
  checked against the actual code was correct, including subtle ones (the queue's `NOT EXISTS`
  making submitted reviews vanish; the unconditional blind-mode block at `:420` sitting beside
  copy at `:415` that *does* branch on `blind_mode`; seed round 2's zero-criteria comparison shape
  making "Round 2's scorecard" structurally impossible). A plan grounded this well de-risks the
  whole build.
- **The Cycle-1 resolutions are real engineering, not ceremony.** The N+1 catch on `completed[]`
  (R7), the `.min(1)` relaxation with its honest rationale ("a rule the product invented"), the
  position-reindex catch against `uq_rubric_criteria_round_position`, and the UTC date round-trip
  (with the explicit carve-out keeping `formatDate`'s America/New_York rendering) each prevent a
  concrete failure mode.
- **Invariants are narrowed, never deleted.** `assertCriteriaTotal` stays enforced for numeric
  criteria at all three call sites; comparison mode stays selectable; inert comparison seed rows are
  kept ("deleting evidence is never the cheap fix"). This is the right posture for a behavior change
  to an existing invariant.
- **The collision section matches the spec's own file-ownership rules** (§ T-B files note, spine
  rules 1–2), including the "resolve cleanly and wrongly" JSX hazard and the explicit no
  `-X theirs/ours` discipline.
- **The migration has a proven house pattern and a stated fallback.** `0008_form_field_dates.sql`
  is a same-shape rebuild that already survives `schema-verify.mjs` (which filters `*_new` and
  asserts exactly 48 tables — a rebuild changes neither count), so the primary path is
  low-risk and the ALTER-ADD-COLUMN fallback likely never triggers.
- **Scope discipline:** the plan declines to add criteria to `comparisonQueuePayload`, keeps the
  A/M/D fast path as the only save gate (protecting CFP-S3), and targets vitest only per the fleet
  load rule.
