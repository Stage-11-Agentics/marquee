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
agents own judgement. A surface that dies mid-run is replaceable because every
verb reads and writes files rather than that surface's context.

```
loop.sh status            one screen: round, sha under test, judgements landed, lanes
loop.sh sync              rsync the live run dir back from Atlas
loop.sh watch             block; emit a line each time an area judgement lands
loop.sh mine [--baseline] weight-ordered work queue from the newest run
loop.sh guard             score-floor + rollback-anchor check — the safety property
loop.sh barrier           THE mutation window: reset → verify → deploy → verify
loop.sh fire <sha>        kick the next round on Atlas against a known sha
```

Two surfaces stand for the whole run; everything else is created per unit of work
and closed when that unit lands.

| role | count | life | owns | prompt |
|---|---|---|---|---|
| **Eval Runner** | 1 | whole run | the only surface that talks to Atlas: round clock, the verbs, the freeze, the barrier, the score floor. Writes no code, mints no tickets, dispatches nobody. | `prompts/runner.md` |
| **Eval Triage** | 1 | whole run | findings in, merged PRs out: item-level diff, (a)/(b)/(c) classification, ticket minting (single-writer), dispatch, and the merge | `prompts/triage.md` |
| reviewer | 1/PR | ~15 min | reads a diff its author did not write, and reproduces the symptom rather than the cause | `prompts/reviewer.md` |
| implementer | K | ~40 min | one ticket, own worktree, one PR | `prompts/implementer.md` |

The interface between the two standing surfaces is one line: every `JUDGEMENT`
the Runner's `watch` emits, it hands to Triage with the area and the run
directory, uninterpreted. Nothing else crosses.

**Merging belongs to Triage, and Triage may not merge unreviewed.** `CLAUDE.md`
is the binding rule — *reviewed* means someone other than the author read the
diff, and neither a green gate nor Triage's own confidence is a review. Since
Triage dispatched the implementer and wrote the ticket, it is not a disinterested
reader of the result either. So Triage dispatches a reviewer per PR and merges on
that verdict.

A reviewer is a **separate surface, not a subagent of Triage** (operator ruling,
2026-08-14). A subagent shares Triage's context and inherits its framing of the
defect, which is exactly what the review has to be independent of: on #221 the
author tested the cause it had fixed and the reviewer reproduced the symptom, and
only the second test would have caught a stall standing behind a 404. It also
protects the scarcest resource in the loop, which is Triage's own context window.
Doc-only PRs may use a subagent.

## Rules that are not negotiable

- **Deploy only at the barrier.** Merging is continuous; deploying is not. A round
  whose areas were measured against three builds cannot be diffed against the
  next one, and attribution is the loop's entire value.
- **`fire` declares the deploy freeze; `barrier` is the only thing that lifts it.**
  The marker (`.deploy-freeze` in the primary checkout) makes the rule above
  binding on the *whole fleet* rather than just this loop — without it, a sibling
  agent reading `check:deploy` sees `stale`, ships the drift, and destroys the
  measurement while following DEPLOY.md correctly.
- **Migrations stay gated on the operator.** A bad merge costs a `git revert`. A
  migration applied to the live D1 does not come back that way.
- **One gate at a time — and a red still means a red.** Same branch, three runs
  on 2026-08-12: load 14 → 78s, load 48 → 135s, load 164 → 276s against a 120s
  budget. Serialize gates through the shared lock at
  `Marquee-worktrees/.gate-lock/gate-lock.sh`, so those numbers stay meaningful.
  **Slowness does not fail anything**, so serialize for honest measurements, not
  to prevent false reds — `run-test.mjs` and `pr-gate.mjs` both report an
  over-budget run as `pass-over-budget`, a loud warn, and `process.exitCode` is
  set from the test outcome. Only `HARD_LIMIT_MS` (600s, a hang detector) turns
  slowness into a failure. That 276s run was a warn.
  Read the `status` field rather than guessing at load:
  `fail` is load-invariant — **believe it**; `pass-over-budget` is a warn;
  `timeout` is unknown, so re-run. And read it per script: `check:seed` and
  `check:speed` derive status from wall clock and *can* red on contention alone,
  where every other check derives status from findings and cannot.
  Never dismiss failing tests as a known baseline without naming the commit that
  made them pass.
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
