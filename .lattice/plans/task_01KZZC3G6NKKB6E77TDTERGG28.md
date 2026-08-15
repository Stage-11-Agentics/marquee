# MRQ-198: loop.sh status never says whether its own copy is behind github/main

## What is missing

`cmd_status` (sequence/auto-eval/loop.sh:115) reports round, live sha, anchor,
run stamp with its void marker, the Atlas job, and the last four PROGRESS lines.
Every one of those is about the *remote* state of the loop. Nothing reports the
state of the checkout the operator is reading the loop out of.

## Why that costs something

These files - loop.sh, the prompt files under sequence/auto-eval/prompts/, the
mission files - are the loop's instructions to itself. A stale copy does not
fail; it confidently issues last week's orders. Last night a stale copy handed a
dispatch prompt that said `main` where it should have said `github/main`,
which is precisely the base-selection error CLAUDE.md devotes a section to:
the primary checkout is parked by design, so its `main` pointer is untrustworthy,
and a worktree cut from it inherits whatever it was missing.

`status` is the one command every agent runs first. It is the right place to
answer 'are these instructions current?' because it is the only place anyone
looks before acting on them.

## Acceptance criteria

1. `loop.sh status` prints one line reporting whether the working copy is
   current with `github/main`, ahead, or behind, with the count.
2. It distinguishes three states, not two - CLAUDE.md is explicit that a failed
   fetch does not make the comparison fail, it makes it answer confidently about
   a stale remote-tracking ref. 'behind' and 'my fetch died' must not print the
   same string:

       fetch ok + ancestor        -> current
       fetch ok + not ancestor    -> behind github/main by N - rebase
       fetch failed               -> FETCH FAILED - comparison not attempted

3. No `-q` on the fetch. It does not suppress the ref-lock error; it removes
   the ordinary output that makes anyone notice the fetch ran at all.
4. A lost ref lock is not a failure to report as one. Every worktree here shares
   one .git, so a concurrent fetch loses `refs/remotes/github/main`; the
   remedy is to re-run, and a sibling that won the lock already wrote the same
   remote truth. Do not print FETCH FAILED for a race that in fact left the ref
   correct - check the ref before concluding.
5. status must not become slow. It is the command everyone runs first; a network
   fetch on every invocation is the thing that will get this line deleted. Keep
   the added cost small, and if that means the fetch is opportunistic, say so in
   the output rather than silently comparing against a stale ref.
6. status must not *mutate* anything to answer this - no rebase, no checkout, no
   stash. Report only.

## Scope note

'Behind' is the normal state on a busy day and is not a defect. The line reports;
it does not scold and it does not halt the loop.
