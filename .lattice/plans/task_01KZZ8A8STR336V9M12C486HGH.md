# MRQ-196: Room 'newest first' orders by a position that resets per building, so it is not newest

Found by #218's second reviewer while confirming MRQ-183's newest-first room ordering. **Correctly
called pre-existing and non-blocking** — it did not hold the PR for it, and should not have. **I
verified the schema claim before minting.**

## The gap

`orderNewestFirst(rooms, room => room.position)` gives "highest position first". The ticket's
language — and the reviewer's, and mine — calls that **newest first**. Those are the same thing
only if `position` is venue-wide monotonic. It is not.

`migrations/0001_init.sql`:

```sql
CREATE TABLE rooms (
  building_id TEXT NOT NULL,
  position    INTEGER NOT NULL,          -- line 79: no uniqueness, nothing enforcing global order
  FOREIGN KEY (building_id, event_id) REFERENCES buildings(id, event_id),
);
CREATE INDEX idx_rooms_event_position    ON rooms(event_id, position);     -- line 733
CREATE INDEX idx_rooms_building_position ON rooms(building_id, position);  -- line 734
```

**Nothing constrains `position` to be unique or monotonic across the venue**, and the schema
carries a *building-scoped* position index alongside the event-scoped one — which is the
structural evidence that position is treated as an ordering **within** a building.

(Control: 39 `position` occurrences in that migration, so the search sees position columns
generally; the absence of a uniqueness constraint on this one is a real absence.)

## Why it matters, and why it is not urgent

**Today it is invisible.** The demo conference's rooms are effectively one venue, so local and
global order coincide and "newest first" does what it says.

**The moment someone adds a second building it becomes visible and wrong.** Room 1 of the new
building sorts against room 1 of the old one; a room created five minutes ago can appear after a
room created last month. The organizer sees an order that looks arbitrary, on the grid whose whole
recent fix was "put the column you just created where the eye lands."

**And MRQ-183 will look like the culprit**, because it is the change that introduced the ordering
and the language. It is not — the data model was always like this — but nobody reading the blame
will know that. That is the main reason to write this down now rather than when it bites.

## What to do

1. **Decide what "newest" should mean and make the data say it.** Either order by `created_at`
   (which is unambiguous and is what the word means), or make `position` venue-wide monotonic with
   a constraint that enforces it. Do not leave a field whose meaning depends on how many buildings
   exist.
2. **If `created_at` is the answer, say why in the code** — `position` is right there and the next
   person will assume it was the obvious choice and reach for it.
3. **Fix the language wherever it says "newest"** if the ordering ends up being something else.
   Half of this defect is that the code and the sentence disagree.
4. **Schema changes stop at the operator.** If (1) needs a migration, say so on this ticket and
   stop — one was cleared tonight for MRQ-167 and that clearance does not extend to another.

## Acceptance

- With rooms across **two or more buildings**, the grid's leading column is the most recently
  created room, and a test proves it — **paired**, so that a single-building conference still
  orders correctly in the same test. "It is sorted somehow" must not pass for "it is sorted by
  recency".
- Whatever ordering is chosen, the code's own words match it.

## Constraints

- Cut your worktree from `github/main`. Verify:
  `if git fetch github; then if git merge-base --is-ancestor github/main HEAD; then echo current; else echo 'behind -- rebase'; fi; else echo 'FETCH FAILED -- not attempted'; fi`
- **Never `git stash` anywhere in this repo** — the stash stack is shared across every worktree.
- **Push when the work is written, before the verification run.**
- **A red gate is real.** `fail` from a findings-derived check is load-invariant; `pass-over-budget`
  is a warn; `timeout` is the only status contention can manufacture.
- Gate through `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/.gate-lock/gate-lock.sh`.
- Test titles start with `CONTRACT` or `AC-<n>`, then a middle dot.
- **No migration without the operator.** Do not deploy.
