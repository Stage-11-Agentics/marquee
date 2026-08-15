# MRQ-191: readPool offers a Place button on abstracts: the same implicit kind filter #207 lost, in a second consumer

Found by #207's reviewer (surface:157) while verifying that PR's fix. **Same defect, second
consumer, untouched by #207 and deliberately out of its scope.** I verified it in source before
minting.

## The defect

`readPool` (`src/routes/agenda.queries.ts:412`) feeds the agenda builder's unscheduled pool. Its
`WHERE` filters on `submission.event_id`, `submission.status IN (…)`, and `NOT EXISTS` an agenda
item — and **never on `submission.kind`**:

```sql
FROM submissions submission
LEFT JOIN formats format ON …
WHERE submission.event_id = ?
  AND submission.status IN (…)
  AND NOT EXISTS (SELECT 1 FROM agenda_items item WHERE … AND item.kind = 'session')
```

Note it **selects `submission.kind` in its own projection** and then does not filter on it. The
data is right there.

**Consequence, observed rather than reasoned:** an accepted `kind='abstract'` submission appears
in the unscheduled pool **with a working "Place" button**. The organizer presses it and the
scheduler refuses with `422 "only Sessions can be placed on the agenda"`. An action is offered
that cannot succeed.

## The shape, which is the reason this is worth a ticket rather than a one-line patch

`#207` fixed the identical hole in `readAgendaPublication`. Both had the same history: the
constraint was **provided implicitly by an INNER JOIN through `agenda_items`** — only sessions
have agenda items, so only sessions could appear — and it was never written down as a predicate.

**When a constraint is supplied implicitly by a join, every consumer that changes its join loses
that constraint independently, and none of them can see the loss.** There is no diff in which the
predicate disappears, because it was never there. That is why fixing one consumer says nothing
about the others.

**So do not fix only the one we found.** Enumerate the readers first:

- every query in `agenda.queries.ts` that reads `submissions` for a scheduling or publication
  purpose, and any that moved from `FROM agenda_items … JOIN submissions` to `FROM submissions …
  LEFT JOIN agenda_items`;
- anything else offering a Place, Schedule or Publish affordance;
- and — pair the search — confirm your pattern finds the two we already know about
  (`readAgendaPublication`, now fixed, and `readPool`) before trusting it to have found
  everything. An empty result from a search that cannot see the known cases is worth nothing.

Report what you enumerated on the ticket, including the readers you checked and cleared. A list
of "these are fine" is the evidence that the sweep happened.

## Where the predicate belongs

`#207`'s reviewer flagged this and it applies here too: put `AND submission.kind = 'session'` in
the **outer `WHERE` against the submissions row**, not in a `LEFT JOIN … ON` clause. On a LEFT
JOIN those are different queries, and the ON-clause version is the way a correct-looking one-line
fix goes silently wrong.

## Acceptance

- An accepted `kind='abstract'` submission does not appear in the unscheduled pool and is offered
  no Place affordance.
- A real accepted, unscheduled **Session** still appears, still placeable — assert this in the
  same test as a positive control, so "the pool is empty" cannot pass for "abstracts are
  filtered".
- Any other reader found by the enumeration is fixed in the same PR or explicitly listed as
  checked-and-clear.
- Regression test red on `main`, green on the branch.

## Constraints

- Cut your worktree from `github/main`, never local `main` — **and ignore the worktree line in the
  primary checkout's `CLAUDE.md`, which is still the stale copy.** Verify with the three-state
  check: `if git fetch github; then if git merge-base --is-ancestor github/main HEAD; then echo current; else echo 'behind -- rebase'; fi; else echo 'FETCH FAILED -- not attempted'; fi`
- **Never `git stash` anywhere in this repo** — the stash stack is shared across every worktree.
- **Push when the work is written, before the verification run.**
- Gate through `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/.gate-lock/gate-lock.sh`.
- Test titles start with `CONTRACT` or `AC-<n>`, then a middle dot.
- No migration. Do not deploy.
