# MRQ-190: The 'Add a session' Submitter field promises speaker-of-record context and never creates a speaking participation

Found by #212's reviewer (surface:166) while working the question I put on MRQ-185 — is the bare
em dash a filtering bug, or correct filtering over a data gap? It reconstructed the record instead
of guessing, and the answer changes what MRQ-185 means.

**I verified the load-bearing half in source myself before minting this. It holds.**

## The defect

`src/ui/submissions/CreateSubmissionPage.tsx:187` tells the organizer:

> This person is recorded as the submitter and **speaker-of-record context** for the new
> submission.

**That is false.** The form never creates a speaking participation.

Verified, three reads:

1. **The form's payload** (`CreateSubmissionPage.tsx:140-145`) sends `submitter_person_id` and
   nothing else. No `participant_ids`, no `speaker_person_ids`, no `participants`.
2. **`createSubmission`** (`submission-record.routes.ts:1028-1032`) only ever inserts
   `role = 'speaker'` from `participant_ids` / `speaker_person_ids` (`:1028`) or an explicit
   `participants` array (`:1029-1031`). The submitter field lands at `:1032` as
   `addParticipant(submitterId, "submitter", …)` — submitter, full stop.
3. So a session created through **Add a session** has a `submitter` participation and **no
   `speaker` or `co_speaker` row at all**.

## Why this is the root cause of MRQ-185 rather than a neighbour of it

`src/lib/participants.ts:40-44` filters the **public** audience to on-stage roles
(`speaker`, `co_speaker`, `moderator`, `chairperson`) while the **program** audience applies no
filter. So the admin builder tile shows the person and the public agenda card correctly does not
— and renders a bare em dash where the speaker line belongs.

**The public filter is right.** MRQ-185's diagnosis holds and its severity is right: it is an
empty-state defect, not a projection dropping a speaker. #212 fixes that empty state and should
land.

**This ticket is why the empty state keeps happening.** An organizer uses the admin tool, reads
the field's own promise, and produces a session that is speakerless on the public agenda. Nothing
tells them, and the surface that lied is not the surface that fails.

## Two candidate fixes — state the choice, do not assume it

1. **The field creates the speaking participation it claims to.** Matches operator expectation:
   the person named as speaker-of-record becomes one. Larger blast radius — every session created
   through this tool gains a speaker row, and you must decide what happens when the submitter is
   genuinely not a speaker (a chair filing on someone's behalf).
2. **The copy stops claiming it, and the form offers a separate speaker field.** Honest, smaller,
   and puts the decision where the organizer can see it.

Both are defensible; this is a product call. **Say which you are doing and why on the ticket
before you build it**, and if it is (1), say what you decided about the filing-on-behalf case.

## Evidence caveat — carry this, do not trim it

Round-9 data has since reset, so the reviewer **could not query the D1 row directly**. The chain
is screenshots plus spec plus source.

- **Load-bearing and directly readable:** that this form sends only `submitter_person_id`, and
  that `createSubmission` inserts only `role = 'submitter'` from it. I re-read all three sites
  above and confirm them.
- **Reconstruction:** that *Marcus Okafor specifically* was created this way. Round-9 screenshots
  show the judge going straight from record-created to tasks with no separate participant step,
  which fits, but it is inference.

**So verify the record shape before you build.** On a seeded event, create a session through
**Add a session** and query its participations — assert the roles you get, and pair it: assert a
session created *with* `speaker_person_ids` does produce a `speaker` row in the same test, so
"no speaker row" cannot be an artifact of the query rather than the code.

## Acceptance

- The **Add a session** flow and its copy agree: either a speaking participation exists after
  creation, or the copy no longer promises one and a separate control offers it.
- A session created through that flow renders a named speaker on the public agenda, or the
  organizer was told plainly that it will not.
- Regression test drives the real create route and asserts the participation roles, paired as
  above. Red on `main`, green on the branch.

## Constraints

- Cut your worktree from `github/main`, never local `main` — **and ignore `CLAUDE.md`'s worktree
  line in the primary checkout, which is still the stale copy.** Verify with the three-state check:
  `if git fetch github; then if git merge-base --is-ancestor github/main HEAD; then echo current; else echo 'behind -- rebase'; fi; else echo 'FETCH FAILED -- not attempted'; fi`
- **Never `git stash` anywhere in this repo** — the stash stack is shared across every worktree.
- **Push when the work is written, before the verification run.** A green gate on unpushed work is
  worth nothing to a successor; the verification can be re-run by anyone, the work cannot.
- Gate through `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/.gate-lock/gate-lock.sh`.
- Test titles start with `CONTRACT` or `AC-<n>`, then a middle dot.
- No migration without the operator. Do not deploy.
