# MRQ-188: cmd_mine void-checks the baseline but not the run it mines

Routed by the merge captain from the Eval Runner, which correctly declined to mint it —
`lattice create` has an unlocked read-decide-write window and concurrent calls corrupt the ID
counter, so minting is single-writer. **I verified every claim below in source before writing
this; nothing here is relayed.**

## The defect

`sequence/auto-eval/loop.sh`, `cmd_mine`:

```sh
stamp=$(jget runStamp)                     # NEVER void-checked
[[ $(is_void "$2") == yes ]] && die ...    # only the --baseline argument
```

The guard exists, is correct, and **is on the wrong argument.** #209 did not close it.

## Why it bites — three defects stacked

1. **38 copies of `loop.sh` across the worktrees**, each with its own `STATE_DIR`
   (`$SELF_DIR/run`), so each carries its own `run/state.json`.
2. **Two of them are populated, and they disagree.** Verified directly:

   ```
   Marquee-worktrees/auto-eval/sequence/auto-eval/run/state.json      runStamp = 2026-08-13T22-25-26
   Marquee-worktrees/mrq-auto-eval/sequence/auto-eval/run/state.json  runStamp = 2026-08-13T21-33-54
   ```

   The second is a **void** run that died at CFP-S4.
3. **The `VOID-` rename was applied on Atlas only.** Locally the directory is still
   `runs/2026-08-13T21-33-54`, unprefixed — so the path looks normal too, and the one cue that
   would make a reader suspicious is absent on the machine where the mistake happens.

**Net:** a pathless `loop.sh mine --baseline 2026-08-12T23-50-16` run from the wrong copy passes
the baseline guard cleanly and then mines a void round as the current one — producing a work
queue of regressions from a run that was stopped short. Nothing at any layer says stop.

This is the night's characteristic shape at the tooling layer: **a guard that fires, reads as
protection, and protects the wrong thing.**

## Fix

- `is_void` on `$stamp`, with the same refusal message as the baseline check.
- Rename the local void directories to match Atlas, so the marker exists in both places rather
  than one. A marker that only exists on the machine where the mistake cannot be made is not a
  marker.
- **Print `runStamp` in `mine`'s output.** The Runner caught this by knowing to look; the queue
  should carry its own provenance so the next reader catches it without knowing. That half is
  what turns a fix into a guard.

## Test — the part worth insisting on

**Cover pathless-from-the-wrong-copy, not the clean case.** The failure only appears when the
invoked copy's `state.json` disagrees with the caller's intent, which a well-behaved fixture will
not reproduce by accident — a test that sets up a valid run and a void baseline passes today and
proves nothing.

Shape it like `tests/node/auto-eval-guards.test.mjs`: point `STATE_DIR` at a `state.json` whose
`runStamp` is in its own `voidRuns`, run `mine`, assert it **refuses**. Red on today's main, green
on the fix. And pair it — assert that a valid `runStamp` still mines successfully in the same
test file, so "refuses everything" cannot pass for "refuses void runs".

## Priority

**Not urgent.** Nothing runs `mine` before round 10 and the live exposure is already closed —
every mine run tonight read `runs/2026-08-13T22-25-26`, which I confirmed from the `run` field
inside each saved output rather than from where I believed I was standing.

## Constraints

- `sequence/auto-eval/**` belongs to the Eval Runner's lane; coordinate before pushing if that
  branch is in flight.
- Your **own linked worktree**, cut from `github/main` (never local `main`, which is parked and
  stale). Verify: `if git fetch github; then if git merge-base --is-ancestor github/main HEAD; then echo current; else echo behind; fi; else echo 'FETCH FAILED -- not attempted'; fi`
- **Never `git stash` anywhere in this repo** — the stash stack is shared across every worktree.
- **Push when the work is written, before the verification run.** A green gate on unpushed work is
  worth nothing to a successor; the verification can be re-run by anyone, the work cannot be
  reconstructed.
- Gate through `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/.gate-lock/gate-lock.sh`.
- Test titles start with `CONTRACT` or `AC-<n>`, then a middle dot.
- No migration. Do not deploy.
