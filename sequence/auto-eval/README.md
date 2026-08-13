# Autonomous Eval Execution

Runs in the c11 workspace **M: Auto Eval**. Its job is to close the distance
between the current sbek score and 100% while a second lane keeps the product
worth using by a human, and to do it without an operator in the seat.

## The finding this is built around

The gap to 100% is not a discovery problem. From round 3, weight-aware:

| lane | items | recoverable weight | headline if cleared |
|---|---|---|---|
| **convert** — `partial` → pass | 19 | 20.5 | 84.3% → **96.4%** |
| **absence** — `not_found` → pass | 4 | 6.0 | → **100.0%** |
| **coverage** — `cannot_judge` | 5 | (11 excluded) | see the trap below |

Every one of those items is already on disk with the judge's own reasoning for
why it fell short, and the spec carries its `pass_criteria`. That is a finished
ticket written by something that is not us. `mine.mjs` extracts them, ordered by
points recoverable.

So rounds are **not** the engine. The queue is the engine; rounds verify that
conversions landed and catch what moved backward.

## The coverage trap

`cannot_judge` is excluded from the denominator (`src/report.ts` — `pass` 1,
`partial` 0.5, `fail`/`not_found` 0, `cannot_judge` null). An unreached item
therefore costs nothing today and costs *real points* the moment a round reaches
it and finds nothing there.

**Build the capability before the round can reach it.** AIA-03 and AIA-06 are the
live case: unjudged only because no placement affordance was drivable. Let a
round reach them first and coverage repair shows up as a regression the loop
caused by improving itself.

## Structure

The spine is a **verb toolbox**, not a daemon. Shell owns mechanism and guards;
agents own judgement. A coordinator that dies mid-run is replaceable because
every verb reads and writes files rather than the coordinator's context.

```
loop.sh status            one screen: round, sha under test, judgements landed, lanes
loop.sh sync              rsync the live run dir back from Atlas
loop.sh watch             block; emit a line each time an area judgement lands
loop.sh mine [--baseline] weight-ordered work queue from the newest run
loop.sh guard             score-floor + rollback-anchor check — the safety property
loop.sh barrier           THE mutation window: reset → verify → deploy → verify
loop.sh fire <sha>        kick the next round on Atlas against a known sha
```

| role | count | life | owns |
|---|---|---|---|
| coordinator | 1 | whole run | round clock, ticket minting (single-writer), calls the verbs |
| merge warden | 1 | whole run | the gate, serialized; the only thing that touches `main` |
| area analyst | 6/round | ~10 min | item-level diff + (a)/(b)/(c) classification for one area |
| implementer | K | ~40 min | one ticket, own worktree, PR |
| craft critic | 1 | whole run | the axis sbek cannot see — `DESIGN.md`, `PHILOSOPHY.md` |

## Rules that are not negotiable

- **Deploy only at the barrier.** Merging is continuous; deploying is not. A round
  whose areas were measured against three builds cannot be diffed against the
  next one, and attribution is the loop's entire value.
- **Migrations stay gated on the operator.** A bad merge costs a `git revert`. A
  migration applied to the live D1 does not come back that way.
- **One gate at a time.** Same branch, three runs on 2026-08-12: load 14 → 78s,
  load 48 → 135s, load 164 → 276s against a 120s budget. Under fleet load the
  gate false-fails and the warden will believe it. Lockfile, no exceptions.
- **Deadline barrier, not completion barrier.** Never wait on "all tickets done" —
  one stuck implementer ends the run. At T+window, deploy what merged and fire.
  Unfinished tickets roll forward.
- **Do not ticket judge variance on one sighting.** An item that moves backward
  with no matching code change, whose evidence shows the control was never
  exercised, is a watch item. It becomes a ticket if the next round repeats it.

## Triage taxonomy (the analyst's contract)

Every backward move is exactly one of these, and only the first is an emergency:

- **(a) code regression** from a fix that landed → ticket now, top of queue
- **(b) state-dependent surface the run's own actions hid** — the round drove
  reviewers to completion, so the Remind button wasn't rendered, so the judge
  honestly recorded not-found. Not a removal, but usually a *real* product flaw:
  a capability that vanishes when inapplicable is undiscoverable. Ticket at
  normal priority; the fix is generally "render it disabled, with the count."
- **(c) judge strictness or evidence thinness** on unchanged behaviour → watch
  item, not a ticket, until it recurs.

Item-level always. Aggregate counts hide compensating moves in both directions,
and "the area regressed" is exactly the claim that must not be wrong.

## The demo the humans see

The eval fills the live demo with DevFlow Conf fixtures for the length of every
round, and `marquee.stage11.dev` is the URL a judge opens. A second Worker would
isolate this properly but is not an hour of work — `wrangler.jsonc` carries four
queues, D1, KV, R2 and two custom domains, and every one needs provisioning and
eight secrets re-set. That competes directly with the queue above, which is the
actual path to 100%.

Mitigation instead of isolation: `barrier` resets and verifies the demo header
reads "AI Engineer New York 2026" at every round end, and the loop's last act is
a reset it proves. Exposure is bounded to a round in flight.
