# MRQ-187 implementation plan

## Scope

- Root-cause the current `check:seed` elapsed-time status and exit-code path.
- Separate the 30-second objective from a genuine hang detector, following the
  existing `run-test.mjs` pattern: over-budget healthy runs warn and pass;
  only the hard limit fails.
- Preserve a meaningful speed-history verdict for `recordSpeedHarness`.
- Document the intentional strictness of `check:speed` for local contention and
  CI in its script header without changing that behavior silently.
- Add regression coverage for an over-budget seed run and a hard-limit hang.

## Non-goals

- No schema or migration work.
- No deploy.
- No changes to product/UI behavior or the speed measurements themselves.

## Verification

- Establish the rebased baseline with the project test runner through the shared
  gate lock, and inspect any red by its status computation and error class.
- Run focused Vitest coverage for the new status/exit-code contract.
- Run `npm test` and `npm run pr-gate -- --ticket MRQ-187` through
  `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/.gate-lock/gate-lock.sh`.
- Inspect the final diff and verify the pass criteria again before committing,
  pushing, opening one PR, and recording the ticket evidence.
