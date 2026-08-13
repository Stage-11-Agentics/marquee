# Code review — MRQ-114 · Task authoring: templates and assignment

**Verdict: PASS**

Reviewed commit `HEAD` on `mrq-114-task-authoring` (== branch tip at time of writing) against SPEC section T-E, the eval kit's CNT-01/SPK-05 YAML, the cross-cutting facts, and the schema.

## How this review was produced

The auto-fired single reviewer (`lattice code-review`, pid 43241) **timed out after 600s** with the box at 1-min load 199. Per COMMON.md's timebox rule the fallback is a self-review, which this is — written adversarially against the diff, and backed by driving the built Worker and the real page rather than by reading alone. Its two most valuable findings (below) came from that live pass, not from reading the code.

## Findings, all resolved in-branch

1. **[MAJOR — found live, fixed] Every draft handler spread stale state.** `setDraft({ ...draft, … })` closes over the `draft` captured at render time. Driving the real form: ticking two speakers in one frame kept only the second, and ticking a speaker *after* typing a due date silently wiped the date back to empty. On a control whose entire purpose is picking several people at once, that is a defect the rubric would have caught as a wrong assignment count. All eleven handlers now take previous state as an argument, and `AssigneePicker` emits a transform rather than a snapshot. Locked by "draft edits compose instead of overwriting each other".

2. **[MAJOR — found live, fixed] Task names rendered at width 0.** `.settings-row-heading` is a flex line built for two items and its `strong` carries `overflow: hidden`, which zeroes a flex item's automatic minimum size. Adding the kind badge made a third item, and at the 320px viewport the name collapsed to nothing — measured, not guessed: `getBoundingClientRect().width === 0` for every row while the text sat in the DOM. A task list with no task names fails CNT-01 on the screenshot alone. The name now owns its own grid row. Locked by "the task name cannot collapse out of its row".

3. **[MEDIUM — fixed] The picker did not scale to a real conference.** 1,097 assignable people on the seeded event, rendered as an unsearchable checkbox column, with a "Select all" that would assign a task to all 1,097. Added a search field; "Select all" now takes what the search is showing. This is the human half of the mandate as much as the rubric half.

4. **[MINOR — fixed] The assignment list shipped instructions nothing renders.** Removed `description` from that projection: 173KB → 148KB on the seeded event. Speed is a feature (R7).

5. **[MINOR — fixed, from the plan review] Offset deadlines had no per-row anchor on PATCH.** Recomputing `now + offset` for every open row meant renaming a task handed every speaker a fresh extension. Now recomputed against each row's own `created_at`.

6. **[MINOR — fixed, from the plan review] Cross-surface date disagreement.** The portal and chase board format due dates in the browser's local zone; an end-of-day-UTC instant reads as the next day east of Greenwich. All three surfaces now share one UTC formatter.

## What I checked and found sound

- **Authorization and scoping.** Every route carries `program:read`/`program:write` and is event-scoped. `assignmentStatements` refuses people outside the conference's org (verified: 422). A cross-event `form_id` is refused (verified: 422). An unknown event id answers 403 from authorization before the handler, leaking nothing about whether it exists.
- **Atomicity and audit.** Template insert, every `speaker_tasks` row, and all audit rows compose into one `batch()` — cross-cutting fact 6. No path writes an audit row in a separate transaction from the change it describes.
- **The CHECK constraints are enforced in Zod first**, so a bad body is a 422 naming the field rather than a 500 from SQLite. Mode switching nulls the other column; both in one body is 422. Verified live.
- **Destructive semantics preserve evidence.** DELETE refuses over completed work (verified: 409, "30 speakers have already completed this task"), and `kind` cannot change under speakers already holding the task.
- **Duplicate assignment is a no-op that says so** (verified: `{"assigned":1,"skipped":2}`), rather than minting a second copy of the same obligation.
- **Backward compatibility.** MRQ-96's suite passes untouched — the file-config-only PATCH body still means what it meant.

## Residual risk, named

- `GET /speaker-tasks` returns every assignment for the conference with no pagination — 354 rows / 148KB seeded, and it grows with the conference. It is fast today (20ms) and the page needs the counts, but a 5,000-speaker conference would want `?template_id=` filtering on expand. Not built: it is speculative at this size, and the honest fix is a measurement away rather than a guess now.
- The create form's submit path is covered by integration tests against the real Worker app and was driven end to end in the browser; the *edit* and *delete* row controls were exercised via the API but not through clicks, because c11's browser IPC was failing intermittently under fleet load.
