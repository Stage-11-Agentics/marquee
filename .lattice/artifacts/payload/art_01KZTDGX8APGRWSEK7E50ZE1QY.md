# Plan Review: MRQ-118 — Organizer content editing with named history and restore

Reviewer: plan-review agent (Claude). Every ground-truth claim in the plan was re-verified against the code in the primary checkout (`main @ 13a77cb`, code-identical to the worktree base `23a06b0` for all cited files).

## 1. Verdict

**PASS** — Implementation can proceed. One major issue (the `description`/`abstract` key mismatch in restorable audit rows, detailed below) must be incorporated during implementation; it has a small, unambiguous fix and does not require re-planning.

## 2. Summary

Reviewed the MRQ-118 plan for extending organizer content editing to non-draft submissions with batched audit rows, a lifted shared history library, and restore-as-forward-edit. The plan is unusually well grounded — every code citation checks out (patchDraft's draft-only guard at `submission-record.routes.ts:793`, the draft-only editor card and the `actor_kind` render in `SubmissionRecordPage.tsx`, the join-less admin history query at `:403-408`, the portal's `historyFor` and batch-write patterns, the `auditStatement` helper, and the status enum that confirms "scheduled" is not a status). The key concern is that the plan asserts `speaker_talk_updated` rows need "no special case" for restore, but those rows store `{title, description}` while the new rows will store `{title, abstract}` — a shape mismatch the restore path and the restore-gating check must normalize or they will silently misbehave on speaker-authored history.

## 3. Issues

**[MAJOR] Sections 2, 3, and Risks — `speaker_talk_updated` before/after uses `description`, not `abstract`; "no special case is needed" is false as stated**
The portal write (`portal.routes.ts:1357-1358`) records `before: { title, description }` / `after: { title, description }`. The plan's new helper records `{ title, abstract }`. Both actions sit in `CONTENT_ACTIONS`, and two consumers depend on the key shape: (a) F2's restore gate — "rows whose `before_json` carries a title/abstract get the control" — read literally, speaker rows carry no `abstract` key and either lose the control or, worse, pass a looser check and restore `abstract: undefined`, nulling the abstract on a live record; (b) the restore endpoint itself, which re-applies `before_json` through the write helper. The Risks section explicitly claims "restore from them is the same operation, so no special case is needed" — the key mismatch is exactly the special case.
**Recommendation:** Normalize on read in `src/lib/history.ts`: map both shapes into one canonical `{ title, abstract }` in `contentHistoryFor`/`recordHistoryFor` output, so the restore endpoint, the restore-gating check, and the `ContentHistory` preview all operate on a single shape. Add a test that restores from a `speaker_talk_updated` row and asserts the abstract survives.

**[MINOR] Section 1 — `patchDraft` integration needs more current-state than it loads today, and must not break answers-only saves**
`patchDraft`'s SELECT pulls only `id, form_id, status` (`:791`); the shared helper needs the current title and abstract to build a truthful `before` image, so the SELECT widens. Separately, `patchDraft` accepts partial bodies and answers-only saves: the helper's fixed `SET title, abstract, search_blob, …` UPDATE (with `next = body.x ?? current.x`) replaces the current dynamic UPDATE, and the no-op suppression must skip only the *audit row* on an answers-only save — the answers statements and `last_saved_at` bump must still run in the batch. Test 10 covers the regression, but the plan doesn't spell out this composition and it's the likeliest place for a subtle break.
**Recommendation:** During implementation, treat `contentWriteStatements` as producing statements that are *appended into* patchDraft's existing batch (answers deletes/inserts included), with the audit statement conditionally included, rather than replacing patchDraft's flow wholesale.

**[MINOR] Section 2 — restore's read-then-batch is not atomic**
Restore loads the current record, then batch-writes the restored values with `before` = the loaded state. A concurrent edit landing between the read and the batch makes the restore's `before` image stale (the audit row would claim it changed values it didn't see). Vanishingly unlikely at this app's concurrency, and the batch itself stays atomic, so this is an accepted-risk note, not a blocker.
**Recommendation:** Acknowledge in the PR; optionally guard the UPDATE with `AND updated_at = ?` from the read and 409 on mismatch if it turns out to be cheap.

**[MINOR] Section 4 — `statusLabel` title-cases every word**
Verified `record-copy.ts:14`: unknown keys render as "Content Updated" / "Content Restored" (title case), not the "Content updated" sentence case F5 names. Cosmetic; no special-casing needed unless the design language demands sentence case, in which case add the two labels as F5 already contemplates.

No critical issues found.

## 4. Positive Observations

- **The ground-truth table is real, and it's all true.** Every one of the eleven verified claims held up under independent re-reading, including the two that most often go wrong in plans of this shape: the discovery that "scheduled"/"published" are not statuses (they derive from `agenda_items` — the ticket-text correction is right and properly flagged as a deviation), and the observation that `patchDraft` never maintains `search_blob` while the portal write does. Catching the search-index divergence *and* tying it to CNT-S3 step 15's lookup-by-title is exactly the kind of cross-referencing that prevents a silent scoring failure.
- **Attribution is feasible, not assumed.** The rubric demands a name ("Jordan Alvarez"), and the codebase supports it: `actorFor` (`submission-record.routes.ts:167-175`) resolves a `personId` for both session and api-token actors, so the new writes can carry `actor_person_id` and the people-join renders a name. The plan's `actor_name || "Conference team"` fallback matches the existing decision-history idiom on the same page.
- **Restore-as-forward-edit is the right model and is stated with its invariants** — history only grows, the restore row is truthful about what the restore changed, and the byte-identity test (test 8) pins "never rewrite audit rows" as an assertion, not a promise.
- **The self-review cycle added genuine value.** F1 (the restore-button ambiguity with the title preview) addresses a real judge-facing failure mode; F4 correctly defers the `check:api` parity question to implementation with the honest resolution (extend e2e coverage, not allowlist); F6's no-op-equality reasoning is sound.
- **Collision analysis matches reality** — the new routes live in an existing globbed file, the T-L overlap is confined to a different handler, and the `ContentHistory` props contract (`entries`, not a submission) is the right seam for T-D1.
- **The grants choice is verified-by-pattern**: `program:write` is exactly what `scheduleSubmission` (`:849`) and `publishSubmission` (`:893`) use.
- The test list traces cleanly to CNT-09/CNT-11 and the cross-cutting facts; the UI section pre-applies the elements-never-jump rule (reserved confirm slot, fixed button width) rather than retrofitting it.
