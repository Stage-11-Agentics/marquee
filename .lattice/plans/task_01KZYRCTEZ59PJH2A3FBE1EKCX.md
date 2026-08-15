# MRQ-176: The roster does not list a speaker added by hand, and the FILES panel contradicts itself

Two round-9 defects (`runs/2026-08-13T22-25-26/judgements/speaker-management.json`), one
shape: **a count on the page contradicts what the page itself is showing.** Grouped because
the fix is the same discipline in two places, not because the code is shared.

**No rubric item punishes either — speaker-management scored 15/15 this round.** They are on
the list because an organizer who catches the roster lying about its own size stops trusting
every other number in the product, and this one repeated and got worse.

---

## Part 1 — a hand-added speaker is not on the roster (major, escalated from round 4)

### The judge's own words

> **`/roster` — speaker count header and status tabs after "Add speaker".** The roster's
> counts do not reflect a speaker added by hand. Before Marcus Okafor was created the tabs
> read All 509 / Pending 468 / Invited 4 / Confirmed 36 / Declined 1; after he was saved
> (his record opening with CONFERENCE STATUS = Invited) and after a subsequent full page
> reload the tabs still read All 509 with Invited unchanged at 4, and the total only moved
> to 510 when the CSV import created Dana Kowalski (Pending 468→+1). The header "N speakers
> on the roster for this conference — everyone who submitted, was accepted, was imported, or
> was added by hand" therefore undercounts, and **the hand-added speaker's row was never
> observed in the roster table** even though his record is reachable by URL, appears in the
> task-assignment picker and received the bulk email.

Round 4 recorded the same thing as a **minor** ("Roster totals do not visibly account for
newly added or imported speakers"). Round 9 is sharper and worse: this is not a stale
counter, the row is **absent from the list**. The person exists everywhere else in the
product and is missing from the one page whose entire job is to list him.

### What I checked, so you do not repeat it

The obvious cause is not the cause. `createSpeaker` (`src/routes/speakers.routes.ts:238`)
pushes `speakerMembershipStatement(...)` into its batch **unconditionally**
(`:324-331`), with `invitedAt` set when `body.invited` — which matches the observed
"CONFERENCE STATUS = Invited" on his record. The membership write is not skipped.

So look downstream of the write:

- `src/lib/roster-source.ts` — `SPEAKER_ROSTER_PERSON_SOURCE` is
  `memberships WHERE event_id = ? AND role = 'speaker'` UNION participations on submissions
  whose status is in `ROSTER_SUBMISSION_STATUSES`. A membership row alone is supposed to be
  sufficient. Confirm it actually is, for this row, with the values `createSpeaker` writes.
- `speakerMembershipStatement` (`src/lib/speaker-membership.ts:42`) is idempotent via a
  conflict clause. Check what happens when a row for that (event, person) already exists
  with a **different role** — `DO NOTHING` would leave no `speaker` row and produce exactly
  this symptom.
- The counts and the list may not read the same source. The header, the status tabs, and the
  table rows must all resolve from `SPEAKER_ROSTER_PERSON_SOURCE`; if any of them has its
  own query, that divergence is the bug and consolidating it is the fix.
- The contrast is the strongest clue you have: **the CSV import path did move the count**
  (Dana Kowalski, Pending 468→+1) and the hand-add path did not. Diff those two writes
  against each other before anything else.

### Acceptance

1. A speaker added by hand appears in the roster table **and** in the header count **and**
   in the correct status tab, on the response to the very next read — no manual refresh
   beyond normal navigation.
2. The status tab he lands in matches the CONFERENCE STATUS his own record shows. Today the
   record says Invited while the Invited tab does not move; those are the same fact and must
   never disagree.
3. Adding the same person twice does not double-count him.
4. A regression test that fails on `main` and passes on the branch, driving the real
   create-speaker route and then reading the roster list and counts — not a unit test of the
   membership helper, which already passes today.

---

## Part 2 — the FILES panel contradicts itself (minor)

### The judge's own words

> **`/roster` speaker record → FILES panel.** The FILES panel on a speaker record reads
> "0 of 1 requested file received." immediately above a listed, speaker-provided file
> (headshot.png, V1 OF 1, 569 B). The two statements read as contradictory to an organizer
> scanning the record for what has arrived.

Almost certainly correct-but-unreadable rather than wrong: the headshot is a
`person_headshot` attachment while the "1 requested file" is a `task_upload` deliverable, so
"0 of 1 received" is true of the deliverable and says nothing about the headshot listed
under it. That is a defensible model and an indefensible sentence — the organizer reads one
panel, not two data types.

### Acceptance

The panel never states a received-count that its own visible contents contradict. Either
count what is listed, or separate the two groups so each carries its own honest line (a
profile photo is not a requested deliverable and should not be filed as if it were).
Whichever you choose, an organizer scanning the panel must not have to know the schema to
read it.

---

## Constraints

- Your **own linked worktree**, created first:
  `git worktree add ../Marquee-worktrees/mrq-174-roster-truth -b mrq-174-roster-truth main`.
  Verify with `pwd` and `git branch --show-current`. Never the primary checkout (it is the
  Lattice board's home); never `mrq-auto-eval*`.
- **Never `git stash` anywhere in this repo** — the stash stack is shared across worktrees.
- **No migration without the operator.** If Part 1 turns out to need a schema change, stop
  and say so on this ticket rather than adding one.
- **Do not deploy.** An eval round is running; a `.deploy-freeze` marker sits at the primary
  checkout. Merging is wanted; deploying is not, and is not yours.
- **Elements never jump** — if a count or a line swaps, reserve its space.
- Gate serialized. macOS has no `flock(1)`; wrap it, e.g.
  `python3 -c 'import fcntl,subprocess,sys; f=open("/tmp/marquee-gate.lock","w"); fcntl.flock(f, fcntl.LOCK_EX); sys.exit(subprocess.run(["npm","run","pr-gate"]).returncode)'`
- PR: `gh pr create --repo Stage-11-Agentics/marquee --base main`.
