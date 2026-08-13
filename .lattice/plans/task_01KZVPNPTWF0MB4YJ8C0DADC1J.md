# MRQ-141: Click-to-place agenda sessions

## Scope

Implement a non-mouse peer to agenda drag-and-drop on top of merged MRQ-148
(`5441cf1c`). The surface must keep drag intact while making the scheduler
actionable to keyboard users and accessibility-tree agents. This ticket owns
click-to-place, move, and unplace; it does not widen time resolution or change
the agenda API.

## Implementation

1. Give the page one `armedPlacement` state containing the existing placement
   payload plus the selected title. Pool-card activation arms a pool payload;
   `Move…` arms a scheduled-session payload; Escape clears it. A fixed-height,
   polite status line says `Placing: {title}` while armed and keeps its space
   when idle.
2. Extract one placement operation that accepts a payload and a target
   (`day`, `time`, `room`, optional `track`). Drag-drop will parse its data
   transfer then call that operation; a named cell button will call the same
   operation with the armed payload. The operation keeps the current POST/PATCH
   routes, `If-Match` handling, optimistic error wording, reload, persistence,
   and conflict behaviour.
3. Make each free slot in the Day, Week, and Room render paths a native button
   only while a session is armed. Its accessible name is `Place at {time} ·
   {room}`. Times come from `TIME_SLOTS`, so MRQ-157 can widen them without
   this code hardcoding hours. Occupied room/time combinations remain session
   content, not targets. The Track view has no room dimension, so arming there
   takes the organizer to the Day view rather than offering a false target.
4. Make each unscheduled tile a native button (click and Enter arm it) without
   removing its draggable wrapper. Give each scheduled non-break tile `Move…`
   and `Unplace` controls. Route unplace through the same DELETE operation used
   by dropping a session back into the pool.
5. Add focused contract tests for the shared placement request path and the
   rendered accessible controls. Preserve the existing drag target labels and
   drag handlers.

## Accessible contract

- Idle pool cards expose native buttons that announce their session title and
  current armed state.
- Armed state is announced by an always-rendered `role=status` line; clearing
  it leaves the line in place.
- Available target cells expose `<button type="button">` controls with an
  explicit, action-first label. Escape exits this state without a write.
- Scheduled session controls expose `Move…` and `Unplace`; breaks do not offer
  a false unplace action.

## Browser validation authorization

Authorized by the operator on 2026-08-12: use a c11 browser surface in the
workspace's right pane against this worktree's local Vite/Worker server only.
Use seeded demo data, make only the agenda writes required by this validation,
and use no external domain, credential, or account action.

## Verification

Run targeted tests and the project PR gate. In the local browser, keyboard-only:
place an unscheduled session; reload; create and clear a same-speaker conflict
via Move; reload; unplace. Inspect the accessibility tree/DOM to confirm named
cell buttons in every placement view. Record observed results on the ticket and
in the PR body before opening the PR.
