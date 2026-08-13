# Plan Review: MRQ-148 — AIA-08: one-action assisted placement in the agenda builder

## 1. Verdict

**FAIL (plan-level)**

## 2. Summary

I reviewed the plan supplied for MRQ-148 against the task description, the rubric text
it quotes, and the actual agenda code in this repo (`src/ui/agenda/AgendaPage.tsx`,
`src/routes/agenda.routes.ts`, `src/routes/agenda.queries.ts`, `src/api/agenda.ts`).

The submitted plan is not a plan. Below its title line (`# MRQ-148: AIA-08: …`) it is a
**verbatim, byte-identical restatement of the task description** — same paragraphs, same
order, same emphasis, ending at the same PROVENANCE line. It restates *what to achieve*
and adds nothing about *how*: no files, no endpoint decision, no slot-derivation
algorithm, no copy, no tests, no evidence/deploy step. Every review category below fails
for the same root reason, so the issues are written as the specific decisions the revised
plan must actually make — the ticket is genuinely small, and the grounding is all here.

One clarifying note on scope of this review: I evaluated the plan text as provided in the
review prompt. If a richer plan exists in another artifact, it was not supplied, and the
plan of record as given is the description.

## 3. Issues

**[CRITICAL] Whole plan — The plan is the task description restated, with zero implementation design**
The plan contains no approach. It does not name a single file to create or modify, does
not choose between a client-side orchestration and a server-side endpoint, does not
define what a "free slot" is in a data model that has no slot entity, and does not
describe how the result will be tested or evidenced. A plan that only re-asserts the
acceptance bar gives the implementer no reviewable decisions and gives this gate nothing
to catch. Note also that the description is itself a well-specified ticket — the
implementer's job was to convert it into a design, and that conversion has not happened.
**Recommendation:** Return to `in_planning`. The revised plan should be short (this is a
small ticket) but must contain: the file list, the placement-path decision (issue #2), the
candidate-slot algorithm (issue #3), the exact button copy (issue #5), the test list
(issue #6), and the evidence/deploy step (issue #7).

**[CRITICAL] Missing — No decision on where placement executes; the "same path as manual placement" constraint has a concrete meaning the plan never engages**
The description requires placement to "go through the same path manual placement uses, not
a client-side fake." In this codebase that path is
`POST /api/v1/events/{eventId}/agenda/items` (`src/routes/agenda.routes.ts:217`,
`operationId: placeAgendaItem`), body `{ submission_id, room_id, starts_at, duration_min,
track_id? }`, which validates schedulable status, room/track ownership, duplicate
placement (409), and duration against format bounds before inserting into `agenda_items`.
The plan must decide between two real options with different failure modes:
- **Client-side loop over the existing POST** — no new API surface, reuses all validation,
  but is N HTTP calls behind one click, is non-atomic (partial placement on failure), and
  the route carries `rateLimit: { bucket: "write" }`, so a loop that places many sessions
  can trip the write bucket mid-run.
- **A new server-side endpoint** (e.g. `POST …/agenda/auto-place`) — one call, one
  transaction, testable in `tests/integration/api/`, but adds API surface and an OpenAPI
  entry.
**Recommendation:** State the choice and the reason. Recommend the server-side endpoint
reusing the same validation helpers, with a bounded batch (e.g. place up to N, default
small) — it is atomic, it is directly integration-testable, it sidesteps the write-bucket
risk, and it makes "one action" true at the network layer rather than only at the button.
If the client-loop is chosen instead, the plan must say how partial failure and rate
limiting are handled.

**[CRITICAL] Missing — "Free time × room slots" is undefined; there is no slot entity in this schema**
The plan quotes "finds free time x room slots" as if slots exist. They do not. Agenda
items carry `starts_at` (epoch) + `duration_min` + `room_id` (`src/api/agenda.ts:73-76`);
rooms are a flat list; there is no grid table. The implementer must therefore *derive*
candidate times, and every derivation input is an unmade decision: which conference days,
what daily start/end window, what granularity (15/30/60 min), what duration to use
(`formatDuration()` defaults to the format's `default_duration_min`, falling back to 30,
and `durationIsAllowed()` bounds it), and how existing items are treated as occupancy.
Without this the implementer will invent a grid at the keyboard and it may land sessions
at 3am or outside the event's days.
**Recommendation:** Specify the derivation explicitly. The cheapest honest version:
take the distinct days already present in `snapshot.sessions`, use the earliest and latest
existing item times on each day as the daily window, step at 30-minute granularity, use
`formatDuration(format)` for the session's own duration, and treat any room-time overlap
with an existing item as occupied. Falling back to the event's own date range when the
agenda is empty should be stated too, or explicitly declared out of scope with the
behaviour when nothing is placed (see issue #4).

**[MAJOR] Missing — The rubric's explicit fail mode ("control exists but performs no placement") is never defended**
`PASSES WHEN` fails the item if the control is present but places nothing when triggered.
The unscheduled pool is the accepted-and-unplaced set (AC-70), and the seed does guarantee
at least one reachable candidate — `tests/node/seed-pool.AC-3.test.mjs` asserts
`"accepted Session can_schedule must remain reachable"`. But the judged surface is the
live site, whose state is mutated by prior eval runs and by other agents; an empty pool at
judge time turns a correct implementation into a zero. The plan does not mention this at
all.
**Recommendation:** Add a precondition step — confirm the judged event has ≥1 unscheduled
schedulable session at eval time (and reseed/reset the demo if not) — and specify the
zero-candidate UI behaviour: the control should explain *why* nothing was placed (empty
pool vs. no free slot found) rather than silently no-op'ing, which is both honest and
avoids reading as a broken control.

**[MAJOR] Missing — No copy is chosen, despite honesty being the loudest constraint in the ticket**
The ticket devotes a full paragraph to not overclaiming and cites MRQ-146 as the
precedent. The plan repeats that instruction and then does not commit to a single string.
Copy is also design-bound here: `DESIGN.md` is binding and the agenda builder already has
an established button vocabulary and Flight Deck token set.
**Recommendation:** Name the exact strings in the plan — the button label (recommend
**"Fill open slots"**, which describes the mechanism precisely and claims nothing), its
placement in the agenda toolbar, the result confirmation text (e.g. "Placed 3 Sessions
into open slots"), and the zero-candidate text. Anything that reads as "AI" or "smart"
should be explicitly ruled out in the plan so review can check it.

**[MAJOR] Missing — No test plan, and no acknowledgement of the repo's test conventions or gate**
`CLAUDE.md` requires `npm run pr-gate` before a PR, and the repo's convention is
AC-numbered tests (`tests/node/*.AC-*.test.mjs`, `tests/integration/api/*.test.ts`). The
plan mentions neither, nor the 45s suite / 120s gate budgets.
**Recommendation:** List the tests. Minimum: one integration test asserting that invoking
the endpoint against a fixture with an unscheduled accepted session results in a persisted
`agenda_items` row with a valid `room_id`/`starts_at` (this is exactly the "persists across
reload" requirement, tested at the layer where it is true), plus a unit test over the
candidate-slot function covering occupied-room, duration-bound, and no-candidate cases.
State that `npm run pr-gate` runs before the PR.

**[MAJOR] Missing — Evidence and deploy are required outcomes of this ticket and appear nowhere in the plan**
The description names the evidence the judge wants (control screenshot, before/after grid
screenshots) and `CLAUDE.md` is emphatic that **merging does not ship** — the eval scores
`https://marquee.stage11.dev`. A merged-but-undeployed change scores zero on an item whose
entire purpose is closing eval distance tonight.
**Recommendation:** Add explicit final steps: capture the three screenshots against a
running instance, then follow `DEPLOY.md` to ship and verify via `curl /health` that the
deployed sha matches the merge commit.

**[MINOR] Missing — Conflict handling is quoted but not resolved into a behaviour**
The ticket says prefer non-conflicting placement "where cheap." Cheap is well-defined
here: `getConflicts()` in `src/routes/agenda.queries.ts:253-310` already computes room,
person, and transit conflicts and the snapshot surfaces them, so a room-occupancy check
during candidate selection is nearly free, while person/transit avoidance is not.
**Recommendation:** State the line — avoid room double-booking during slot selection
(cheap, deterministic); do not attempt person/transit avoidance; let the existing conflict
panel flag whatever results. One sentence closes this.

**[MINOR] Missing — No file list**
Reviewers and the implementer both need it, and it is the fastest sanity check that the
approach is coherent.
**Recommendation:** Expected touch set is roughly: `src/ui/agenda/AgendaPage.tsx` (control
+ result state), `src/routes/agenda.routes.ts` (endpoint, if server-side), a new
slot-finding module under `src/lib/`, `src/ui/agenda/agenda.css` if any new styling is
needed, and the two test files above.

## 4. Positive Observations

The **task description** is genuinely excellent planning input and deserves credit even
though the plan is not: it quotes the rubric verbatim rather than paraphrasing, it
correctly reads "judged generously" to collapse the scope from "build an AI scheduler" to
"build a deterministic placer," it pre-empts the overclaiming failure by citing MRQ-146 as
a live precedent, it names the persistence requirement in terms of the code path rather
than the symptom, and it explicitly de-gates conflict avoidance so the ship is not held
hostage to a hard problem. That is a well-scoped, well-reasoned ticket.

The gap is narrow and mechanical: none of that thinking was carried forward into an
implementation design. The revision should be quick — the codebase already supplies the
placement endpoint, the duration rules, and the conflict computation this ticket needs.
