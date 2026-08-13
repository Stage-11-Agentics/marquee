# Plan Review: MRQ-157 — V2-8: agenda grid placement at 15-minute increments

## 1. Verdict

**FAIL (plan-level)**

## 2. Summary

The submitted "Plan" is a byte-for-byte copy of the task description — it contains no
implementation approach, no file list, no decision on where the resolution setting lives,
and no test strategy. Beyond the missing content, the description's own sequencing
constraint is currently violated on the board (MRQ-148 is `pr_open`, MRQ-141 is `planned`,
and MRQ-157 is already `in_progress`), and a first read of the code surfaces three
substantive problems the plan would have had to solve: `TIME_SLOTS` drives **four**
boards rather than one, cell membership is exact string equality so off-grid sessions
render nowhere, and the track board's CSS hardcodes 12 columns on the **X** axis while the
day/week boards put time on the **Y** axis. The task should return to `in_planning`.

## 3. Issues

**[CRITICAL] Plan (entire) — The plan is a verbatim copy of the task description**
Lines 27–39 of the review packet reproduce lines 14–24 exactly: same PROBLEM, GOOD LOOKS
LIKE, CLOSES NO EVAL ITEM, SEQUENCING, and VERIFY paragraphs, in the same order, with no
added content. There is no approach, no file inventory, no data model for the resolution
setting, no migration path for existing hourly assumptions, and no test plan. Nothing in
this document can be reviewed for feasibility because nothing has been proposed. Every
checklist category below (completeness, feasibility, alignment, risk, AC coverage,
architecture) fails on this single fact.
**Recommendation:** Return to `in_planning` and author a real plan. At minimum it must
name: the files to be modified, the shape of the slot-generation function, where the
resolution setting is stored and how it is surfaced, the axis treatment for each of the
four boards, which tests change, and how VERIFY will be executed.

**[CRITICAL] Plan — SEQUENCING — the chain's predecessors are not clear, and this ticket is already `in_progress`**
The description states this is the third link (MRQ-148 → MRQ-141 → MRQ-157) and "Do not
run blind alongside either." Current board state contradicts that:
- `MRQ-148` (AIA-08, one-action assisted placement) — **`pr_open`**, not merged.
- `MRQ-141` (agenda placement is mouse-only / click-to-place) — **`planned`**, not started.
- `MRQ-157` (this ticket) — **`in_progress`**.
Both boards' work lands in `src/ui/agenda/AgendaPage.tsx` and
`src/ui/agenda/track-board.tsx`. Implementing MRQ-157 now guarantees a conflict with an
open PR and pre-empts an unstarted ticket the description says this one composes with.
The plan does not acknowledge the discrepancy at all.
**Recommendation:** The plan must open with an explicit sequencing check: confirm MRQ-148
merged to `main`, and state the decision on MRQ-141 — either wait for it, or explicitly
absorb click-to-place into this ticket with the operator's sign-off. Rebase onto merged
`main` before writing code.

**[CRITICAL] Plan — `TIME_SLOTS` drives four boards, not just the track board**
The description scopes the problem to `track-board.tsx:7`, and the plan repeats that
scoping unchanged. In fact `TIME_SLOTS` is consumed by:
- `src/ui/agenda/track-board.tsx:63` (time axis) and `:83` (drop cells)
- `src/ui/agenda/AgendaPage.tsx:324` (`DayBoard` rows)
- `src/ui/agenda/AgendaPage.tsx:358` (`WeekBoard` rows)
Changing the constant from 12 entries to 48 (15-min) or 144 (5-min) silently multiplies
cell counts in all four surfaces. `DayBoard` renders `TIME_SLOTS × rooms` drop cells;
`WeekBoard` renders `TIME_SLOTS × days`; `TrackBoard` renders
`tracks × days × TIME_SLOTS`. At 5-minute resolution that is a 12× increase across the
whole agenda builder.
**Recommendation:** The plan must inventory all four consumers and state, per board,
whether it adopts the finer resolution or stays hourly. If `TIME_SLOTS` becomes a function
of a resolution setting, say so and name the signature.

**[MAJOR] Plan — Cell membership is exact string equality; off-grid sessions render nowhere**
Every board matches sessions with strict equality against the slot label —
`sessionTime(session, tz) === time` (`track-board.tsx:90`, `AgendaPage.tsx:329` region,
`:360`). A session stored at `10:07` currently belongs to **no** cell and disappears from
the grid entirely with no error. This is exactly the failure mode 15-minute placement
invites: the API accepts arbitrary `starts_at`, a 5-minute-resolution placement is made,
the builder is later switched back to 30-minute, and the session vanishes. The plan says
nothing about bucketing.
**Recommendation:** Replace equality with a bucketing predicate that floors a session's
local minute to the active resolution, so every session lands in exactly one cell at any
setting. Add a unit test that a session at an off-grid minute still renders.

**[MAJOR] Plan — No decision on where the "builder setting for 30 or 5" lives**
"GOOD LOOKS LIKE" requires a user-facing resolution setting, while also asserting
"GRID UI ONLY — no schema or API work." These are compatible only if the setting is
client-side, and a grep finds no existing event-settings mechanism in `src/api/` to hang
it on. The plan makes no choice, so the implementer will invent one — component state,
`localStorage`, a URL param, or (violating scope) a new API field.
**Recommendation:** Pick one and write it down. Recommended: local UI state persisted to
`localStorage` keyed by event id, defaulting to 15 — no schema, survives reload, matches
the ticket's UI-only constraint. Also specify the control's placement and label in the
builder toolbar.

**[MAJOR] Plan — The track board's time axis is horizontal and hardcoded to 12 columns**
`src/ui/agenda/agenda.css` hardcodes the track board's twelve hourly columns in three
places: `.agenda-track-time-axis` (`grid-template-columns: 110px repeat(12, minmax(105px, 1fr)); min-width: 1370px`),
`.agenda-track-slots` (`repeat(12, minmax(105px, 1fr)); min-width: 1260px`), and the
`8.333%` repeating-linear-gradient that draws the hour rules. At 48 columns and the same
105px minimum, the lane becomes ~5000px wide. Note also that the ticket's phrasing —
"micro-ticks for sub-hour **rows**" — assumes a vertical axis, which is true for
`DayBoard`/`WeekBoard` but false for `TrackBoard`. The two orientations need two distinct
treatments and the plan proposes neither.
**Recommendation:** State the CSS strategy explicitly per orientation: for the track board,
either drive `repeat()` and the gradient stop from the slot count (and shrink the per-slot
minimum for sub-hour columns), or keep hour columns and subdivide within each. For the
row-based boards, specify the micro-tick treatment against DESIGN.md tokens, and how
`.agenda-time` (`min-height: 92px`) shrinks for sub-hour rows.

**[MAJOR] Plan — No test strategy, and an existing test will break**
`tests/unit/agenda-track-board.AC-78-81.test.ts:97` asserts
`data-track-slot` count `=== DAYS.length * TIME_SLOTS.length` — it will fail the moment
`TIME_SLOTS` changes length, and the plan does not mention it. Nor does the plan say how
VERIFY ("place at :15 and at :45; both persist across reload and render in the correct
row") will be executed — no e2e test, no dev-server walkthrough, no browser validation.
**Recommendation:** Name the tests to update and add: the existing AC-78-81 count
assertion, a bucketing unit test, a resolution-setting unit test, and a Playwright e2e
covering place-at-:15 / place-at-:45 / reload / correct-row. VERIFY is not satisfied by a
green unit suite alone; drive the real dev server.

**[MAJOR] Plan — Cell-count growth is a live speed-budget risk**
`scripts/checks/speed-budgets.mjs` carries `agenda-cold-interactive` as an **acceptance**
budget sourced from AC-85 (asserted in `tests/unit/speed-budgets.test.ts`) — a breach
fails the gate, not merely warns. Multiplying agenda DOM nodes 4× (15-min) or 12× (5-min)
is precisely the kind of change that trips it, and R7 ("speed is a feature") makes any
slow list a defect. The plan does not mention performance at all.
**Recommendation:** Add a step that measures `agenda-cold-interactive` before and after at
the default 15-minute resolution, and state the mitigation if it regresses (virtualize,
render hour containers with sub-slot children rather than N flat cells, or cap the
5-minute setting to a single-day view).

**[MINOR] Plan — `RoomBoard`'s hardcoded "Drop at 16:00" affordance is untouched**
`AgendaPage.tsx:393` renders a fixed `Drop at 16:00` cell. It is not governed by
`TIME_SLOTS` and will read as stale once the rest of the builder speaks at 15-minute
resolution.
**Recommendation:** Decide in the plan whether it stays as-is (acceptable, out of scope)
or gains resolution awareness — either is fine, but the choice should be deliberate.

**[MINOR] Plan — Accessibility of the finer axis is unaddressed**
The track board's time axis carries `aria-hidden="true"` (`track-board.tsx:61`), so the
only non-visual handle on a slot is `data-track-time`. Quadrupling the slot count without
an accessible name makes screen-reader and agent-driven placement materially harder —
which is the very problem MRQ-141 exists to solve, and this ticket is meant to compose
with it.
**Recommendation:** Note the interaction with MRQ-141 and state whether drop cells gain an
accessible label (e.g. `aria-label="Wed 10:15, Track A"`) here or there.

**[MINOR] Plan — The prioritization question posed by the ticket is left unanswered**
The description explicitly asks the implementer to weigh this against open eval-scoring
tickets ("if the eval-scoring tickets are still open when you would start this, say so
rather than taking it first"). The plan copies the paragraph but never answers it.
**Recommendation:** Answer it in one line — state the eval-ticket position at planning
time and the resulting take-it/defer-it call.

## 4. Positive Observations

The credit here belongs to the **task description**, which is genuinely strong source
material and made this review possible: it isolates the offending constant with a file and
line, draws a hard scope boundary ("GRID UI ONLY — no schema or API work") backed by a
real fact about the API, flags its own priority as questionable rather than assuming
importance, names the two-ticket dependency chain by number, and closes with a concrete,
falsifiable VERIFY. A plan that engaged with those constraints would have had an unusually
clear runway.

That runway is exactly what makes the copy-paste costly rather than merely lazy: the
description's three sharpest claims — that the change is confined to one file, that the
axis is made of rows, and that no API work is implied by a persisted user setting — are
each contradicted or complicated by the code, and a real planning pass would have caught
all three before an implementer spent the 45 minutes.
