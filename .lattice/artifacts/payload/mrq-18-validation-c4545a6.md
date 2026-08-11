# MRQ-18 validation (exact pushed head)

Validated commit: c4545a63db46c77c8bf5d5a77fa29618d01a786e
Base: forgejo/master @ b50f067cbbec296164c9c895b374647110efc516
Branch: mrq-18-reviewer-queue (pushed; remote updated with --force-with-lease)
Verdict: PASS

## Static and hermetic evidence

- `npm ci`: PASS after the plain rebase.
- `npm run pr-gate -- --ticket MRQ-18`: PASS, 14.693s.
- Worker, client, and test TypeScript checks: PASS.
- Production build: PASS.
- Design contract: PASS.
- Hermetic suite: PASS, 31 test files / 169 tests.
- Merged AC trace: PASS, 19 claims, 0 uncovered, 0 errors.
- `git diff --check forgejo/master...HEAD`: PASS.
- `git merge-base --is-ancestor forgejo/master HEAD`: PASS.

## Rebase verification

- The plain rebase onto MRQ-20's `f8e824d` resolved the `AppShell.tsx` conflict by retaining both `AgendaPage` at `/agenda-builder` and `ReviewerPage` at `/reviewer`.
- The later plain rebase onto the current Forgejo master `b50f067` completed cleanly; the gate was rerun afterward.

## Scope checks

- Reviewer routes remain centralized in `src/routes/review.routes.ts` and use `authorizeReviewerScope`.
- Blind detail, generic out-of-scope 403, CSV export isolation, nullable recommendation scoring, and queue-position preservation remain covered by the MRQ-18 implementation and tests.
- No merge performed; PR #26 remains open for Orchestrator merge.
