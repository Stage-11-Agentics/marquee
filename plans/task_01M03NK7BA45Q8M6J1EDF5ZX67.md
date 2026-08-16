# MRQ-224 — Participants finish end-to-end

Branch `mrq-224-participants`, cut from `github/main` at `bbb8e21e`.

## Reservations (declared to the adoption orchestrator, surface:513)

- **Migration `0028`** — one file, two columns.
- **US-82 + AC-270 – AC-272** — the reserved submitter/speaker split, promoted.
- **US-95 + AC-329 – AC-336** — the new multi-participant band. Next mint after
  this fold is **AC-337 / US-96**.

## Commits

1. **Role authority.** `src/lib/participants.ts` gains the named role sets and one
   exported primacy-ladder builder. Three fan-outs stop carrying their own literal
   lists: task reconcile (`decisions.ts:348`), calendar recipients (`invites.ts:249`),
   event membership (`speaker-membership.ts:97`). A moderator now holds work
   everywhere or nowhere.
   - `WORK_HOLDING_PARTICIPATION_ROLES` — the four on-stage roles. Tasks, membership.
   - `CALENDAR_PARTICIPATION_ROLES` — work-holding **plus `submitter`**. AC-328
     (landed by MRQ-228) binds the submitter as a calendar recipient by name; the set
     is derived from work-holding rather than typed out, so the two cannot drift.
2. **`task_templates.applies_to_roles`.** Migration 0028, schema row type,
   `copy-manifest.ts` verbatim list (**the inherited cloud finding — without it a
   conference clone silently resets every narrowed template**), route read/write,
   `reconcileTaskSet` honouring it, Settings › Tasks fixed-width role chips.
3. **Recipient split.** The decision ladder inverts to submitter-first (AC-223) via
   the extracted builder; exactly one decision email per submission stays true.
4. **Conflict truncation.** `agenda.queries.ts` loops every shared person instead of
   emitting `sharedPeople[0]` alone.
5. **Public role rendering.** `participation.role` into the public participant
   projection; the session card renders the label for non-speaker roles.
6. **Intake trust guard.** A public submitter can no longer rename an existing org
   contact by typing their address.
7. **Participant collection.** `submissions.participants_json` (migration 0028),
   the repeatable participant slots with a role select, and the on-behalf-of
   disclosure. `max_speakers` finally means what it says.
8. **Contract fold.** `SPEC.md`, `sequence/USER_STORIES.md`, `EVALUATION.md`.

## Open question for the operator (do not resolve by guessing)

MRQ-224 wants the moderator to hold `ICS + membership + roster row`. MRQ-111 holds
that the roster is the speaker list and excludes moderators — and `roster-source.ts`
UNIONs `memberships(role='speaker')`, so writing the membership row that gates portal
access **transitively** lists an accepted moderator on the roster. This build writes
the membership row (portal access is the ticket's stated defect) and does not touch
`speakerRosterPersonSource`. The consequence is recorded in
`speakers-roster.MRQ-111.test.ts` with its reasoning, and raised in the PR.
