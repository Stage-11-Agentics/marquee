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

**Last refreshed:** **round 14** (`runs/2026-08-16T03-03-56`, build `bbb8e21e3ae3`) —
**the first complete round since round 11**: 20/20 scenarios, 7/7 areas, cleanup
verified. **94.0% at 97.9% coverage**, automated. Every number below is from one
build with `built_at` constant at every area boundary. No fallback rows.

---

## Where it stands

| Area | weight | round 14 | coverage | previous |
|---|---:|---|---|---|
| call-for-papers | 20 | 90.5% | 97.4% | 93.2% (r13) |
| abstract-management | 20 | 94.6% | 100% | 100% (r13) |
| speaker-management | 15 | 92.2% | 97.0% | 96.9% (r13) |
| content-management | 15 | 91.9% | 100% | 91.9% (r13) |
| ai-agenda | 10 | 93.8% | 88.9% | 100% (r13) |
| **public-widgets** | 20 | **100%** | **100%** | *never measured on this rubric* |
| speaker-crm *(extra credit)* | — | 89.5% | 100% | *never measured at all* |
| **Overall (required)** | 100 | **94.0%** | **97.9%** | 89.2% (r11, last complete) |

**+4.8 on the last complete round.** The headline is carried by **public-widgets at
100%** — on the *harder* resynced rubric, with EMB-15 at its new weight 3. All three
public-widgets items this document had been carrying as stale round-11 rows
converted, and Story 3 below closed with them.

By problem type, the shape of what is left: `exists` and `handoff` are at 100%,
`crud` 93.9%, `roundtrip` 97.0% — while **`bulk` (81.8%)** and **`rule` (87.5%)** are
the weak bands, which is exactly where the remaining defects sit.

---

## Is 100% actually reachable?

**Yes for the automated headline.** Only 2 of the 86 required items are
`manual`-testability — CFP-08 and SPK-16, weight 1 each — and `scoreArea` pushes
those to `pendingManual` without ever adding them to `judgeable`, so they are
**excluded from the denominator, not scored zero**. `auto-partial` is not a cap
either: seven such items have now passed across rounds. The older `CEILING.md` claim
of a "~95–96% ceiling" is superseded — round 14 is already at 94.0.

**A *finalized* 100% additionally needs a human** to verify CFP-08 and SPK-16 as
`pass` in `manual-results.json` — real mail arriving in a real inbox, which is
deliverability (SPF/DKIM/DMARC), not product code. Round 14 has **18 manual items
pending**. Until deliverability is settled, treat **automated 100%** as the target.

---

## The two lanes

Round 13 proved the distinction empirically: it changed no application code and
converted **ten items** purely by instructing the browsing agent to finish the flows
it was stopping one action short of. That lane is mission text, not tickets — and
the gains are lost the moment an instruction is dropped, which is exactly what
happened to CFP-17/18 between rounds 10 and 12.

Round 14 shifts the balance. With the run-reach lane mostly harvested, **what remains
is now majority product work — including three defects this build introduced.**

| lane | points | what it costs |
|---|---:|---|
| **Product defects** — three, all new in round 14 | **1.77** | real fixes; one is data loss |
| **Product stories** — two, long-standing | **2.08** | one ticket, one ruling |
| **Run reach** — four | **1.64** | mission text and turn budget |
| **Judge strictness** — one | **0.54** | watch, do not ticket on one sighting |
| **Total** | **6.03** | → 100% automated |

---

## Lane 1a — Defects this build introduced (1.77 points)

**All three were `pass` in round 13 and are `partial` in round 14.** Round 14 grades
a newer build (`bbb8e21e3ae3` vs `f7fd5beed6fb`) carrying the eight-ticket plumbing
batch, so unlike round 12's regressions these are **not** attributable to the run.
They are ranked first because two of them are wrong regardless of any rubric.

### SPK-15 — Logistics fields silently discard data · 0.23 pts · **fix this whatever the score says**

> *"the first attempt filled Arrival + Travel preferences + Dietary and pressed 'Save
> speaker', the button showed 'Saving…' and reported success, yet after reload all
> three fields were empty. So logistics data persists only when saved one field at a
> time."*

A multi-field save that **reports success and drops the data**. Lowest point value on
this page and the most serious entry on it: silent data loss on a speaker's dietary
and accessibility needs is the kind of defect that hurts a real person at a real
conference, not a score.

### ABS-05 — Reviewer assignment silently no-ops · 1.07 pts · largest single item

> *"assigning Sam Whitfield to 'Your AI Pair Programmer Is Lying to You' (Evals
> track) silently did nothing — no error, no toast."*

Per-submission assignment otherwise works and the reviewer queue is correctly
restricted. One assignment path fails with no feedback at all. Note round 13
recorded the *inverse* behaviour as a strength — a refusal explained inline
(*"Sam Whitfield reviews Infra; this abstract carries Evals…"*). A guard that used to
explain itself and now fails silently is a strong regression signal.

### SPK-13 — Bulk send never returns · 0.47 pts

> *"the QUEUE MESSAGE button entered 'QUEUEING…' and never returned any in-page
> success or summary state (screenshots before and after a 4s wait are identical)."*

The per-recipient rows do reach the outbox, so the work happens; the UI never
confirms it. An operator sending to 1,030 recipients cannot tell whether it worked.

---

## Lane 1b — Long-standing product stories (2.08 points)

### Story 1 — The submitter's own home · CFP-05 + CFP-13 · **1.35 pts**

> *As someone who submitted proposals, I can open one page that lists every proposal
> I have sent this conference and its current status, without creating a password.*

**Unmoved across rounds 11, 12, 13 and 14**, filed `major` each time, and untouched
by round 13's instruction sweep — which is precisely what separates it from the
run-reach lane. A public submission is anonymous; the only handle is one private
token link *per abstract*. `/portal` exists but binds to a seeded demo speaker, not
the submitting identity. CFP-13 falls out of the same story for free: decisions
already reach the submitter in clear words on the private link, just not on a
dashboard. Magic-link auth ships and `people` rows are org-scoped, so this is
assembly rather than invention.

### Story 2 — An explicit content-approval state · CNT-12 · **0.73 pts** · *needs a ruling*

Marquee gates publication on **scheduling** (*"Needs a room and time before it can go
public"*); the rubric expects a content approval status the organizer sets, with
unapproved content excluded from public output. Confirmed as a genuine design
divergence, not thin evidence. Only a story if the answer is "adopt an approval
state" — otherwise a deliberate 0.73 declined. **An operator ruling, not a ticket.**

### Closed

- **Story 3 — public speaker attribution (EMB-16).** Closed. public-widgets scored
  **100%** in round 14; `#262` had indeed fixed it, which is why this document said
  not to ticket it until a round confirmed.
- **CNT-09 (save reliability)** and **ABS-14 (agent evaluation)** — both passing
  since round 13.

---

## Lane 2 — Run reach (1.64 points, no product code)

| item | pts | what the run did not do |
|---|---:|---|
| AIA-05 | 0.62 | proved room-conflict blocking only *indirectly* (occupied cells offer no target); never placed two sessions in one slot and screenshotted the flag |
| CNT-10 | 0.48 | organizer-originated bio + headshot save-and-reload skipped — **third round running** |
| SPK-03 | 0.47 | CSV import still not carried through to the roster — **third round running** |
| AIA-06 | 0.07 | no session move was ever attempted; AIA-S1 spent its budget on room/track creation |

CNT-10 and SPK-03 have now survived three missions that named them explicitly. The
instruction is not the problem any more — **these two need their own scenario budget,
not another sentence.** ai-agenda's coverage fell to 88.9% because of AIA-06, which
is the coverage trap in miniature: an item nobody reached, costing nothing until a
round arrives.

---

## Lane 3 — Judge strictness (0.54, watch, do not ticket)

**CFP-14** moved pass → partial with the judge stating the item is *"capped at partial
because actual delivery and body personalization cannot be auto-verified"* — while
describing a fully working decision-mail flow with a delivery panel and an outbox.
That is the auto-partial ceiling being applied this round and not last. Per the
loop's own rule, one sighting with no matching code change is a watch item.

---

## The derived table

```
run 2026-08-16T03-03-56  —  6.03 headline points recoverable across 11 non-pass items

  item     area                  verdict       testability    wt   gain
  ABS-05   abstract-management   partial       auto            3   1.07
  CFP-05   call-for-papers       partial       auto            3   0.81
  CNT-12   content-management    partial       auto            3   0.73
  AIA-05   ai-agenda             partial       auto            2   0.62
  CFP-13   call-for-papers       partial       auto            2   0.54
  CFP-14   call-for-papers       partial       auto-partial    2   0.54
  CNT-10   content-management    partial       auto            2   0.48
  SPK-03   speaker-management    partial       auto            2   0.47
  SPK-13   speaker-management    partial       auto-partial    2   0.47
  SPK-15   speaker-management    partial       auto            1   0.23
  AIA-06   ai-agenda             cannot_judge  auto            2   0.07
```

### Reading `cannot_judge` correctly

AIA-06 is worth only 0.07 despite weight 2, and that is not rounding. `cannot_judge`
sits **outside** the denominator, so converting one to `pass` adds the item to the
numerator *and* the denominator. In an area already scoring near its own average the
net movement is small — and in an area scoring below 100% a newly reached item that
turns out to be **weak scores worse than leaving it unreached**. Build the capability
before letting a round reach it.

---

## Update log

- **2026-08-16, round 14 — COMPLETE. 94.0% at 97.9% coverage.** First clean round
  since 11: 20/20 scenarios, 7/7 areas, cleanup verified. **public-widgets 100%** on
  the resynced rubric; **speaker-crm 89.5%**, its first measurement ever. Recoverable
  4.75 → 6.03, and the composition inverted: the run-reach lane is mostly harvested
  and what remains is majority product work.

  **Six items moved backward against round 13, and this time it is not the run** —
  round 14 grades a newer build carrying the eight-ticket plumbing batch. Three are
  real defects (ABS-05 silent no-op, SPK-13 stuck bulk send, **SPK-15 silent data
  loss**), two are evidence/strictness (AIA-05, CFP-14), one is a run shortfall
  (AIA-06).

  **Deploy incident, recorded because the loop should have caught it:** the barrier
  that deployed this build shipped `migrations/0026_calendar_truth.sql`'s code
  without its migration, and live D1 now answers
  `no such table: calendar_cancellations`. `reset-demo` fails in production as a
  result. `barrier` deploys whatever `github/main` holds and **never checks whether
  the commit range touched `migrations/`** — the loop's rules gate migrations on the
  operator but nothing enforces the gate at the moment of deploy.

- **2026-08-16, round 13 — VOID as a headline, five areas kept, Lane-2 hypothesis
  confirmed.** Account hit a weekly limit at 16 of 20 scenarios. **Ten items
  converted to `pass` with zero regressions on byte-identical application code.**
  Recoverable 9.72 → 4.75.

- **2026-08-15, round 12 — VOID as a headline, three areas kept.** Atlas rebooted at
  14 of 20 scenarios. CFP-15 converted `cannot_judge`→pass. Exposed the harness
  defect where a dead job read as a finished one; fixed in `f7fd5bee` — completion
  now requires `report.json`.

- **2026-08-14, round 11.** Original baseline: 89.2% automated at 97.3% coverage.
