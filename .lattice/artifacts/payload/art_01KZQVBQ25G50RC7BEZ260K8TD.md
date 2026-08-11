# Code Review: MRQ-38 — Role confirm/decline + decision feedback (M-42 + M-52)

**Reviewed commit:** `d390608` (`mrq-38-confirm`, worktree `Marquee-worktrees/mrq-38-confirm`), reviewed against local `master` (`df23e01`).
**Note on the supplied diff:** the diff embedded in the review prompt was cut against an older base and includes MRQ-70's vitest split and other tickets' `.lattice` artifacts. This review evaluates the actual MRQ-38 change: `git diff master...mrq-38-confirm` — 23 files, +958/−76.

## 1. Verdict

**PASS**

All five owned ACs (AC-152, AC-153, AC-154, AC-235, AC-236) are implemented and covered by passing tests. Evidence gathered independently during this review:

- Targeted suite `tests/integration/api/role-confirmation-feedback.AC-152-154-235-236.test.ts`: **4/4 passed** (4.65 s).
- Full `npm test` in the worktree: **pass, hermetic, 10,681 ms against the 30,000 ms budget** (0 failures).
- `npx tsc --noEmit` for both `tsconfig.json` and `tsconfig.test.json`: **clean**.
- `npm run trace:ac -- --scope=merged --ticket=MRQ-38`: **pass** — 28 claims, 0 uncovered, 0 errors.

The issues below are minor; none require returning to `in_progress`. One coordination obligation (the unmerged MRQ-24 seam) must be discharged before `pr_open`, exactly as the plan's Cycle-1 resolutions already prescribe.

## 2. Summary

MRQ-38 fills the speaker-response surface: per-participation confirm/decline routes with strict write predicates, a decline notification to program leads through the existing outbox, a derived agenda decline flag, and the AC-235 decision-feedback path where a single `insertDecisions` writer and a single renderer feed both the outbox and the portal projection. The implementation is disciplined and closely tracks the plan — the render-once boundary is genuinely single-path, negative tests assert unchanged state with positive controls, and the layout rules (reserved-height flags, fixed action rows) are respected. Findings are limited to a preview/send merge-data inconsistency, an idempotency-scope limitation inherited from the seam design, minor a11y/test-coverage gaps, and two process items to carry into the completion report.

## 3. Issues

**[MAJOR — process, pre-`pr_open` obligation] src/routes/comms.routes.ts:1 — PR diff includes the unmerged MRQ-24 seam; must be reported to the Orchestrator per Plan-Review Cycle 1 Resolutions**
`mrq-24-chase` is not merged into `master` and is not an ancestor of `mrq-38-confirm`. The MRQ-38 diff therefore carries seam code (`renderAdHocMail` in `src/jobs/mail/render.ts`, the new `src/jobs/mail/merge-data.ts`, the exported `recipientsFor`/`ReminderSelector`). The seam files `render.ts` and `merge-data.ts` are byte-identical to `mrq-24-chase`'s copies (good), but `comms.routes.ts` diverges from MRQ-24's version by ~166 lines, so whichever branch merges second will hit a real conflict. This is not an implementation defect — the plan sanctioned building against the published seam — but the plan's authoritative Cycle-1 resolution requires that this exact state be reported to the Orchestrator at the PR boundary rather than silently included.
**Fix:** In the `pr_open` handoff, name the seam files carried, note that `render.ts`/`merge-data.ts` are identical to `mrq-24-chase` while `comms.routes.ts` has diverged, and request the merge-ordering ruling.

**[MINOR] src/routes/comms.routes.ts:336–341 — Preview merge data can silently disagree with send**
`previewComms` resolves the recipient with a hard-coded `task_state: "open"` filter. If the selected person/submission has no open speaker task, `recipientsFor` returns `[]` and the preview falls back to name-only merge data — so `{{submission.title}}`, `{{session.time}}`, etc. render as literal placeholders in the preview, while the actual send (which applies no `task_state` filter) resolves them. Preview and send are supposed to be the same rendering; here their *inputs* diverge.
**Fix:** Drop `task_state: "open"` from the preview selection (the `speaker_tasks` correlated subquery already prefers open tasks for `task.*` fields), or fall back to a second lookup without the filter before degrading to name-only data.

**[MINOR — design limitation to surface, not fix here] src/jobs/mail/outbox.ts:33–39 — Ad-hoc idempotency suppresses distinct later messages, not just duplicate clicks**
The key is `sha256("custom", submission_id, person_id)`, so after one one-off record message to a participant, **any** future distinct ad-hoc message to the same person about the same submission converges to the first row and is never queued. The plan explicitly endorses convergence for duplicate clicks, AC-236's test asserts it, and the UI at least surfaces "That message was already queued for this participant" — so this is conformant. But MRQ-38's record composer makes the send-a-second-note-next-week case a realistic operator flow that is now permanently blocked per (submission, person).
**Fix:** No change in this ticket (it would violate the plan). Flag to the Orchestrator as a seam design question — e.g., folding a content hash or an operator-supplied idempotency token into the ad-hoc key would preserve duplicate-click convergence while permitting distinct messages.

**[MINOR] src/ui/submissions/SubmissionRecordPage.tsx:246 — Inline panel mislabeled as a modal dialog**
The decision-feedback panel uses `role="dialog" aria-modal="true"` on an inline, in-flow `div` with no focus trap and no inert background. `aria-modal="true"` tells assistive tech the rest of the page is unavailable, which is false. Additionally, the panel's appearance pushes the Decision history card and everything below it down, which brushes against the project's Elements-Never-Jump ruling (it is at least triggered only by an explicit click, matching the existing inline-editor pattern in this file).
**Fix:** Either render it as a true overlay (positioned, focus-trapped) or drop `aria-modal` and use a plain disclosure region (`role="group"` with a labelled heading).

**[MINOR] src/routes/portal.routes.ts:352–366 — Untested response branches**
Three branches of `respondToParticipation` have no test: (1) repeat of the same response returns `200 { changed: false }`; (2) decline-then-confirm returns 409 "already has a different response"; (3) confirm on a not-yet-accepted submission returns 409. The code reads correct in all three, but AC-152/153's guardrail style elsewhere (status + unchanged-state assertion) would cheaply cover them.
**Fix:** Add three assertions to the existing sequential suite; the fixtures already exist (`SUB_TWO_ROLES` post-confirm covers case 1 and 2; a pre-decision submission covers case 3).

**[MINOR] src/routes/comms.routes.ts:129–131, 391 — Loosened type hides an invariant**
`RecipientRow.submission_id` was widened to `string | null`, and the send path adds a `?? recipient.person_id` fallback for `entityId` — but `recipientsFor` inner-joins `submissions`, so `submission_id` can never be null. The fallback is dead code and, if it ever *did* execute, would silently change the idempotency identity from submission-scoped to person-scoped.
**Fix:** Restore `submission_id: string` and delete the fallback, or add a comment stating which future seam consumer genuinely produces null.

**[MINOR — process observation] No `MRQ-38 plan` commit exists on any ref**
The plan's handoff sequence step 1 requires the first branch commit to be exactly `MRQ-38 plan`, pushed before any source change. `git log --all --grep "MRQ-38 plan"` finds nothing; the branch starts at `09eea68 MRQ-38 adopt comms seam`. The plan content evidently exists (it is in the Lattice artifacts), but the prescribed commit is absent — worth one line of explanation in the completion comment so the audit trail doesn't look silently skipped.

## 4. Positive Observations

- **The render-once boundary is real, and the branch fixed a latent bug while holding it.** The old `insertOutbox` condition sent ad-hoc subject+body sends down the *template* branch, producing mismatched output (template-rendered HTML beside raw ad-hoc text). The rewritten three-way branch (`renderAdHocMail` for subject+body, template render only when nothing is supplied, pre-rendered pass-through otherwise) is correct, and I verified every existing call site (`auth-mail.ts`, `calendar/invites.ts`, `public-form.routes.ts`, triggers) lands in the intended branch. The `renderMail` reordering (merge before markdown conversion) keeps merged values inside the single escape path — user-supplied feedback and decline notes are HTML-escaped by `markdownToHtml`.
- **One writer, one normalizer.** `normalizeDecisionFeedback` (CRLF→LF, trim, empty→null) is applied identically in `writeSubmissionDecision` and `writeBulkSubmissionDecisions`, both feeding the same private `insertDecisions` and the same `enqueueDecisionMail` — the AC-235 headline assertion (bulk-accept 3 → 3 decision rows, 3 outbox rows, 3 portals reading their own row IDs) is tested end-to-end without a test-local renderer, exactly as the Cycle-1 resolution demanded.
- **Strict write predicate done right.** The participation update binds `id + person_id + confirmation_status='pending'` and verifies `meta.changes === 1`, converting lost races into 409s instead of silent overwrites; the same-status repeat is idempotent. The audit row carries role-specific before/after state against the submission.
- **The empty-selection guard survived and is tested** (`submission_ids: []` → `selected: 0`, outbox count unchanged), alongside the one-recipient positive control and duplicate-convergence assertion — precisely the AC-236 proof cases the plan enumerated.
- **Agenda flag computed at the right layer.** `has_declined_participant` inspects the raw participation rows *before* `dedupeParticipants` collapses the display list, so a second declined role behind a display representative still raises the flag — with a test-fixture-visible comment explaining why. The flag renders in a reserved-height placeholder slot mirroring the conflict flag, and the private-only exposure was verified (the public agenda route uses its own query; `SPEAKERS_JSON` with `confirmation_status` feeds only the grants-gated agenda API).
- **Negative tests assert absence, not just status.** The AC-153 cross-speaker attempt asserts 404 *plus* both roles unchanged, then performs the authenticated positive control — the exact evidence contract the plan demanded.
- **Suite discipline held:** full suite 10.7 s against the 30 s budget, both tsconfigs clean, `trace:ac` green with zero uncovered claims, and the claims file owns exactly the five mandated AC IDs.
