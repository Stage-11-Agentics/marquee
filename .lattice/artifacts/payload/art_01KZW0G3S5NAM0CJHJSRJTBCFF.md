# Plan Review: MRQ-141 — Click-to-place agenda sessions

## 1. Verdict

**FAIL (plan-level)**

## 2. Summary

Reviewed the plan against the ticket, the AIA rubric it is meant to unlock
(`.eval-kit-agent/specs/05-ai-agenda.yaml`), and the actual code at the plan's
stated base (`5441cf1c`, worktree `v2-1-click-to-place`): `src/ui/agenda/AgendaPage.tsx`,
`src/ui/agenda/track-board.tsx`, and `src/routes/agenda.queries.ts`. The shape is
right — one armed state, one extracted placement operation shared with the drop
handler, a reserved status line, drag left intact — and that shape is the correct
answer to the ticket.

It fails on one decision and two undefined behaviours that decide whether the
eval items actually close. The rule "occupied room/time combinations remain
session content, not targets" removes the only keyboard/agent path to AIA-05's
evidence (the deliberate same-room double-book), which is one of the four items
the ticket exists to unlock. "Free slot" is undefined — and undefinable as
written — in the Week, Room, and Track render paths, all of which force
`snapshot.rooms[0]` as the target room. And the plan does not acknowledge that
MRQ-157 is `in_progress` right now in the same two files.

## 3. Issues

**[CRITICAL] Implementation §3 — "Occupied … remain session content, not targets" closes the keyboard path to AIA-05's evidence**

AIA-05 (w2, currently `partial`) is graded on scenario AIA-S1 step 9: *attempt*
to place a third session at Day 1 10:00 in Room 2A, which is already occupied,
and record whether the placement is blocked or flagged. The current code never
blocks it: `DropCell` accepts any drop, and `getConflicts` (`src/routes/agenda.queries.ts:265`)
emits `kind: "room"` — *"Room overlap — {room} is occupied by overlapping sessions."*
So the mouse path produces the flag; the plan's click path produces nothing to
activate at all.

The rubric's pass criteria does allow "prevented at placement time (drop rejected,
**slot shown occupied**)" — but the plan shows nothing. A snapshot-driven agent
that finds no control for Room 2A at 10:00 has no evidence either way and records
step 9 as un-performable. That is the exact `cannot_judge` failure mode this
ticket was revived to end, reproduced on the item where the ticket's own
verification script ("place a same-speaker overlap and watch the conflict panel
gain the double-booking") does *not* happen to exercise it — the ticket's
overlap is same-speaker/different-room, which lands on a free cell and passes
straight through this gap.

It is also a drag/click parity break, which the ticket forbids in spirit: the
mouse can double-book a room, the keyboard cannot.

**Recommendation:** Render occupied cells as named controls too, with the
occupancy in the accessible name — e.g. `Place at 10:00 · Room 2A · occupied by
"Taming 40-Minute CI"`. Prefer letting activation go through (matching drag
exactly, producing the room-overlap conflict the panel already reports); if you
would rather refuse it, refuse it *audibly* — activate, write nothing, and put
"Room 2A is already booked at 10:00" in the status line. Either is legible to a
snapshot; silence is not. State which you chose and why in the plan.

**[MAJOR] Implementation §3 — "each free slot in the Day, Week, Room, and Track render paths" is undefined for three of the four**

Only `DayBoard` has true (time × room) cells. The others do not:

- `WeekBoard` (`AgendaPage.tsx:396,402`) cells are (day × time) and hard-force
  `fallbackRoom = snapshot.rooms[0]`. A cell showing a session in Room 2B looks
  occupied but `rooms[0]` may be free; an empty-looking cell may target an
  occupied `rooms[0]`. Whatever the button's label says about the room, it is a
  claim about a room the cell does not display.
- `TrackBoard` (`track-board.tsx:88-94`) is the same, plus a track dimension:
  `tracks × days × TIME_SLOTS` cells, all targeting `rooms[0]`.
- `RoomBoard` (`AgendaPage.tsx:435`) has exactly one drop target per room-day,
  at a **hardcoded `"16:00"`** — which also falsifies the plan's claim that
  "Times come from `TIME_SLOTS`, so MRQ-157 can widen them without this code
  hardcoding hours." That literal is not in `TIME_SLOTS`.

**Recommendation:** Define target semantics per view in the plan. Reasonable
answer: in Day view compute freeness from the rendered tiles in that exact cell;
in Week/Track/Room views make every slot a target (they are not room-scoped, so
"free" is not a property they can assert) and put the resolved room in the label
so the agent reads what it will get. Name the RoomBoard 16:00 literal explicitly
as either kept or replaced.

**[MAJOR] Sequencing — MRQ-157 is in flight in the same two files right now**

The plan treats MRQ-157 as downstream ("so MRQ-157 can widen them"). It is not
downstream — task `task_01KZVZTAKCJN6NWF3KDYM25JBX` ("V2-8: agenda grid placement
at 15-minute increments") is `in_progress`, its worktree `v2-8-grid-increments`
sits on the same base `5441cf1c`, and it has already created `src/lib/agenda-grid.ts`
and `tests/unit/agenda-grid.MRQ-157.test.ts`. It will necessarily rewrite
`TIME_SLOTS` and the grid render paths in `track-board.tsx` and `AgendaPage.tsx`
— the same ~200 lines this ticket rewrites. The ticket's own warning ("Do not run
two agents blind in the same file") applies verbatim, just to a different sibling
than the one it named.

Secondary: at 15-minute increments the cell count quadruples (Track view becomes
`tracks × days × 48` — several hundred buttons). Rendering them only while armed
contains the DOM cost but not the accessibility-tree size the judging agent has
to read; R7 says treat a slow surface as a defect.

**Recommendation:** Coordinate with the MRQ-157 agent directly before touching
the render paths — agree who owns slot generation, and prefer consuming its
`src/lib/agenda-grid.ts` over re-deriving from `TIME_SLOTS`. Add the resolution
to the plan.

**[MAJOR] Plan omits focus management after a placement**

Activating a cell button calls the placement operation, which `await load()`s a
fresh snapshot; the armed state clears, every cell button unmounts, and focus
falls to `document.body`. A keyboard user is dropped at the top of the document
after every single placement — a defect precisely in the dimension being graded,
and one no unit test will catch.

**Recommendation:** After a successful placement, move focus deliberately — to
the newly placed tile, or back to the pool list — and route the outcome through
the existing `notice` region (or the new status line) so it is announced. Add
this as an explicit step and as a line in the browser verification.

**[MINOR] Testability — `preact-render-to-string` cannot reach the armed state as the code is shaped**

`tests/unit/agenda-track-board.AC-78-81.test.ts` establishes the house pattern:
`renderToString` over exported components. But `DayBoard`, `WeekBoard`,
`RoomBoard` and `DropCell` are module-private, and the armed state lives in
`AgendaPage`'s hooks behind a `fetch`. As written, step 5's "tests for … the
rendered accessible controls" has nothing to render. `npm run e2e` is not the
fallback: `scripts/checks/run-e2e.mjs` stubs out (no `tests/e2e` directory) and
requires a deployed `MARQUEE_E2E_URL`.

**Recommendation:** Make it explicit in the plan — export the board components
and pass the armed payload down as a prop (rather than reading it from context),
so a test can render the armed board and assert the button names. And extract
the placement operation as a module-level *request builder* — `(payload, target,
snapshot) → {path, method, headers, body}` — so the "same path as drop" claim is
asserted by a test rather than by inspection. The current phrasing ("Extract one
placement operation") leaves it inside the component closure, where it is
untestable.

**[MINOR] The surface's own copy still says the only mechanism is drag**

`PageHeader` copy (`AgendaPage.tsx:866`): *"Drag accepted Sessions into a day,
time, and room."* Pool chip: *"Drag back here to unplace."* Pool footer: *"Drag →"*.
An agent that reads the page before acting is being told, by the product, to
drag. This is the cheapest possible edit and it points the judging agent straight
at the new path.

**Recommendation:** Add a step updating this copy to name both mechanisms.

**[MINOR] List view is left keyboard-inert**

Step 4 says "each scheduled non-break tile" — that is `SessionTile`, used by Day/
Week/Room/Track. `AgendaList` rows (`AgendaPage.tsx:294-301`) are separately
marked up, are `draggable`, and will get neither Move nor Unplace. A view that is
mouse-draggable but keyboard-inert reproduces the ticket's complaint in miniature.

**Recommendation:** Either cover list rows or state the exclusion and why.

**[MINOR] "Free" is a shallow check; unplace needs a `submission_id` guard**

Two small correctness notes the plan should encode: (a) freeness computed from
`sessionTime(session) === time` ignores duration, so the 11:00 cell under a 90-minute
10:00 session reads as free — matching what the grid draws, which is defensible,
but say so; (b) `onPoolDrop` already guards `session.submission_id === null`
(`AgendaPage.tsx:718`) — the Unplace control needs the same guard, not just the
`kind !== "break"` one the plan names.

**[MINOR] Escape handler scope, and files-touched are never named**

The plan says Escape disarms but not where the listener lives — a focused cell
button needs a document-level `keydown` (added/removed with the armed state).
Separately, the plan describes "render paths" but never names the files it will
modify; for a ticket whose stated risk is a same-file collision, the file list is
the part worth writing down.

## 4. Positive Observations

- **The core architectural call is the right one.** "Extract one placement
  operation … drag-drop will parse its data transfer then call that operation" is
  exactly what the ticket demands ("the SAME placement API … Not a parallel path"),
  and it is what makes persistence, `If-Match`, conflicts, and audit come for free
  rather than being reimplemented and drifting.
- **The reserved-height status line** is a correct and specific reading of the
  DESIGN.md craft rule (`DESIGN.md:45`), and choosing an always-rendered
  `role=status` over a conditionally-mounted one is the detail that actually makes
  it announce — better than the existing `{notice && …}` region it sits beside.
- **Additive framing held throughout.** "without removing its draggable wrapper",
  "Preserve the existing drag target labels and drag handlers" — the plan never
  drifts toward replacing the mouse path.
- **The Accessible contract section** is worth keeping as a section. Writing the
  accessible names down *before* implementation is what lets a reviewer check the
  snapshot against something other than the implementer's memory.
- **The browser-validation authorization is scoped and recorded up front** —
  surface, server, data, and the "no external domain, credential, or account
  action" limit — rather than requested mid-run.
- **Breaks are correctly excluded** from Unplace ("breaks do not offer a false
  unplace action"), which matches both the tile's existing `draggable={session.kind !== "break"}`
  and the API's `submission_id` requirement.
