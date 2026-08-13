# MRQ-165 implementation plan

Repository: `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-165-import-roster`
Actor: `agent:luna-mrq-165`

## Scope

Repair the Sessionize speakers import so every imported speaker is bridged into the event's `memberships(role = 'speaker')` population, preserving the existing idempotent bridge. Extend import snapshots and undo so only memberships absent before this import are removed. Add route-level coverage for roster visibility, portal reachability, repeat-import idempotency, and exact undo behavior. This branch is code + tests only; the ABS-14 notes paragraph is owned by a separate docs PR.

## Implementation steps

1. Baseline the focused Sessionize import tests and inspect the existing snapshot/undo contract; install dependencies if the clean worktree does not have them.
2. Update `src/lib/sessionize-import.ts` to read the pre-import speaker membership, call `speakerMembershipStatement` after speaker reconciliation for created, updated, and unchanged matched rows, persist the membership snapshot marker, and delete only an import-created membership before person cleanup during undo. Preserve legacy snapshots that predate the marker.
3. Extend the existing Sessionize import integration coverage to prove the speakers-only roster path, exact undo with a pre-existing membership control, repeat-import uniqueness/outcomes, and an authenticated imported-speaker portal read.
4. Run focused tests, full `npm test`, type/build/contract checks through `npm run pr-gate -- --ticket MRQ-165`, and inspect the diff.
5. Run the required local Worker API flow on a free port with local migrations and seed: organizer demo auth, fixture upload/mapping/run, roster search for Dana Kowalski, then undo and membership verification. Attach observed evidence with a validation-role Lattice comment.
6. Reconcile PR #174 before opening: it is currently open, so leave `sequence/submission/LIMITATIONS.md` alone and state the coupling in the PR body. Rebase onto fetched `github/main` (currently `f9630de0`, after this branch's base `f03ed217`). If #174 merges before PR creation, remove or rewrite its SPK-03 limitation entry during the rebase.
7. Commit meaningful checkpoints, push the branch to `github`, open the GitHub PR against `main`, report the PR number on MRQ-165, and stop at `pr_open` without merge or deploy.

## Non-goals

No docs changes to `SUBMISSION-NOTES.md` or `LIMITATIONS.md` while PR #174 is open, no live-site changes, deploys, demo reset, unrelated round-4 findings, schema redesign, or changes to the primary checkout.

## Verification evidence required

- Focused and full test results, including the pre-fix failing assertion where captured.
- `npm run pr-gate -- --ticket MRQ-165` result.
- Running local Worker API evidence showing roster inclusion and undo membership removal.
- GitHub PR URL/number and final Lattice status `pr_open`; PR body must state the open #174 same-bug coupling unless that PR merges first and its limitation is retired here.
