# MRQ-164 — Three round-4 majors: the system holds the information and the organizer's surface drops it

Branch: `mrq-164-surface-drops-info` · worktree `../Marquee-worktrees/mrq-164`

## What the investigation found

The ticket's framing is right and its three diagnoses are each wrong in the same
direction: in every case the data layer is complete and something downstream of it
drops the information. Two of the three "where to look" pointers name a layer that
turns out to be correct.

### Part 1 — the co-speaker role is not the bug

Written first, as the ticket asked:
`tests/integration/api/agenda-cospeaker-conflict.MRQ-164.test.ts`, driving the judge's
exact scenario through the real API — add a `co_speaker` after intake, place both
sessions overlapping in different rooms, read the agenda snapshot.

**It passes on unfixed `main`.** The co-speaker path is genuinely correct end to end,
exactly as the ticket's five-layer trace predicted. Do not touch the role list.

The hole is on the *other* side of the judge's pair. The organizer's **+ Add session**
(`/submissions/new` → `POST /api/v1/events/{id}/submissions`) collects exactly one
person and records them with a single participation of role **`submitter`**
(`src/routes/submission-record.routes.ts:987`). The public CFP form, by contrast,
writes that same human twice — `submitter` *and* `speaker`
(`src/routes/public-form.routes.ts:267,283`), which is the behaviour
`src/lib/participants.ts:1-19` documents as the norm.

Consequences, which is why this reads as a co-speaker bug:

- Every organizer surface **prints** the person, because the `program` audience keeps
  submitters — that is why the judge's publish panel row read `… · Marcus Okafor`.
- `conflictParticipants` (`src/lib/conflicts.ts:43`) **excludes** `submitter`, so the
  detector does not believe anybody is on that stage.

The tile names a human; the detector says the session has nobody on it. That is the
ticket's thesis exactly, and it matches round 4's scenario: the eval created
"Lightning: Agents in Production Q&A" through this route
(`.eval-kit-agent/specs/04-content-management.yaml:47` — "create a NEW accepted session
owned by Marcus"), then collided it with a session Marcus co-speaks.

Second repro test added and **failing on unfixed main**: create a session through
`+ Add session`, place it overlapping, assert the agenda flags it.

**Fix:** in `conflictParticipants`, when a session has *no* participant holding an
agenda role, fall back to its `submitter`. Narrow on purpose:

- It makes the detector read the same population the organizer sees named on the tile.
- The fallback only fires when there is no speaking participant at all, so a session
  where someone submitted *on behalf of* a speaker keeps its single correct conflict
  and gains no false positive.
- It fixes records already in the database, which a change to the write path alone
  would not — and the deployed demo already holds such rows.

Rejected: adding `submitter` to `AGENDA_PARTICIPATION_ROLES` (false positives whenever
a submitter is not the presenter), and fabricating a `speaker` row at create time (it
invents a role the organizer did not choose, and leaves existing data broken).

### Part 2 — the columns are not hard-wired either

`onboarding.queries.ts:391` selects **every** `task_templates` row for the event, and
`speaker_tasks.template_id` is `NOT NULL REFERENCES task_templates(id)`
(`migrations/0001_init.sql:603`), so templates ⊇ tasks-that-exist. The UI renders one
column per `ready.task_templates` entry (`OnboardingPage.tsx:327`) — a newly authored
task **does** get a column, and the same list feeds the `TASK TYPE` facet the judge
found working.

The column is appended last (`ORDER BY position ASC`) inside
`.onboarding-matrix-wrap { overflow-x: auto }` over a table with
`min-width: max-content` (`onboarding.css:35,43`). With the conference's six original
columns already filling the width, the new one sits off the right edge with **no
affordance saying it exists**. A speaker whose only tasks are new — the judge's Marcus —
therefore shows a row of em dashes in the visible region while his real state is
scrolled out of view.

**Fix:** make the matrix admit its own width.

1. Pin the speaker column so horizontal scroll does not cost the row's identity.
2. State the count and direction above the grid ("N task columns · scroll for more"),
   shown only when the grid actually overflows.
3. Distinguish "no applicable task" from "unstarted" on the row, per the acceptance
   line: a row whose visible cells are all `unassigned` says so in words rather than
   reading as an untracked speaker.

### Part 3 — destructive import, and the product's own rule

`src/lib/sessionize-import.ts:481-497`. `next.title/company/bio` are `null` for a blank
CSV cell, and the UPDATE writes `next.*` wholesale, so a blank cell erases what the
speaker wrote in their portal. `speakers.routes.ts:264` already states the opposite rule
for the add-speaker path.

**Fix:** the import obeys the same rule — a blank CSV cell keeps the stored value.

**Product decision, stated in the PR:** a *non-blank* cell that disagrees with a stored
value is **last-write-wins**, and the row reason says which fields it overwrote and
which it kept. The import already ships a per-row outcome table and a Batch undo, so
the organizer can see the overwrite and reverse the whole batch; a per-field conflict
queue would be a second review surface nobody asked for.

Also in the file: the ROW DETAIL reason string claims `matched by normalized email` on
`created` rows, where nothing was matched, and says the same on a row matched by *name*.
Both corrected.

## Work

1. `src/lib/conflicts.ts` — submitter fallback when no participant holds an agenda role.
2. `tests/integration/api/agenda-cospeaker-conflict.MRQ-164.test.ts` — both repros
   (co-speaker path passing, `+ Add session` path failing→passing).
3. `tests/unit/agenda-conflicts.AC-76-77.test.ts` — unit coverage for the fallback and
   for the no-false-positive case.
4. `src/ui/onboarding/OnboardingPage.tsx` + `onboarding.css` — pinned speaker column,
   overflow affordance, empty-row honesty.
5. `src/lib/sessionize-import.ts` — blank-cell merge, honest row reasons.
6. Tests for 4 and 5.
7. Validation in a browser against `npx vite dev` for all three flows, attached to the
   ticket.

## Out of scope

Everything the ticket lists, plus: the `+ Add session` form collecting only a submitter
is arguably its own product gap (the page's copy says "submitter and speaker-of-record
context" while storing one role). Raised as a comment on MRQ-164 rather than widened
into here.
