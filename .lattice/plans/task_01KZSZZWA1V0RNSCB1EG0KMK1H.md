# MRQ-93: "Finalize talk description" shows a checkbox and no talk — the task never renders what it asks you to confirm

The "Finalize talk description" speaker task shows only an acknowledgement
checkbox — the talk description it names is nowhere in the task. Operator
feedback from the live site (2026-08-11): *"all I see is a checkbox for I have
read and acknowledged this task, but where is the actual talk description"*.

## What is happening

The task is seeded as `kind: "acknowledge"` — `scripts/seed/event.ts:351`:

    [TEMPLATE_IDS.finalizeDescription, "Finalize talk description", "acknowledge",
      "Confirm the abstract and title we will publish on the event site.", 10, null, null, 2, 0]

`PortalPage.tsx:275-277` renders every `acknowledge` task identically: one
checkbox reading *"I have read and acknowledge this task."* So a task whose whole
purpose is **review and confirm this specific text** presents no text, no editor,
and no route to one.

The talk description *is* editable in the portal — `TalkCard` (PortalPage.tsx:388)
has a title + description form behind an "Edit talk" toggle, gated on
`submission.talk_editable`, saving to `PATCH /api/v1/me/submissions/:id/talk`. It
just lives in a different panel further down the page, with nothing connecting the
two. The speaker is asked to confirm something they are never shown.

This breaks the product's own principle — the system does the chase work, and a
task should carry what it asks for. It is also on the walkthrough path.

## What it should be

Make the task self-sufficient. The speaker should be able to complete
"Finalize talk description" without hunting the page:

- **Show the talk.** The task renders the current title and description it is
  asking about — the actual text, not a reference to it.
- **Let them fix it in place.** Editing is the point of "finalize"; a speaker who
  reads their abstract and spots a typo should not have to scroll away and find a
  second editor. Reuse the existing edit path (`PATCH /api/v1/me/submissions/:id/talk`)
  and the existing `talk_editable` gate — do not add a second write route or fork
  `TalkCard`'s form. Factor out what both need.
- **Acknowledge means something.** The confirm control should read as confirming
  *this abstract*, not "this task". Rewrite the copy accordingly.
- **Respect the gate.** When `talk_editable` is false (CFP closed), show the text
  read-only with the reason, matching `TalkCard`'s existing "Closed" behavior.
- **Don't strand the general case.** Other `acknowledge` tasks ("Announce your
  participation", "Invite colleagues") have no subject to show and must keep working
  unchanged. The task's `submission_id` is the natural hook for a subject-bearing
  variant; a bare `acknowledge` keeps today's checkbox.

Decide and state in the PR whether this is a **new task kind** (e.g. `confirm_talk`,
seeded and typed end to end) or a **presentation-level specialization** of
`acknowledge` keyed on the template. The specialization is the smaller, lower-risk
change and is likely right given the deadline; a new kind is cleaner but touches
the schema CHECK constraint, the route zod enums, and the seed. Pick one, justify
it in a sentence, do not do both.

`Finalize bio & photos` (`scripts/seed/event.ts:354`) has the identical defect — it
asks a speaker to review a bio and headshot it never shows, and the profile editor
lives in yet another panel. **Fix it the same way in this ticket** if the chosen
approach generalizes cleanly; if it does not, say so and leave a note rather than
half-doing it.

## Constraints

- Flight Deck aesthetic per `DESIGN.md`; reuse existing portal form/field classes
  rather than new one-off styles.
- **Elements never jump** (global UI rule): entering and leaving edit mode must not
  shift the rest of the task list — reserve the space.
- Suite budget 45s, gate budget 120s.

## Acceptance

- Opening "Finalize talk description" in the speaker portal shows the actual talk
  title and abstract inside the task.
- A speaker can edit and save from within the task, and the saved text appears in
  `TalkCard` and on the public site without a reload dance.
- The confirm control's copy refers to the abstract, not to "this task".
- With the CFP closed, the text is visible read-only with a stated reason and no
  edit affordance.
- Other acknowledge-only tasks are visually and functionally unchanged.
- Validated on the **live deployed site** at https://marquee.stage11.dev as a
  speaker, with a screenshot in the PR.
- `npm test` green within budget; PR open against `Stage-11-Agentics/marquee` `main`.

## Delegator plan (MRQ-93)

### Decision

Use a presentation-level specialization of the existing `acknowledge` kind,
keyed by the seeded `template_id` values for `Finalize talk description` and
`Finalize bio & photos`. This preserves the existing task schema, completion
route, and generic acknowledgement behavior while keeping the change inside
the portal presentation boundary; no new task kind or schema enum is needed.

### Implementation

1. Add the task template identity to the portal task view and pass the existing
   portal snapshot subject data (`submissions` and `person`) into the expanded
   task surface. Generic acknowledgement tasks remain on the current checkbox
   path.
2. Extract the existing talk edit controls into a shared talk editor/view used
   by both `TalkCard` and the specialized task. The task will show the current
   title and abstract, use the existing `PATCH /api/v1/me/submissions/:id/talk`
   route, call the existing refresh callback after save, and show the existing
   closed-state reason with no edit affordance when `talk_editable` is false.
3. Extract the reusable bio/headshot profile fields and save flow from
   `ProfileEditor` so the bio/photo task can show the current bio and headshot
   state and edit through the existing `PATCH /api/v1/me/profile` plus shared
   upload lifecycle. Do not add a task-specific route or weaken the existing
   attachment checks; the existing media path intentionally serves uploads as
   downloads, so the task will make the current headshot state explicit and
   provide the same in-place replacement control.
4. Keep the generic acknowledge renderer and all other task kinds unchanged.
   Use existing portal field/button classes and reserve a stable subject/editor
   block height so toggling a specialized task's edit mode does not move the
   following task rows.

### Verification and delivery

- Add/extend the portal integration and source-level UI contract coverage for
  talk subject rendering, shared-route persistence, closed read-only behavior,
  profile specialization, and unchanged generic acknowledgement behavior.
- Run the baseline and final `npm test` within the 45s suite budget, then run
  the repository PR gate as appropriate for the final head.
- Exercise the deployed speaker portal at
  `https://marquee.stage11.dev`: open both subject-bearing tasks, verify the
  talk text and confirmation copy, edit/save a harmless speaker-owned value,
  verify the TalkCard/public result, and verify the closed-state/read-only
  behavior if the deployed seeded state provides it. Capture a screenshot of
  the working talk task in the PR evidence.
- Commit only MRQ-93 product/test changes plus the MRQ-93 Lattice artifacts,
  push the branch to `github`, and open (do not merge) a PR against
  `Stage-11-Agentics/marquee` `main` with the specialization decision and
  live-site evidence. Note unrelated live-site defects in Lattice only.

### Non-goals

No new task kind, migration, alternate write route, generic acknowledgement
redesign, or fixes for defects owned by other tickets.
