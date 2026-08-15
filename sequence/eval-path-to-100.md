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

**Last refreshed:** round 12 (`runs/2026-08-15T21-19-37`, build `7e6975de6ab3`),
three of seven areas judged; content-management, ai-agenda and public-widgets still
read from round 11 and are marked `*` in the table. See the update log at the bottom.

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
  CFP-14, ABS-07, ABS-09, ABS-13, SPK-07 and SPK-13 all passed in round 12.

**A *finalized* 100% additionally needs a human** to verify CFP-08 and SPK-16 as
`pass` in `manual-results.json` — that is real mail arriving in a real inbox, which
is deliverability (SPF/DKIM/DMARC alignment on the sending domain), not product
code. Round 11's ledger already recorded spam placement as an open infrastructure
question. Until that is settled, treat **automated 100%** as the target and the
finalized number as gated on an operator errand.

---

## The one thing to understand before planning any of it

**Most of the remaining distance is not product work.** Of 9.72 recoverable points,
**5.94 (61%) are items where the judge's own reasoning says the capability is
present and visible, and the run did not take the last step.** Writing user stories
for those would mean building things that already ship.

| lane | points | what it costs |
|---|---:|---|
| **Run reach** — mission instructions and turn budget | **5.94** | one editing session, no product code |
| **Product stories** — five of them | **3.78** | real tickets, one of them large |
| **Total** | **9.72** | → 100% automated |

Keeping these lanes separate is the whole discipline. A round that scores lower
because the agent ran out of turns is not a product regression, and a story written
from that misreading is waste.

---

## Lane 1 — Product stories (3.78 points)

Ranked by points. Each carries the judge's own evidence, because the judge's wording
is what has to change for the item to convert.

### Story 1 — The submitter's own home · CFP-05 + CFP-13 · **1.35 pts**

> *As someone who submitted proposals, I can open one page that lists every proposal
> I have sent this conference and its current status, without creating a password.*

The largest single item on the board, the only weight-3 product gap, and a
**recurring** finding rather than judge variance — it appeared in round 11 and again
in round 12, both times filed as a `major` defect.

Today a public submission is anonymous and the only handle is one private token link
*per abstract*. The judge, round 12:

> *"What is missing is the submitter's own dashboard: a public submitter has no
> account and no page listing their proposals with a status label — only one private
> token link per abstract. `/portal` is a different surface bound to a seeded demo
> speaker, not reachable as the submitting identity."*

CFP-13 falls out of the same story for free — decisions already reach the submitter
in unambiguous wording on the private link (*"Your abstract was accepted"*), they
simply do not arrive on a dashboard.

The pieces exist: magic-link auth ships, `people` rows are org-scoped, and the
portal already renders a task-and-status surface. This is assembly rather than
invention. Note the related `minor` defect the judge filed alongside it — the
speaker portal binds to a fixed seeded identity rather than to the person who
submitted, which is the submitter/speaker split `SPEC.md` §10 already names as a
known limitation. Story 1 is the honest resolution of that limitation.

### Story 3 — Public speaker attribution · EMB-16 · **0.86 pts** · *may already be fixed*

A session created during round 11 printed **"Speaker to be announced"** on the public
agenda and carried an empty `speakers[]` in the public JSON feed, while the
organizer's own record named a speaker. The public surface understating the program
is a real bug independent of any rubric.

**Hold before ticketing:** `6a247826 fix: attribute builder sessions to speakers
(#262)` landed *after* round 11's build. Public-widgets has not been re-judged since.
Confirm against a completed round before writing a ticket.

### Story 2 — An explicit content-approval state · CNT-12 · **0.73 pts** · *needs a ruling first*

Marquee gates publication on **scheduling** — every record reads *"Not yet public —
Needs a room and time before it can go public"*. The rubric expects a content
approval/review status the organizer sets, with unapproved content excluded from
public output.

This is a design divergence, not a missing feature, so it is only a story if the
answer is "adopt an explicit approval state". The alternative is a deliberate 0.73
declined on the grounds that scheduling-as-gate is the better product. **That is an
operator ruling, and nobody should build it until it is made.**

### Story 4 — Save reliability on session content · CNT-09 · **0.48 pts**

The judge's words: *"the capability works but not reliably… saving succeeded on the
**second attempt**"*. A first save that silently does not take is a defect whatever
the rubric says. Small, and worth doing for its own sake.

### Story 5 — Agent evaluation on demand, labelled where it is read · ABS-14 · **0.36 pts** · cheap

The agent evaluator exists and holds real per-criterion numeric scores with a
rationale, and the chair override persists correctly. Three named gaps:

> *"the agent's score was pre-seeded … no AI evaluation was observed being generated
> during the run; the override was exercised on a human reviewer's score, not on the
> AI score; and the AI-vs-human distinction was confirmed in the committee roster and
> author id, not in the results/score table."*

So: a **"Run agent evaluation" action** that produces a score live, and an **agent
badge in the results table** rather than only in the roster. Part of this is a run
instruction (override the *agent's* score, not a human's) and part is product.

---

## Lane 2 — Run reach (5.94 points, no product code)

Twelve items where the capability is present and the last step was not taken:

| item | pts | what the run did not do |
|---|---:|---|
| ABS-02 | 0.71 | left both rounds pointed at the same reviewer pool; never created a second, differently-scoped pool |
| ABS-06 | 0.71 | cancelled the Distribute modal to protect another check, so auto-distribution was never fired |
| EMB-08 | 0.57 | detail view satisfies every field; the Back/close half was never evidenced |
| AIA-02 | 0.56 | never added a room or track, so the configuration half is unevidenced |
| CFP-17 | 0.54 | never executed the create-a-second-conference flow |
| CFP-18 | 0.54 | never opened the second conference's own submissions list |
| SPK-06 | 0.50 | the portal invite was never actually triggered |
| SPK-10 | 0.50 | never clicked Download on the speaker-uploaded deliverable |
| CNT-10 | 0.48 | skipped the organizer-originated bio/headshot save-and-reload |
| CNT-14 | 0.48 | never selected rows and never started the bulk download |
| EMB-13 | 0.29 | drill-in complete; the close/back half not evidenced |
| SPK-03 | 0.06 | never opened CSV import — *"budget ran out"* |

Two levers convert these:

**Mission instructions that name the exact last step.** This is *proven*, in both
directions. Round 10's mission carried an explicit block ordering the agent to create
a second conference, put a record in it, switch back, and screenshot both sides'
counts — CFP-17 and CFP-18 passed. That block was dropped from round 12's mission on
the grounds the pair was fixed, and both fell straight back to `partial` the same
night, with the judge confirming the capability was present the whole time. **The
instruction is load-bearing and must stay in the mission file.**

**Turn budget.** `maxTurnsPerScenario` is 70 and SPK-S3 ran out before reaching
import. Raising it for the heaviest scenarios, or splitting them, is the cheapest
point on this board.

The standing risk: these items convert only while the instructions that convert them
remain. A mission rewritten from scratch each round will keep winning and losing the
same 5.94 points forever.

---

## The derived table

Regenerate with `python3 sequence/auto-eval/weigh.py`. Rows marked `*` fall back to
an earlier run because the current round has not judged that area yet — they
describe a build that is no longer deployed.

```
run 2026-08-15T21-19-37  —  9.72 headline points recoverable across 18 non-pass items
  rows marked * fall back to an earlier run (2026-08-14T14-46-26)

  item     area                  verdict       testability    wt   gain
* EMB-16   public-widgets        partial       auto-partial    3   0.86
  CFP-05   call-for-papers       partial       auto            3   0.81
* CNT-12   content-management    partial       auto            3   0.73
  ABS-02   abstract-management   partial       auto            2   0.71
  ABS-06   abstract-management   partial       auto            2   0.71
* EMB-08   public-widgets        partial       auto            2   0.57
* AIA-02   ai-agenda             partial       auto            2   0.56
  CFP-13   call-for-papers       partial       auto            2   0.54
  CFP-17   call-for-papers       partial       auto            2   0.54
  CFP-18   call-for-papers       partial       auto            2   0.54
  SPK-06   speaker-management    partial       auto-partial    2   0.50
  SPK-10   speaker-management    partial       auto-partial    2   0.50
* CNT-09   content-management    partial       auto            2   0.48
* CNT-10   content-management    partial       auto            2   0.48
* CNT-14   content-management    partial       auto-partial    2   0.48
  ABS-14   abstract-management   partial       auto-partial    1   0.36
* EMB-13   public-widgets        partial       auto            1   0.29
  SPK-03   speaker-management    cannot_judge  auto            2   0.06
```

### Reading `cannot_judge` correctly

SPK-03 is worth only 0.06 despite weight 2, and that is not a rounding artifact.
`cannot_judge` sits **outside** the denominator, so converting it to `pass` adds the
item to the numerator *and* the denominator. In an area already scoring near its
own average the net movement is small — and in an area scoring below 100% a newly
reached item that turns out to be **weak scores worse than leaving it unreached**.
This is the coverage trap: an unreached item costs nothing today and costs real
points the moment a round arrives and finds nothing there. Build the capability
before letting a round reach it.

---

## Update log

- **2026-08-15, round 12 (in flight).** Document created. Three of seven areas
  judged before Atlas went unreachable. **CFP-06, CFP-10, CFP-11 converted
  partial→pass, and CFP-15 converted `cannot_judge`→pass** — the coverage item
  converted cleanly rather than exposing a weak capability. CFP-17/18 moved
  pass→partial; the judge's reasoning attributes this to the run, not the product
  (see Lane 2). ABS-14 moved `cannot_judge`→partial. SPK-03 became a new
  `cannot_judge` on turn budget. Total recoverable: **9.72**.
- **2026-08-14, round 11.** Baseline for this document: 87.5% finalized at 100%
  coverage (89.2% automated at 97.3%), 18 `partial` and 2 `cannot_judge`.
