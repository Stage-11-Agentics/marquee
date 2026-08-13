# Plan Review: MRQ-116 — Comments on deliverables

### 1. Verdict

**PASS** — Plan is complete, feasible, and aligned. Implementation can proceed, with one factual correction (the recorded base sha, Issue 1) that must be applied before running the plan's rebase command.

### 2. Summary

Reviewed the MRQ-116 plan against the ticket description, spec section T-F2 (`sequence/eval-response-tickets.md:231`), the T-F1 parent spec, boot `COMMON.md`, and the live repository state (branches, worktrees, migrations, schema, routes, and `pr-gate.mjs`). The plan is strong: it internalizes both failure traps the ticket calls out (slot-anchored threads, nullable `attachment_id` as metadata), matches the spec's schema verbatim, respects every collision boundary with T-F1/T-F3, and its verification section encodes the fleet's actual test/gate discipline. The one real defect found is that the recorded 40-character base sha does not exist in the repository — the abbreviation matches `github/main`'s tip but the tail is wrong, so the plan's exact rebase command would fail.

### 3. Issues

**[MAJOR] Contract and base — recorded base sha is not a real object**
The plan records the base as `github/main @ 23a06b040fd76678a135b27ed401a7ea70ea0754` and bakes that sha into its rebase command. The actual tip of `github/main` is `23a06b0b28473edbd9d5feeea1a8d5ae32dc1a80` — only the first seven characters match, and `git cat-file` on the plan's sha returns "bad object." The branch itself is fine (`mrq-116-file-comments` sits one plan commit above the real `23a06b0b` tip), and the failure mode is loud rather than silent, but a recorded contract value that cannot be resolved will stall the implementer at exactly the moment the stacked-rebase choreography is most delicate.
**Recommendation:** Correct the recorded sha to `23a06b0b28473edbd9d5feeea1a8d5ae32dc1a80`, and phrase the rebase upstream as `$(git merge-base mrq-116-file-comments github/main)` (or the branch's parent commit) rather than a hand-transcribed 40-character literal, so the command survives transcription errors.

**[MINOR] Contract and base — no contingency if MRQ-115 never materializes in this window**
`github/mrq-115-files-library` still does not exist, and the local parent branch has zero commits (it is parked at the `github/main` tip). The plan correctly defers step 5 (organizer library mount) until after rebasing onto the parent, but does not say what the implementer should do if steps 1–4 are complete and the parent ref still hasn't appeared: block indefinitely, or open the PR with the speaker side complete and the organizer mount pending.
**Recommendation:** Add one sentence: if the parent ref is still absent when steps 1–4 are validated, open the PR against `github/main` with the speaker-side thread complete, note the organizer mount as pending the parent, and flag it in the completion comment rather than idling.

**[MINOR] Scope step 1 — migration number `0009` is correct today but claimed unilaterally in a concurrent wave**
`github/main` already carries `0008_form_field_dates.sql`, so `0009` is the right next number and no sibling branch currently claims it (verified across the wave-2 worktrees). But several wave-2 tickets are building concurrently, and nothing reserves the number.
**Recommendation:** At rebase/PR time, re-check `migrations/` on the rebased base and renumber if `0009` has been taken; treat the number as assigned-at-merge, not assigned-at-plan.

**[MINOR] Scope step 2 — "role" derivation is underspecified for the speaker side**
The ticket demands author name AND role on every comment, and the eval scenario has both a speaker comment and an organizer reply in one thread. The plan says reads "join the author person and the event membership needed to render a human name and role," but speakers generally aren't event members — a membership join alone yields no role for the speaker-authored rows. The data to derive it exists (memberships carry `MembershipRole` for organizers; the slot's `speaker_tasks.person_id` identifies the speaker), but the plan doesn't say which source produces which label.
**Recommendation:** Specify the derivation: organizer authors render their membership role; the slot owner renders as "Speaker" (or their participation role); assert both labels in the v1-comment → v2-upload → organizer-reply test.

### 4. Positive Observations

- **The two failure traps are load-bearing in the design, not recited.** Slot anchoring (`owner_type` + `owner_id`) governs storage, the helper's reads, both route surfaces, and the tests; `attachment_id` is consistently nullable metadata rendered as a chip. The adversarial CNT-S3 sequence (comment on v1 → upload v2 → organizer replies in the same thread) appears as an explicit test, which is exactly the check that catches attachment-anchored orphaning.
- **Every named artifact is real.** `src/ui/shell/route-table.ts`, `uploads.routes.ts`, `src/lib/reset-demo/`, the `*.routes.ts` + generated-manifest pattern, and `pr-gate.mjs`'s required `--ticket MRQ-N` flag all check out against the repo — the plan was written against the actual codebase, not an imagined one.
- **Collision boundaries are precise.** No versions table, no `is_latest` storage, no ZIP, no per-session Files tab, `uploads.routes.ts` stays T-F1-owned, and rebase-conflict expectations name the two files where conflicts will actually land. "Build no mail" is stated in both scope and non-goals, matching the rubric's explicit excusal.
- **The stacked-ticket choreography follows COMMON.md faithfully** — plan committed and pushed first (verified: the branch tip is the plan commit), the `--onto` form for both the pre-merge and post-squash-merge cases, `npm ci` after rebase, `--force-with-lease` semantics via the boot doc, and the exact PR-body anchor line.
- **Verification respects fleet discipline:** targeted tests only during development, load check before the gate, exact `pr-gate` output pasted into the completion comment, running-system validation on both surfaces, and a refusal test with a no-side-effect assertion plus a positive control — a genuinely good test-design instinct.
