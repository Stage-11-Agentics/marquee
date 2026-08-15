# MRQ-194: A person_headshot attachment references a person the schema never declares, so no FK sweep sees it

Filed by #188's reviewer as a non-blocking observation during the MRQ-167 re-review, and
**correctly outside that PR's stated scope** — it swept declared foreign keys, and this is not one.

## The gap

`PERSON_REFERENCE_CHECKS` is built from the columns that declare a foreign key to `people(id)`. The
reviewer enumerated all **25 FK columns across 22 tables** by hand and confirmed the list is
complete against that definition.

`attachments.owner_id` is not on it, because it is not a declared FK. Verified in
`migrations/0001_init.sql`:

```sql
event_id   TEXT NOT NULL REFERENCES events(id),   -- line 108: a real FK on this very table
owner_type TEXT NOT NULL CHECK (owner_type IN (...)),
owner_id   TEXT NOT NULL,                          -- line 115: no REFERENCES
```

The control is on the same table: `attachments.event_id` **is** a declared FK two lines above, so
the extraction can see foreign keys here and `owner_id` genuinely has none.

**But when `owner_type = 'person_headshot'`, `owner_id` holds a `people(id)`.** It is a real
reference the schema does not declare — a polymorphic owner column, which SQLite cannot express as
an FK — so a person can be deleted while an `attachments` row still points at them, and no
FK-derived sweep will notice.

## This is a known wart, not a discovery

`CLAUDE.md:38` names it directly:

> Do not deepen the `attachments.event_id` wart: a person's headshot is org-level while the
> attachment row it points at is event-scoped.

Say this in whatever you write. The next reader should meet a documented soft coupling being made
visible, not think they have found something new — and the project has already decided not to
*deepen* this wart, which constrains the shape of an acceptable fix.

## What to do

1. **Make the reference visible to the sweep without declaring an FK it cannot have.** The
   `PERSON_REFERENCE_CHECKS` list is derived from declared FKs; a polymorphic owner needs an
   explicit entry with its discriminator — `attachments WHERE owner_type = 'person_headshot'` —
   rather than being invisible because the schema cannot say it.
2. **Enumerate the other polymorphic owners while you are here.** `owner_type` has a CHECK list
   (`person_headshot`, `task_upload`, `event_logo`, `import_file`, `draft_file`, `submission_file`)
   and each one points at a different table. Ask which of those are also silently outside a
   reference sweep, and report the ones you checked and **cleared**, not only the ones you add.
3. **Do not deepen the wart.** Per CLAUDE.md, this is not licence to add more event-scoping to an
   org-level relationship. If the honest fix needs a schema change, stop and say so on this ticket
   — migrations are the operator's, and the clearance given for MRQ-167's
   `0016_people_import_undo_receipts.sql` does not extend to another.

## Acceptance

- A `person_headshot` attachment is visible to whatever check governs person deletion or person
  reference-counting, with its discriminator explicit.
- The other `owner_type` values are enumerated and each recorded as covered or deliberately not.
- A regression test that deletes or dereferences a person holding a headshot attachment and asserts
  the intended behaviour, **paired**: assert the same operation on a person with no attachment still
  succeeds, so "everything is blocked" cannot pass for "the reference is seen".

## Constraints

- Cut your worktree from `github/main`. Verify:
  `if git fetch github; then if git merge-base --is-ancestor github/main HEAD; then echo current; else echo 'behind -- rebase'; fi; else echo 'FETCH FAILED -- not attempted'; fi`
- **Never `git stash` anywhere in this repo** — the stash stack is shared across every worktree.
- **Push when the work is written, before the verification run.**
- **A red gate is real.** `fail` from a findings-derived check is load-invariant; `pass-over-budget`
  is a warn; `timeout` is the only status contention can manufacture.
- Gate through `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/.gate-lock/gate-lock.sh`.
- Test titles start with `CONTRACT` or `AC-<n>`, then a middle dot.
- Do not deploy.
