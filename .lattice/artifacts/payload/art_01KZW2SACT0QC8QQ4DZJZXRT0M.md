# Code Review: MRQ-141 — Agenda click-to-place

Reviewed at `eb6622e4` (PR #145 head, branch `v2-1-click-to-place`), against
`5441cf1c` (merged MRQ-148). Four files: `src/ui/agenda/AgendaPage.tsx`,
`src/ui/agenda/agenda.css`, one new unit test, one prop-signature fixup.

Checks I ran myself in the worktree:

- `npx tsc --noEmit` — clean.
- `npx vitest run tests/unit/agenda-click-to-place.MRQ-141.test.ts tests/unit/agenda-track-board.AC-78-81.test.ts` — 6/6 pass.
- `npm test` — 191/191 pass (113s wall, over the 45s budget; the machine is
  carrying a large fleet, and the runner itself reports `pass-over-budget`, not
  a defect).
- A throwaway `renderToString` of `RoomBoard` with the seeded shape
  (10 rooms × 3 days) to measure Issue 1 rather than assert it from reading.
  Scratch file removed; `git status` in the worktree is clean.

---

## 1. Verdict

**FAIL (implementation-level)**

The plan is sound and the central mechanism is right — one shared
`agendaPlacementRequest` behind both gestures, named cell buttons, a reserved
status line. But the Room view now renders a wall of 360 placeholder drop boxes
on every load whether or not anything is armed, which is a measurable visual and
payload regression on a scored surface and is not something the ticket asked
for. That plus the missing focus handoff after a placement — on the one ticket
whose entire purpose is a workable keyboard loop — is enough to send it back.
Both fixes are small and local.

## 2. Summary

The shared-write refactor is the right call and is executed cleanly: drag and
click-to-place genuinely converge on one function, so persistence, `If-Match`,
conflicts, and audit come along for free exactly as the ticket demanded. Named
`Place at {time} · {room}` buttons appear in all three room-bearing views, the
status line is always rendered so nothing jumps, and the delegator recorded a
real keyboard-only browser pass with an accessibility snapshot — the check the
ticket said not to skip. The blocking finding is collateral: making the Room
view addressable was done by rendering all 12 `TIME_SLOTS` per room-day
*unconditionally*, turning a 30-box surface into a 360-box one.

## 3. Issues

**[MAJOR] src/ui/agenda/AgendaPage.tsx:579-593 — Room view renders 360 unarmed "Drop at" placeholder boxes**

The new `.agenda-room-slots` grid maps all of `TIME_SLOTS` for every room × day,
and `DropCell` falls back to its `children` (`Drop at {time}`) whenever
`placementLabel` is undefined. So the boxes render even when nothing is armed.
Measured against the seeded event (10 rooms × 3 days × 12 slots): **360 boxes,
70KB of markup, for a completely empty room board** — up from 30 (`Drop at
16:00`, one per room-day) before this change. At `.agenda-room-empty`'s 38px
min-height in a 2-column grid that is roughly 250px of dashed placeholder per
room-day and ~760px per room lane, so the Room view reads as a field of empty
boxes with the actual sessions lost at the top of each lane. This is a DESIGN.md
craft regression and an R7 speed cost (360 `DropCell` instances, each carrying
its own `useState`), and none of it is needed: the ticket only requires the cell
buttons to exist *while a session is armed*.

The same construction also makes the surface lie. `roomSlotIsFree` gates only
the button, not the box — so a slot already holding a 10:00 session still
renders "Drop at 10:00" directly beneath that session, and it is now a live drag
target that did not exist before. The plan's point 3 says occupied room/time
combinations should not be targets.

**Fix:** gate the slot grid on arming and drop the occupied slots, keeping the
single pre-existing cell for the unarmed drag affordance:

```tsx
{armedPlacement && <div class="agenda-room-slots" aria-label={`Available times in ${room.name} on ${day.label}`}>
  {TIME_SLOTS.filter((time) => roomSlotIsFree(snapshot, day.value, time, room.id)).map((time) => <DropCell … />)}
</div>}
{!armedPlacement && <DropCell class="agenda-room-empty" ariaLabel={`Place Session on ${day.label} in ${room.name} at 16:00`} onDrop={(event) => onDrop(event, day.value, "16:00", room.id)}>Drop at 16:00</DropCell>}
```

Day and Week views already do the right thing — they only swap a cell's content
for a button when armed — so this is Room-view-only.

---

**[MAJOR] src/ui/agenda/AgendaPage.tsx:838-848, 875-897 — focus is dropped on the floor after every place, unplace, and Escape**

Activating a `Place at …` button disarms and reloads; the button unmounts and
focus falls to `<body>`. A keyboard organizer placing five sessions has to tab
back through the entire page five times. Same on `Unplace` (the tile
disappears) and on Escape (all cell buttons vanish at once). The `role="status"`
line announces the arm but nothing announces or anchors the *result*. For the
one ticket that exists to make the keyboard loop usable, "you can complete one
placement" is a lower bar than the ticket set — the verify script is place →
reload → conflict → move → clear → unplace, a five-step loop.

**Fix:** capture the arming element before the write and restore focus in the
`finally` of `place`/`unplace`. Cheapest correct version: keep a
`lastArmSource = useRef<HTMLElement | null>(null)` set in `armPoolItem` /
`moveSession` from `document.activeElement`, and after the write settles focus
either that element (if still connected) or the pool list container. Do the same
in the Escape handler.

---

**[MINOR] tests/unit/agenda-click-to-place.MRQ-141.test.ts:113-117 — the "shared placement operation" test asserts on source text, not behaviour**

```ts
expect(source).toMatch(/const request = agendaPlacementRequest\(current, payload, target, eventId\)/);
```

This reads `AgendaPage.tsx` off disk and regex-matches three statements. It
proves nothing about what the code does, breaks on any rename or reformat, and
would happily pass if `place()` were dead. It is also the only guard on the
single most important claim in the ticket ("the SAME placement API").

**Fix:** assert the behaviour instead — stub `apiFetch`, render `AgendaPage`,
drive both a drop and an armed cell click, and assert the two produced requests
(method, path, headers, body) are identical. If a full-page harness is too much
for the time left, at minimum assert `agendaPlacementRequest` is called with the
same arguments from both entry points rather than grepping the file.

---

**[MINOR] src/ui/agenda/AgendaPage.tsx:361-366 — `roomSlotIsFree` compares start times, so it breaks the moment MRQ-157 lands**

Freeness is `no session starts at exactly this time in this room`. That holds
today only because `TIME_SLOTS` is hourly and format max duration is 60 min. The
ticket names MRQ-157 (15-minute increments) as the next link in this chain and
says it "composes with the 'Place at {time}' buttons this ticket creates" — at
15-minute granularity this function will offer "Place at 10:15 · Room 2A" in the
middle of a 45-minute session already running from 10:00, and the button will
happily create the double-booking.

**Fix:** compare against the occupied interval, not the start instant:

```ts
const slotStart = zonedStart(day, time, snapshot.event.timezone);
return !snapshot.sessions.some((session) =>
  session.room_id === roomId
  && slotStart >= session.starts_at
  && slotStart < session.starts_at + session.duration_min * 60_000);
```

Worth doing now (it is three lines) so MRQ-157 inherits a correct predicate
rather than a latent bug.

---

**[MINOR] src/ui/agenda/AgendaPage.tsx:1092 — disabling the Track tab while armed traps the organizer**

`disabled={candidate === "track" && Boolean(armedPlacement)}` goes beyond the
plan, which said only that *arming from* the track view should redirect to Day
(which `armPlacement` already does correctly). Arming a session now removes a
navigation option, and the only way back to Track is to discover Escape. A
disabled tab in a `role="tablist"` is also a mild a11y smell — it leaves the
tablist with a permanently unreachable tab rather than an unselectable one.

**Fix:** leave the tab enabled and clear `armedPlacement` when the organizer
switches to `track`, or let them switch and re-redirect on the next arm. Keep
the tooltip copy as the explanation either way.

---

**[MINOR] tests/unit/agenda-click-to-place.MRQ-141.test.ts:113-170 — no negative-case coverage**

Every assertion is on the armed, free, happy path. Nothing fails if the cell
buttons render when *unarmed* (the regression in Issue 1's neighbourhood),
if an occupied cell offers a placement button, if the status line stops being
always-rendered (the "elements never jump" requirement), or if Escape stops
disarming. There is also no assertion anywhere that the pool card is still
`draggable` with a live `onDragStart` now that its whole body is wrapped in a
`<button>` — and "DRAG MUST KEEP WORKING" is an explicit ticket requirement.

**Fix:** add three cheap render assertions — unarmed `DayBoard` contains no
`Place at`; a `DayBoard` whose snapshot has a session at 10:00 in Room 2A offers
no `Place at 10:00 · Room 2A`; the always-rendered
`.agenda-placement-status` `role="status"` is present with `armedPlacement:
null`. Plus one asserting the pool `<article>` keeps `draggable`.

---

**[MINOR] src/ui/agenda/AgendaPage.tsx:1006 — pool header chip resizes on arm**

`<Chip>{armedPlacement ? "Choose an open cell" : "Drag back here to unplace"}</Chip>`
swaps a 24-character label for a 19-character one, so the chip changes width the
instant a session is armed. The global craft rule is explicit that relabeling
must not change an element's size. The status line below it was correctly given
reserved height; this one was missed.

**Fix:** give `.agenda-pool .card-head .chip` a `min-width` sized to the longer
string, or keep the chip copy constant and let the status line carry the state.

---

**[MINOR] src/ui/agenda/AgendaPage.tsx:876 — a drop during an in-flight write is silently discarded**

`place()` returns early on `placementBusy || autoPlaceBusy` with no notice. For
the click path this is invisible because the button renders `Placing…` and is
disabled, but a drag started while an auto-place or a prior placement is
resolving just does nothing — the tile snaps back with no explanation.

**Fix:** set a notice on the early return, e.g. `setNotice("Still saving the last
placement — try again in a moment.")`.

---

**[MINOR] src/ui/agenda/AgendaPage.tsx:322-325 — `Unplace` is a one-click destructive action with no undo**

Two 8px-font buttons sit adjacent on a dense tile; `Unplace` fires a `DELETE`
immediately. The drag equivalent required a deliberate drag across the board to
the pool. The state is recoverable (the submission returns to the pool and can
be re-placed), which is why this is minor rather than major, but the asymmetry
in effort between the two paths is real.

**Fix:** add an `Undo` action to the "Session returned to the unscheduled pool"
notice that re-POSTs the prior placement. Consistent with the no-save-button
philosophy and cheaper than a confirmation dialog.

## 4. Positive Observations

- **The shared-write extraction is exactly what the ticket asked for and is done
  honestly.** `agendaPlacementRequest` returns a description of the write rather
  than performing it, which lets both gestures go through one `mutate` call
  while staying a pure, directly testable function. The ticket's "not a parallel
  path — the same one" is genuinely satisfied, not gestured at. Returning `null`
  for a vanished session, and turning that into a real operator message
  ("That Session is no longer available to place. Refresh…") instead of the old
  silent `return`, is a small improvement over what was there before.

- **`roomSlotIsFree` reads `snapshot.sessions`, not the track-filtered `sessions`
  prop.** That is the subtle correct choice: a session hidden by the active track
  filter still occupies its slot, so the surface never offers a placement into
  an apparently-empty cell. Easy to get backwards; it wasn't.

- **The Track-view redirect is thoughtful rather than expedient.** The comment
  explains *why* (time × track has no room dimension), and `moveSession` passes
  the session's own day through so the redirect lands on the right board instead
  of day zero.

- **Layout stability was actually designed for.** The status line is always in
  the DOM with a reserved `min-height` and only gains its accent treatment when
  active — the DESIGN.md rule applied correctly, not just referenced.

- **The disarm predicate is precise.** `setArmedPlacement((armed) => armed?.payload.kind === payload.kind && armed.payload.id === payload.id ? null : armed)`
  clears only the placement that actually completed, so a drag of some other
  tile while a session is armed does not silently cancel the arm. Notably, arming
  is deliberately *not* cleared on error, so a failed write leaves the organizer
  able to retry — the right call.

- **The delegator did the validation the ticket demanded and reported it
  specifically**, including the conflict panel going 7 → 9 → 7 and the literal
  accessibility node (`button "Place at 12:00 · Metropolitan Ballroom"`), and was
  straight about the c11 WebView timing out and Chrome being used instead. That
  is the evidence standard this repo wants.

- **The `AC-78-81` prop fixup was made rather than worked around** — two lines,
  keeping the existing MRQ-21 test honest against the new `SessionTile`
  signature instead of loosening its types.
