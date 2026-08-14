# MRQ-181 implementation plan

## Context

- Repository root: `/Users/atin/Projects/Stage11/deployments/Marquee`
- Implementation worktree: `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-mrq-181`
- Branch: `mrq-mrq-181`, rebased onto `github/main` with fixture-session fix `a04f80b1`
- Lattice task: `MRQ-181` / `task_01KZYSA00F0EMJSA7NGDZZDN1E`
- Role: implementer; actor: `agent:codex-cli`

## Scope

Trace the `/api/v1/auth/exchange` magic-link flow and every single-use-token consumer named by the ticket. Fix the existing-session refusal so it does not consume a usable credential, reports the actual cause distinctly from expiry and reuse, and presents a recovery path. Add regression coverage proving all three causes and retrying the preserved fresh link after sign-out.

## Non-goals and constraints

- No database migration; stop and flag the ticket if the existing schema cannot support the fix.
- No deployment and no merge; the merge warden owns `main`.
- Do not alter unrelated authentication behavior or invent a parallel token path.
- Preserve the Flight Deck language and the no-layout-jump rule for any changed screen.

## Artifacts to read

- `MRQ-181` ticket and event history via `lattice show MRQ-181 --json`
- `CLAUDE.md`, `DESIGN.md`, `PHILOSOPHY.md`, and `sequence/run-state.md`
- Auth exchange/session/token routes, shared auth helpers, sign-in UI, and existing auth integration/unit tests

## Work and verification

1. Establish a corrected-history baseline and inspect the auth exchange call graph and token consumers.
2. Reproduce the existing-session failure against the current code; identify exactly where session conflict is checked relative to token consumption and how the redirect reason/copy is selected.
3. Implement the smallest shared fix that preserves the fresh token, distinguishes `already signed in`, `expired`, and `reused`, and exposes sign-out/continue recovery without shifting layout.
4. Add a regression test that fails on rebased `github/main` and passes on this branch, covering all three causes and the preserved-token retry.
5. Run scoped tests, then the serialized full suite and `pr-gate`; inspect load on any timing-only failure. Run applicable live Worker/browser validation and record evidence.
6. Commit, push, open the GitHub PR, comment on MRQ-181 with root cause, exact verification, and PR number, then set the ticket to `pr_open` for the coordinator/merge warden.

## Expected outcome

One focused implementation commit (plus regression coverage), a pushed branch and open PR, with Lattice status `pr_open`; no migration, deploy, or merge performed.
