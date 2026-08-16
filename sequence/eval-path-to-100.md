# The path to 100% on sbek

**A complete list of what stands between Marquee and a 100% sbek score, what each
item is worth, and which of them are product work at all.**

Living document. The item table is *derived*, not typed — regenerate it after every
round rather than editing it by hand:

```sh
python3 sequence/auto-eval/weigh.py            # table
python3 sequence/auto-eval/weigh.py --json     # machine-readable
```

`mine.mjs` ranks the same items by flat rubric weight, which is the right lens for
"what should a delegator pick up next". This document uses **area-weighted marginal
headline points**, which is the right lens for "how far are we from 100%" — the
headline is an area-weighted mean of area percentages, so a 2-point item in
ai-agenda (area weight 10) and a 2-point item in call-for-papers (area weight 20)
are worth materially different amounts. Grading rules and area weights:
[`EVAL-KIT.md`](EVAL-KIT.md). How rounds are run: [`../EVAL.md`](../EVAL.md).

**Last refreshed:** round 13 (`runs/2026-08-15T23-25-57`, build `f7fd5beed6fb`) —
**VOID as a headline**, five of seven areas judged before the Claude account on
Atlas hit its weekly limit. Those five graded one build with no drift and are used
here as real measurements. Only **public-widgets** still reads from round 11 (marked
`*`); it has not been measured since its rubric was resynced, so those three rows
are the least trustworthy numbers on this page. See the update log at the bottom.

---

## Is 100% actually reachable?

**Yes for the automated headline**, and the older `CEILING.md` claim of a "~95–96%
ceiling for an automated run against the product as designed" no longer holds. Two
things were checked directly rather than assumed:

- **Only 2 of the 86 required items are `manual`-testability** — CFP-08 (a
  confirmation email reaching the submitter) and SPK-16 (automated task-reminder
  emails), weight 1 each. `scoreArea` pushes manual items to `pendingManual` and
  never adds them to `judgeable`, so they are **excluded from the denominator, not
  scored zero**. They cannot hold the automated headline below 100%.
- **`auto-partial` is not a cap.** The judge does award `pass` to auto-partial items:
  CFP-14, ABS-07, ABS-09, ABS-13, SPK-07, SPK-13 and ABS-14 have all passed.

**A *finalized* 100% additionally needs a human** to verify CFP-08 and SPK-16 as
`pass` in `manual-results.json` — that is real mail arriving in a real inbox, which
is deliverability (SPF/DKIM/DMARC alignment on the sending domain), not product
code. Round 11's ledger already recorded spam placement as an open infrastructure
question. Until that is settled, treat **automated 100%** as the target and the
finalized number as gated on an operator errand.

---

## The one thing to understand before planning any of it

**Most of the distance was never product work — and this is now proved rather than
argued.** Round 13 changed no application code (`src/` and `migrations/` byte-identical
to round 12) and converted **ten items to `pass` with zero regressions**, purely by
instructing the browsing agent to finish flows it had been stopping one action short
of. That is **5.2 points recovered from an editing session on a mission file.**

| lane | points | what it costs |
|---|---:|---|
| **Run reach** — mission instructions and turn budget | **1.81** | more of the same; two of the four are unmeasured |
| **Product stories** — one live, one ruling, one unknown | **2.94** | one real ticket, one decision, one to confirm |
| **Total** | **4.75** | → 100% automated |

Keeping these lanes separate is the whole discipline. A round that scores lower
because the agent ran out of turns is not a product regression, and a story written
from that misreading is waste. The corollary now has evidence behind it: **the
cheapest points on this board are written in the mission file, not in `src/`** — and
they are lost again the moment the instruction is dropped, which is exactly what
happened to CFP-17/18 between rounds 10 and 12.

### Where the five judged areas stand

| Area | round 13 | round 12 | round 11 (finalized) |
|---|---|---|---|
| call-for-papers | **93.2%** cov 97% | 87.8% cov 97% | 82.9% cov 92% |
| abstract-management | **100%** cov 100% | 91.1% cov 100% | 88.9% cov 96% |
| speaker-management | **96.9%** cov 97% | 93.3% cov 91% | 95.3% cov 97% |
| content-management | **91.9%** cov 100% | — | 85.5% cov 100% |
| ai-agenda | **100%** cov 100% | — | 94.4% cov 100% |
| public-widgets | *not measured* | *not measured* | 91.4% cov 100% |

Area-weighted across the five that ran, round 13 reads **96.2%**. Do not quote that
as a headline: public-widgets carries 20 of the 100 area weight, is the one area
whose rubric got materially harder, and has not been measured since. A full round
will very likely land below it.

---

## Lane 1 — Product stories (2.94 points)

Ranked by points. Each carries the judge's own evidence, because the judge's wording
is what has to change for the item to convert.

### Story 1 — The submitter's own home · CFP-05 + CFP-13 · **1.35 pts** · the only large one left

> *As someone who submitted proposals, I can open one page that lists every proposal
> I have sent this conference and its current status, without creating a password.*

The largest single item on the board, the only weight-3 product gap, and a
**recurring** finding across rounds 11, 12 and 13 rather than judge variance — filed
as a `major` defect each time, and unmoved by round 13's instruction sweep, which is
exactly what distinguishes it from the run-reach lane.

Today a public submission is anonymous and the only handle is one private token link
*per abstract*. The judge:

> *"What is missing is the submitter's own dashboard: a public submitter has no
> account and no page listing their proposals with a status label — only one private
> token link per abstract. `/portal` is a different surface bound to a seeded demo
> speaker, not reachable as the submitting identity."*

CFP-13 falls out of the same story for free — decisions already reach the submitter
in unambiguous wording on the private link (*"Your abstract was accepted"*), they
simply do not arrive on a dashboard.

The pieces exist: magic-link auth ships, `people` rows are org-scoped, and the portal
already renders a task-and-status surface. This is assembly rather than invention.
Note the related `minor` defect filed alongside it — the speaker portal binds to a
fixed seeded identity rather than to the person who submitted, which is the
submitter/speaker split `SPEC.md` §10 already names as a known limitation. Story 1 is
the honest resolution of that limitation.

### Story 3 — Public speaker attribution · EMB-16 · **0.86 pts** · *unverified, do not ticket yet*

A session created during round 11 printed **"Speaker to be announced"** on the public
agenda and carried an empty `speakers[]` in the public JSON feed, while the
organizer's own record named a speaker. The public surface understating the program
is a real bug independent of any rubric.

**Hold:** `6a247826 fix: attribute builder sessions to speakers (#262)` landed after
round 11's build, and **public-widgets has not been judged since**. This may already
be closed. It needs one completed round before anyone writes a ticket.

### Story 2 — An explicit content-approval state · CNT-12 · **0.73 pts** · *needs a ruling first*

Marquee gates publication on **scheduling** — every record reads *"Not yet public —
Needs a room and time before it can go public"*. The rubric expects a content
approval/review status the organizer sets, with unapproved content excluded from
public output. Round 13 reached the item properly and recorded the divergence
explicitly (*"approval-gate finding recorded"*), so this is now a confirmed design
difference rather than thin evidence.

It is only a story if the answer is "adopt an explicit approval state". The
alternative is a deliberate 0.73 declined on the grounds that scheduling-as-gate is
the better product. **That is an operator ruling, and nobody should build it until
it is made.**

### Closed by round 13

- **CNT-09 — save reliability.** Round 11 read *"succeeded on the second attempt"*;
  round 13 passed it outright. 84 commits separate those builds, so this may have
  been fixed by one of them or may have been a flake — it cannot be attributed, and
  it does not need to be. Watch for a recurrence rather than chasing it.
- **ABS-14 — agent evaluation.** Passed once the run overrode the *agent's* score
  rather than a human reviewer's. That makes it a run instruction, not the product
  gap it looked like. Keep the instruction in the mission.

---

## Lane 2 — Run reach (1.81 points, no product code)

Four items where the capability is present and the last step was not taken:

| item | pts | what the run did not do |
|---|---:|---|
| EMB-08 | 0.57 | detail view satisfies every field; the Back/close half never evidenced *(unmeasured since round 11)* |
| CNT-10 | 0.48 | organizer-originated bio + headshot save-and-reload skipped, twice now |
| SPK-03 | 0.47 | CSV import opened at last (`cannot_judge` → `partial`), still not carried to the roster |
| EMB-13 | 0.29 | gallery drill-in complete; close/back half not evidenced *(unmeasured since round 11)* |

**Ten of the original fourteen converted in one round**, all by naming the exact
missing action in the mission: create the second conference *and open its empty
list*; create a second differently-scoped reviewer pool; fire Distribute instead of
cancelling it; add a room and a track and use them; actually send the portal invite;
actually click Download; select rows and start the bulk download; override the
agent's score.

The two levers, both now demonstrated:

**Mission instructions that name the exact last step.** Proved in both directions.
Round 10 won CFP-17/18 with an explicit block; round 12 dropped it and lost them the
same night with the capability unchanged; round 13 restored it and won them back.
**These instructions are load-bearing and must survive every mission rewrite.**

**Turn budget.** Raised 70 → 85 for round 13, which is when SPK-03 finally got
opened. CNT-10 has now been skipped twice with the same stated reason — that the
capability was covered in another area's scenarios — so it needs an instruction that
forbids the substitution, not more turns.

---

## The derived table

Regenerate with `python3 sequence/auto-eval/weigh.py`. Rows marked `*` fall back to
an earlier run because the current round has not judged that area — they describe a
build that is no longer deployed.

```
run 2026-08-15T23-25-57  —  4.75 headline points recoverable across 8 non-pass items
  rows marked * fall back to an earlier run (2026-08-14T14-46-26)

  item     area                  verdict       testability    wt   gain
* EMB-16   public-widgets        partial       auto-partial    3   0.86
  CFP-05   call-for-papers       partial       auto            3   0.81
  CNT-12   content-management    partial       auto            3   0.73
* EMB-08   public-widgets        partial       auto            2   0.57
  CFP-13   call-for-papers       partial       auto            2   0.54
  CNT-10   content-management    partial       auto            2   0.48
  SPK-03   speaker-management    partial       auto            2   0.47
* EMB-13   public-widgets        partial       auto            1   0.29
```

**Three of the eight are public-widgets rows nobody has measured on a current
build.** That area is both the heaviest (20) and the only one whose rubric changed,
so the single most valuable thing a next round can do is simply *reach it*.

### Reading `cannot_judge` correctly

`cannot_judge` sits **outside** the denominator, so converting one to `pass` adds the
item to the numerator *and* the denominator. In an area already scoring near its own
average the net movement is small — and in an area scoring below 100% a newly reached
item that turns out to be **weak scores worse than leaving it unreached**. This is
the coverage trap: an unreached item costs nothing today and costs real points the
moment a round arrives and finds nothing there. Build the capability before letting a
round reach it.

---

## Update log

- **2026-08-16, round 13 — VOID as a headline, five areas kept, and the Lane-2
  hypothesis confirmed.** The Claude account driving the eval on Atlas hit its
  **weekly limit** at 16 of 20 scenarios, after five areas were judged. Not a host
  failure — Atlas was healthy throughout, and `built_at` was constant at every area
  boundary.

  **Ten items converted to `pass` with zero regressions, on byte-identical
  application code**: CFP-17, CFP-18, ABS-02, ABS-06, ABS-14, SPK-06, SPK-10,
  CNT-09, CNT-14, AIA-02. SPK-03 moved `cannot_judge`→`partial`. Recoverable fell
  **9.72 → 4.75**. abstract-management and ai-agenda reached **100%**. This is the
  clearest evidence the document has: the run-reach lane was mission text all along.

  The new `RUN-DIED` guard shipped hours earlier caught this death correctly rather
  than announcing completion — its first live outing, on the second consecutive
  round to die.

- **2026-08-15, round 12 — VOID as a headline, three areas kept.** Document created.
  Atlas hung from ~22:55Z and rebooted at 19:07 ET, killing the job at 14 of 20
  scenarios with no `report.json`. **CFP-06, CFP-10, CFP-11 converted partial→pass
  and CFP-15 converted `cannot_judge`→pass** — the coverage item converted cleanly
  rather than exposing a weak capability. CFP-17/18 moved pass→partial, attributed by
  the judge's own reasoning to the run rather than the product; the mission
  instruction that had won them was missing, and restoring it in round 13 won them
  back.

  **Harness defect this exposed:** `loop.sh watch` treated a `stopped` job as
  RUN-COMPLETE. The README already recorded that *a dead watch looks exactly like a
  quiet one*; this was the inverse — **a dead job looks exactly like a finished
  one**. Fixed in `f7fd5bee`: completion now requires `report.json`, anything else
  prints `RUN-DIED` and exits non-zero.

- **2026-08-14, round 11.** Original baseline: 87.5% finalized at 100% coverage
  (89.2% automated at 97.3%), 18 `partial` and 2 `cannot_judge`.
