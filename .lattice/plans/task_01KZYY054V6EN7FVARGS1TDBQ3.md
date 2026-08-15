# MRQ-189: Commit the round 9 and round 10 mission files, and make the silent fallback visible

Routed by the merge captain from the Eval Runner. **Verified before minting** — this is not
relayed.

## What is missing

`sequence/auto-eval/atlas/MISSION-round9.md` and `MISSION-round10.md` are **untracked**. Confirmed
with a control, so the empty result is evidence rather than a search artifact:

```
$ git status --porcelain sequence/auto-eval/atlas/
?? sequence/auto-eval/atlas/MISSION-round10.md
?? sequence/auto-eval/atlas/MISSION-round9.md

$ git ls-files sequence/auto-eval/atlas/          # control: the command CAN see tracked files here
sequence/auto-eval/atlas/kickoff-round.sh
```

Both files exist on Atlas, so nothing is at risk right now. The repo is the durable record and it
does not have them.

## Why this is more than tidiness

`kickoff-round.sh:33-35`:

```sh
mission="$KIT/MISSION-round${round}.md"
[[ -r "$mission" ]] || mission="$KIT/MISSION-round4.md"
[[ -r "$mission" ]] || { print -u2 "no mission file for round $round"; exit 1 }
```

**A missing mission file does not error. It silently substitutes round 4's** — which compares
against round 3's numbers and chases coverage gaps round 4 already closed. The `exit 1` on line 35
only fires if *round 4's* mission is also unreadable, so the fallback swallows the ordinary case
and reports nothing.

That is exactly the failure shape this project has been finding all night in its own code: **the
absent thing does not announce itself, it quietly substitutes a stale answer and the run grades
against the wrong baseline.** It is also why round 9 needed `MISSION-round9.md` authored before
firing — the fallback would have graded it against the wrong round without complaint.

Keep that reasoning in the ticket. Trimming this to "commit two files" loses the only part that
tells the next person why it matters.

## What to do

1. Commit both mission files. Two files, no code, no seam.
2. **Consider making the fallback loud** rather than silent — print which mission was chosen and
   why, or refuse a fallback when the requested round's file is absent. `kickoff-round.sh:36`
   already prints `mission: ${mission:t}`, so the information exists at run time; what is missing
   is that a *substituted* mission looks identical to a *requested* one in that line. If you touch
   this, make those two states print differently. If you would rather keep the change to two
   files, say so on the ticket and leave the fallback alone — that is a defensible call and better
   than a half-made one.

`MISSION-round10.md` already carries the CFP-17/18 turn-budget cap, which is the highest-leverage
item on the round-10 board and needs no diff to land.

## Constraints

- `sequence/auto-eval/**` is the Eval Runner's lane; coordinate before pushing if that branch is
  in flight.
- Cut your worktree from `github/main`, never local `main`, which is parked and stale.
- Push when the work is written, before the verification run.
- Gate through `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/.gate-lock/gate-lock.sh`.
- No migration. Do not deploy.
