# MRQ-197: loop.sh barrier resets the demo before it deploys, so every round is seeded by the previous build's seeder

## What happens

`cmd_barrier` (sequence/auto-eval/loop.sh:225) runs its five steps in this order:

    0/5  lift the deploy freeze
    1/5  POST /api/v1/admin/reset-demo   <-- hits the OLD Worker
    2/5  verify the landing header       <-- verifies the OLD build
    3/5  wrangler deploy github/main     <-- the new code goes live HERE
    4/5  verify by build hash
    5/5  'barrier clear - demo verified clean'

The reset at step 1 and the verification at step 2 both execute against the
deployment that is about to be replaced. The seed data a round is then graded
against was produced by the *previous* round's seeder, running under the
previous round's code.

## Why it is not theoretical

Three seed scripts changed in the 27 commits shipped at the round-9 barrier:

  - seed/agenda.ts
  - seed/accepted-core.ts
  - seed/ugliness.ts

So the live demo went into round 10's staging seeded by the old seeder while
serving new code. The Runner caught it, re-reset by hand afterwards, and
verified the header. Nothing is currently wrong on live because of the manual
repair - this ticket is about the ordering that made the repair necessary.

## The second half: step 5/5 asserts something it did not check

'barrier clear - demo verified clean' is printed after the deploy, but the only
verification of the demo (step 2/5) ran before it. The line is a false
assurance: it claims a property of a build that was not live when the property
was checked. An agent reading that line has been told the post-deploy demo is
clean and it has never been looked at.

## Acceptance criteria

1. The demo reset runs against the build that will actually serve the round.
   Either move reset+verify after the deploy, or reset on both sides of it
   (pre-deploy to clear the measured round's pollution, post-deploy to seed the
   next one under the code that will grade it). State which and why in a comment
   in the script - the ordering is the whole content of this fix.
2. The header verification at step 2/5 runs against the post-deploy build, so
   step 5/5's claim is earned.
3. `--no-deploy` still works: with no deploy in the run, one reset and one
   verification is correct and there must not be a redundant second pass.
4. tests/node/auto-eval-guards.test.mjs (or a sibling) pins the ordering, so a
   future edit that reverts it fails rather than being noticed by a human at a
   barrier.

## Adjacent defect found while reading this function - fix or split, reviewer's call

cmd_guard's halt message (loop.sh:215) tells the operator to recover with:

    git revert / checkout <anchor> && loop.sh barrier --deploy-only

`--deploy-only` is not implemented. cmd_barrier only branches on `--force`
and `--no-deploy`, so `--deploy-only`:
  - does NOT skip the reset (it resets the demo, despite its name), and
  - does NOT bypass the round-in-flight refusal (it is not --force).

This is the rollback instruction, printed at the moment the loop has halted on a
falling score - the worst moment to hand someone a flag that does not do what it
says. Either implement `--deploy-only` or correct the message.
