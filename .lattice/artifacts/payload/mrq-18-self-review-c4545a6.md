# MRQ-18 inline self-review (post-MRQ-20 and current-master rebase)

Reviewed commit: c4545a63db46c77c8bf5d5a77fa29618d01a786e
Base: forgejo/master @ b50f067cbbec296164c9c895b374647110efc516
Verdict: PASS
Review mode: inline self-review; headless code review is suspended by the ticket directive.

Findings: none.

Scope checked:

- `src/routes/review.routes.ts` remains the `*.routes.ts` manifest module; queue, context, detail, files, export, and evaluation-write all use the centralized `authorizeReviewerScope` helper before evaluator-visible reads or writes.
- Blind detail projection excludes identity-bearing form keys in SQL, returns no identity object while anonymized, and exposes only safe file metadata. Out-of-scope failures use the generic 403 body without resource metadata.
- Approve/Maybe/Deny persists nullable score and criteria values, records reviewer actor/time, maps to a decision proposal, and leaves submission lifecycle unchanged.
- The reviewer page uses reviewer-scoped APIs, has no admin shell, preserves queue item/index on detail close, supports keyboard recommendation/score/save interactions, and guards focused controls from the global save handler.
- `AppShell.tsx` retains both route mounts after the plain rebase: `/agenda-builder` renders `AgendaPage`, and `/reviewer` renders `ReviewerPage`.
- Existing evaluation/admin routes and guardrail tests remain intact; the committee event-boundary predicate is tightened without introducing a second authorization path.
- No contract documents, migrations, secrets, or unrelated paths changed.

Evidence at this exact head:

- `npm ci`: PASS after the rebase.
- `npm run pr-gate -- --ticket MRQ-18`: PASS, 14.693s; worker/client/test types, production build, design contract, 31-file hermetic suite (169 tests), and merged AC trace all passed.
- Merged AC trace: 19 claims, 0 uncovered, 0 errors.
- `git diff --check forgejo/master...HEAD`: PASS.
- `git merge-base --is-ancestor forgejo/master HEAD`: PASS.
- Branch `mrq-18-reviewer-queue` was pushed with `--force-with-lease`; Forgejo PR #26 now names this exact head.
