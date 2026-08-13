# Code Review: MRQ-151 — "V2-2: the review chain tells the reviewer and the chair the same truth"

Reviewed at `Marquee-worktrees/v2-2-review-truth`, commits `f469dccb` + `c0d7855f` (branch tip `c0d7855f`, base `a8b97e0a`).
Verified: `npx tsc --noEmit` clean; `npm test` → **191 pass / 0 fail** (156s wall, over the 45s objective — machine is running a large worktree fleet, so per `CLAUDE.md` this is load, not a defect).

---

## 1. Verdict

**FAIL (implementation-level)**

The plan is sound and items 1–3 are largely delivered. **Item 4 — "ONE SCORE, ONE NAME" — is entirely unimplemented.** Neither half of it was touched: the record's per-review row still renders the raw scalar, and `Saved by reviewer {actor_id}` is still on screen verbatim. The ticket's own VERIFY step ("the organizer record shows that name, that comment, 4.00 weighted") cannot pass against this branch. Return to `in_progress`.

---

## 2. Summary

This diff changes reviewer-queue copy to name the rule the engine actually enforces, adds a wrapping full-URL rendering beside the invite link's readonly input, and adds "Exported {n} rows · {filename}" confirmations to two of the three export controls. The copy change is the strongest part of the work — I traced it against `src/lib/reviewer-scope.ts`, and `authorizeReviewerQueueScope` genuinely applies **both** `REVIEWER_TRACK_SCOPE_SQL` and `REVIEWER_ASSIGNMENT_SCOPE_SQL`, so the new sentence is true rather than merely different, which is the entire point of the ticket.

The key finding is a whole quarter of the acceptance criteria missing: item 4 has no corresponding change in the diff, no test, and no note explaining an intentional deferral. The secondary finding is that "either export" was read as two of the three export buttons, leaving the identical "Export scores (CSV)" control on the submissions page silent while its twin on the evaluation page now confirms.

---

## 3. Issues

**[CRITICAL] src/ui/submissions/SubmissionRecordPage.tsx:377 — Item 4 (score half) not implemented: the record's per-review row still shows the raw scalar, not the weighted value**

The row renders `evaluation.score.toFixed(2)`, which is the raw `evaluations.score` column selected verbatim at `src/routes/submission-record.routes.ts:600`. The submissions list, by contrast, shows the weight-normalised mean produced by `reviewAggregateColumns()` in `src/lib/review-aggregate.ts:56`. These are two different numbers under one unlabelled `4.00`-shaped presentation — which is precisely the divergence a prior evaluation misread as a "4.00 displaying as 2.00" corruption bug. The plan's note is explicit that there is no data bug and that this item exists *to make the distinction legible so no future reader repeats the misreading*. Nothing in this diff makes it legible; the next reader will file the same phantom defect.

Note the query already selects `evaluation.criteria_scores` (line 601), but the UI's `evaluations` interface at `SubmissionRecordPage.tsx:50` doesn't carry it, so the weighted value is not even reachable client-side today.

**Fix:** Have `submission-record.routes.ts` compute the per-evaluation weighted value through the shared definition in `src/lib/review-aggregate.ts` (the per-row `weighted_value` expression inside `contributingRows` is already exactly this calculation — lift it into an exported helper rather than re-deriving it), return it alongside `score_is_weighted`, and render it in the row as the labelled primary value using `scoreBasisLabel()`. Keep the raw `evaluations.score` as secondary detail, as the plan specifies.

---

**[CRITICAL] src/ui/review/ReviewerPage.tsx:545 — Item 4 (name half) not implemented: `Saved by reviewer {actor_id}` is unchanged**

The saved-review panel still renders `Saved by reviewer <span class="tabular">{detail.review.actor_id}</span>` — the literal string the plan names for replacement. A reviewer reading their own saved review sees an opaque ID like `per_reviewer-dario-quill`, which is the exact artifact that made the earlier evaluator believe a comment had landed on the wrong reviewer's row.

This is a one-line fix that was available: `useIdentity()` is already called at line 196 and `identity.name` is already rendered at line 452 in the "Reviewing as …" chip.

**Fix:** Render the reviewer's display name. Prefer a name carried on the review payload so a chair-visible rendering stays correct; failing that, `identity?.name ?? detail.review.actor_id` is a correct fallback for this self-view panel, since the panel is by definition the signed-in reviewer's own review. Add a contract assertion to `tests/unit/review-truth.MRQ-151.test.ts` — the file currently has no item-4 coverage at all.

---

**[MAJOR] src/ui/submissions/SubmissionsPage.tsx:736 — "EXPORTS SAY WHAT THEY DID" skips one of the three export controls**

There are three export controls in play. The submissions-page `Export` button (line 619) and the evaluation-page `Export scores (CSV)` anchor (line 628) both got a confirmation. The submissions page's *own* `Export scores (CSV)` anchor is still a bare `href` + `download` with no handler and no notice — same endpoint, same filename, same label as the one that now confirms, one page over. An organizer who fires it gets nothing, and the reserved `.export-message` slot directly beneath it stays on its placeholder. Under any reading of "after either export," this control is the odd one out.

**Fix:** Extract the `exportResults` handler from `EvaluationPage.tsx:472` into a shared module (it is generic over `eventId`/`planId`) and wire it to both anchors, reporting through `setExportNotice` here and `setNotice` there. This also removes the duplication the current diff introduces.

---

**[MINOR] src/ui/evaluation/EvaluationPage.tsx:713-715 — the invite credential is now rendered twice, and the truncating input the eval flagged is still there**

The plan asks for the full URL as wrapping text *keeping the Copy button*; it does not ask to keep the readonly input. The diff adds the `<code>` block **beside** the input, so `.invite-link` now holds the same magic link twice — a screen reader reads the credential out in full, then again, and the truncated readonly field that the eval logged as the defect is still the first thing a sighted reader's eye lands on.

**Fix:** Drop the `<input readOnly>` and let the `<code>` block be the display, with the Copy button beside it. That satisfies the requirement exactly, removes the duplication, and eliminates the original complaint rather than sitting next to it.

---

**[MINOR] src/ui/evaluation/EvaluationPage.tsx:715 — `aria-label` on `<code>` is prohibited by ARIA and will be dropped**

`<code>` maps to the ARIA `code` role, which is in the name-prohibited set (alongside `generic`, `paragraph`, `emphasis`, `strong`, …). Conformant assistive technology ignores `aria-label` there and axe flags it as a violation. Since the stated goal is "an agent can read it from the accessibility tree," this matters: the element's *text* is exposed fine, but the label announcing what it is will not be. The new test at line 22 asserts on this attribute, so it locks the invalid pattern in.

**Fix:** Move the label to a named container — e.g. `<div role="group" aria-label="Full reviewer sign-in link"><code …>{link}</code></div>` — or render the URL as an `<a href>` (which accepts a name and matches "an anchor or code block" in the plan). Update the test assertion to follow.

---

**[MINOR] src/ui/evaluation/EvaluationPage.tsx:148-165 — `csvDataRowCount` solves a problem the writer forecloses, and its edge cases are untested**

The counter carefully tracks quoted regions so a line break inside a field isn't miscounted. But `csvCell` at `src/routes/evaluation-results.routes.ts:52` does `.replaceAll("\n", " ").replaceAll("\r", " ")` on every cell, so this export can never contain an embedded newline. Nineteen lines of hand-rolled parser guard against an input the producing endpoint cannot emit. The sibling implementation at `SubmissionsPage.tsx:619` gets the same answer from `exported.length` — exact, free, and obviously correct.

Compounding it: the function is module-private, so its genuine edge cases (empty body, header-only, no trailing newline, escaped `""`) have no behavioral test. The new test file only greps the source for the identifier — that catches deletion, not breakage.

**Fix:** Simplest — have the endpoint return the row count in a header (`X-Row-Count`) and read it. Otherwise, either count `\n` plainly with a comment naming `csvCell`'s newline-stripping as the invariant relied on, or export `csvDataRowCount` and give it real cases.

---

**[MINOR] src/ui/evaluation/EvaluationPage.tsx:479 — `plan?.id` can serialise as `undefined` into the URL, and `eventId` is unencoded**

The handler only attaches to an anchor rendered under a non-null `plan`, so this is defensive today — but the optional chain silently produces `/plans/undefined/results/export`, and the user would see an opaque "the export request failed with status 404". The sibling `href` two lines earlier uses `plan.id` unconditionally, so the two disagree about whether `plan` can be null. Separately, `${eventId}` is interpolated raw here while `SubmissionsPage.tsx:736` and `BulkExportDialog.tsx:132` both wrap it in `encodeURIComponent`.

**Fix:** `if (!plan) return;` after the modifier-key guard, then use `plan.id`; wrap `eventId` in `encodeURIComponent`.

---

**[MINOR] src/ui/evaluation/EvaluationPage.tsx:472 — no in-flight guard; a double-click fires two exports and two downloads**

`exportMatching` on the submissions page guards with `exporting` and disables its button. `exportResults` has no equivalent, so an impatient double-click issues two requests and triggers two file saves.

**Fix:** Track an `exportingResults` state, return early while it is set, and reflect it on the anchor (`aria-busy`, or swap the label to "Exporting…" as the sibling does).

---

**[MINOR] src/ui/evaluation/EvaluationPage.tsx:634 — the export confirmation shifts the page down when it appears**

`{notice && <div class="evaluation-alert success" …>}` is conditionally rendered, so everything below it jumps the moment an export completes. `DESIGN.md`/global rule: interactive elements never move on state change. The submissions page does this correctly — `.export-message` is always in the DOM with `min-height: 18px` and a reserved placeholder string, which is why item 3's phrasing says "the existing notice slot."

This pattern predates the diff, but this change adds a new, frequently-fired trigger for it and the button that moves (`Refresh`, `Distribute assignments`, `+ New evaluation plan`) is directly above.

**Fix:** Reserve the alert's height the way `.export-message` does, or route the export confirmation into a reserved slot rather than the jumping alert.

---

## 4. Positive Observations

- **The copy change is verified, not asserted.** I traced `assigned to you — directly or through your committee` against `src/lib/reviewer-scope.ts:93-110` and `authorizeReviewerQueueScope`, and against `assignedSubmissionIds` in `review.routes.ts:159-179`. Both the assignment predicate (direct **or** committee membership) and the track-scope predicate are genuinely enforced on the queue path. The new sentence describes the engine accurately, including the trailing "Record, file, export, and review access use the same rule" — `ReviewerScopeOperation` at `reviewer-scope.ts:6` literally enumerates those four operations through the one helper. This is the ticket's actual point and the diff lands it.
- **The comparison-mode and empty-state copy were carried along.** It would have been easy to fix the headline sentence and leave "There are no unreviewed submissions in your authorized tracks" behind in the empty state; both were updated, and the negative assertions in the test (`not.toContain`) will catch a regression that reintroduces either phrase.
- **The export handler respects modifier keys.** `event.button !== 0 || metaKey || ctrlKey || shiftKey || altKey` → return, letting the native anchor handle cmd-click and middle-click. That is a genuinely thoughtful detail most implementations of "intercept a download link" get wrong, and it means power users keep open-in-new-tab behaviour.
- **`exported.length` on the submissions page is the exact row count**, read from the paginated accumulation rather than re-derived — the count in the notice cannot drift from the rows in the file.
- **Source-grep contract tests match the house convention** (eleven existing files in `tests/unit` use the same `readFileSync` pattern), and the test names state what they verify. The `not.toContain` assertions in particular do real work here — copy regressions are otherwise invisible to a unit suite.
- **The CSS additions honour the layout discipline**: `grid-column: 1 / -1` keeps the new block from disturbing the existing two-column grid, `overflow-wrap: anywhere` is the correct choice for an unbreakable URL, and `.export-message.success` reuses the already-reserved slot rather than adding a new one.
