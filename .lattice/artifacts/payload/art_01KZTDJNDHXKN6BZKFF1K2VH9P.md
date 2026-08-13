# Plan Review: MRQ-115 — Files library and version lists

## 1. Verdict

**PASS** — Plan is complete, feasible, and aligned. Implementation can proceed.

## 2. Summary

Reviewed the MRQ-115 plan (T-F1: files library, version lists, portal CNT-02 rescue, `/files` route) against the task description, spec section T-F1 in `sequence/eval-response-tickets.md`, and the live codebase. Every evidence claim in §1 of the plan was spot-checked and verified accurate — file paths, line numbers, schema facts, the `route-table.test.ts` ordered-label contract, the `_manifest.ts` glob, the `program:read` grant shape, and the `owner_type='task_upload' / owner_id = speaker_task.id` join semantics all check out. The plan covers all four numbered task requirements plus the human-lens requirement, and its design decisions (derived `is_latest`, ready-only versions, expected-deliverable row model) correctly avoid the traps the spec names. Remaining concerns are minor definitional gaps, not blockers.

## 3. Issues

**[minor] §3.2 — "Overdue" state is used but never defined**
The API exposes `state=overdue`, an Overdue metric tile, and an overdue count, but the plan never states the predicate (presumably `due_at < now` AND no ready upload AND not cancelled AND task `status='open'`). Design decision 5 defines cancelled-task semantics for "missing" but is silent on overdue — a cancelled task past its due date must not count as overdue either, or the chase metrics lie the same way "missing" would. This is exactly the kind of ambiguity that produces a counts-disagree-with-rows bug the plan's own test (`counts agree with rows`) would then enshrine wrongly.
**Recommendation:** Add one sentence defining the state machine per row: `uploaded` (ready attachment exists), `overdue` (no upload, `due_at < now`, not cancelled), `missing` (no upload, not overdue, not cancelled), with cancelled rows excluded from missing/overdue counts but present under `all`.

**[minor] §3.1 — Pointer-resolves-to-excluded-row behavior is undefined**
Versions are `status='ready'` only (correct), and `is_latest` is derived from the pointer. The portal's completion path guards the pointer to ready rows (`portal.routes.ts:1009`), so pointer→pending shouldn't occur for `task_upload` — but `person_headshot` writes via a different path, and the helper is generic. If the pointer references a row outside the ready set, the plan's `FileVersionList` could return `versions.length > 0` with `latest: null` and `latest_source: "pointer"`, which callers won't expect.
**Recommendation:** Define the fallback explicitly: if the pointer misses the ready set, fall back to recency and report `latest_source: "recency"`. One unit-test case covers it.

**[minor] §3.2 — `counts` and `metrics` largely duplicate each other**
`counts{all,uploaded,missing,overdue}` and `metrics{expected,received,missing,overdue}` are the same numbers under two names (all≈expected, uploaded≈received, missing/overdue verbatim). Two shapes for one truth invites drift between the filter chips and the tiles.
**Recommendation:** Ship one object (e.g. `counts`) and let the tiles and chips read the same fields, or state why the two genuinely differ (e.g. metrics are event-wide while counts respect active filters — if so, say that in the plan).

**[minor] §3.1 — Signature deviates from the ticket's named contract**
The task description names `listVersionsFor(db, ownerType, ownerId)`; the plan adds a `mediaOrigin` parameter and a batch variant. Both are justified (URL construction needs the origin; the portal and library batch), and exporting both is right for T-D2 — but T-D2's spec text says to consume "T-F1's `listVersionsFor` helper," so the extra parameter is a cross-ticket interface detail.
**Recommendation:** Note the final exported signatures in the PR description so T-D2's delegator consumes the real contract rather than the ticket's shorthand. No plan change needed beyond that.

## 4. Positive Observations

- **Evidence table is real, not decorative.** Every claim in §1 carries a file:line citation, and every one I checked was accurate — including the subtle ones (the `route-table.test.ts` exact-ordered-list contract vs. `verify-design-contract.mjs`'s subset check, and the live media-origin curl). This is what makes the rest of the plan trustworthy.
- **The trap-avoidance decisions are exactly right.** Derived `is_latest` (never stored), ready-only version counting, and pointer-at-non-newest-row as an explicit unit-test case directly neutralize the drift failure the spec calls out ("AV stages the wrong deck"). The `latest_source: "pointer" | "recency"` distinction is an honest API — callers can't mistake a fallback for a pointer.
- **Expected-deliverable row model.** Building the library as speakers × file-tasks (filled or empty) rather than attachment-first is the human-lens requirement done properly, and the observation that it makes the screen non-empty before the judge uploads anything is sharp — it's what makes CNT-13 findable at all.
- **Cross-ticket discipline.** §6 correctly applies the §4 ownership rules: attachments SQL stays in this ticket, `uploads.routes.ts` untouched, exports staged for T-D2/F2/F3, and the non-obvious paired edit (`route-table.test.ts`) flagged for the next sidebar-row ticket. Forward-shipping the selection surface for T-F3 without building F3's dialog is scope restraint, not creep.
- **Deliberate contract edits, not workarounds.** Editing the ordered-label test on purpose — and saying so — is the right relationship to a contract test.
- **Validation is deployed-shape:** real browser, real double upload, collapsed-row filename check (the CNT-02 evidence must not require expansion), and the media-origin URL confirmed end-to-end. Risks section is honest, including the seeded-demo-has-no-file-tasks failure mode with a non-pretending empty state.
