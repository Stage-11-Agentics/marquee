# MRQ-108 code review — diff review

**Reviewed commit:** `5e63cb7f133d95f5e77a317ed31c4510cf3f2f1a` (branch HEAD) against `github/main`.
**Verdict: PASS.**

**Reviewer provenance (fallback, disclosed):** the auto-fired single headless reviewer
(`review_mode: single`, pid 10585) **timed out after 600s** with the box at 1-min load 105–172.
Per COMMON.md ("Timebox any spawned reviewer and fall back to reviewing it yourself on RC 124 …
Note the fallback in your completion comment") this is a delegator self-review of the diff. It is
weaker than fresh eyes and is flagged as such.

## Findings raised and resolved in this cycle

**1 · The completed queue was unbounded — reviewer hot path (severity: medium).**
`completedSubmissionIds` returned every review a reviewer had ever submitted for the round, on
every queue load, each one then joined through `queueRows`. The open queue shrinks as work is done;
the completed list only grows, so the surface would get slower with every review — the exact shape
R7 calls a defect. **Fixed:** `LIMIT COMPLETED_PAGE + 1` (50), sliced to 50, with
`completed_truncated` in the payload and the reviewer header reading "Your most recent reviews"
when it is set. Truncation is disclosed rather than silently capping a count.

**2 · `criteria_scores` had no key-count bound (severity: low).**
`z.record(z.string(), z.union([z.number(), z.string().max(20_000)]))` capped each value at 20k but
not the number of entries, so one authorized write could carry an arbitrarily large map into a JSON
column. **Fixed:** `.refine(… ≤ 40 …)`, matching `criteriaInput`'s own `.max(40)`.

**3 · Duplicate criterion positions produced a 500, not a 422 (severity: low).**
The criteria PUT is delete-all-then-insert inside one `batch()`, and
`uq_rubric_criteria_round_position` is unique on `(round_id, position)`. A caller sending two
criteria at the same position hit the index inside the batch and got an opaque failure. The editor
renumbers `0..n-1` so the UI never does this, but the API is public surface. **Fixed:**
`normalizeCriteria` raises `422 position · "each criterion needs its own position"`.

## Checked and found sound

- **Authorization.** `completedQueue` routes its candidates through the *same*
  `authorizeReviewerQueueScope` seam as the open queue rather than adding a second path, so a
  reviewer who has lost track scope cannot reopen work they wrote under it. Covered by a test that
  asserts a non-scoped session sees no completed rows.
- **Anonymity (AC-64).** Untouched server-side: `identity` is still `round.anonymized ? null : …`,
  stripped in the query layer. The template change only decides which of two already-authorized
  payloads to render.
- **The weights relaxation is a narrowing, not a removal.** `assertCriteriaTotal` still demands 100
  whenever any numeric criterion exists; it exempts only scorecards that ask for no rating at all.
- **No N+1.** `reviewsForSubmissions` fetches every stored review in one chunked query.
- **Kind changes do not break stored reviews.** The reopen view renders whatever is stored, coerced
  to a string, labelled by criterion name with the raw id as fallback — a criterion retyped after a
  review was written degrades to showing the value, never to a crash or a blank.
- **Migration.** Table rebuild follows the `0008` house pattern; verified by `schema-verify`
  (48 tables / 120 indexes / 91 FKs) and applied clean to a real local D1.

## Deliberate deviation, flagged for the Orchestrator

`tests/unit/reviewer-surface.AC-61-158-159.test.ts` asserted
`expect(reviewerPageSource).not.toMatch(/detail\.identity/)` — a blanket source guard that pinned
the very defect this ticket's rider names (the redaction block rendered unconditionally, so a
non-anonymized round displayed "Redacted in anonymous review" beside an "Identity visible" chip).
SPEC.md §"Authenticated — reviewer scope" is explicit that anonymized responses strip identity
**"from the query payload, not the template"**, so the guard encoded a mechanism the spec does not
use. It was **narrowed, not deleted**: every line mentioning `detail.identity` must also contain
`detail.blind_mode ?`, and the redaction string must still be present. The invariant is now
stronger (identity may only appear on the false arm of an explicit blind branch) while the honest
fix can land. The same file's `toContain("criteria_scores: null")` was likewise asserting the
hardcoded null this ticket exists to remove.