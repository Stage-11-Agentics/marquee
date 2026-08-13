# MRQ-140 — file-request tasks assigned via the speaker picker lose their session

## Confirmed premise

Read at the branch base (github/main). The ticket's root cause holds:

- `speaker_tasks.submission_id` is the only thing that drives the SESSION column
  (`files.queries.ts:162`) and the export's session folder (`files-export.routes.ts:78`).
- The assignment API already accepts `submission_id` (`task-templates.routes.ts:95`,
  validated at 634-638, written at 647), and the acceptance cascade already sets it
  (`jobs/cascade/decisions.ts:370-390`), which is why fixture/seeded tasks carry sessions.
- Neither door of the assignment UI ever sends it: `createTask` posts `assign_to` only
  (`TaskTemplatesPage.tsx:364`) and `assignTemplate` posts `template_id` + `person_ids`
  (`TaskTemplatesPage.tsx:408`). So every manually assigned task is born unattached.

One thing the ticket does not say: the API's `submission_id` is *batch-wide*, while the
picker assigns to many speakers at once. One session for N speakers is only right for
co-speakers of that session. The fix therefore has to resolve a session **per person**.

## Shape

1. **Server — per-person resolution** (`task-templates.routes.ts`). One query gathers each
   selected person's live sessions for this conference (participations join submissions,
   status not rejected/withdrawn — matching the assignee list's "does not wait for
   acceptance" rule). Then, per person:
   - an explicit choice from the new `session_assignments` body field wins;
   - else the existing batch `submission_id` (kept, so the API contract does not break);
   - else auto-attach when the person has **exactly one** session — the Marcus Okafor case
     the ticket says should never need a human;
   - else null, as today.
   Explicit choices are validated against that same set, so a deck cannot be filed under a
   session its speaker is not on. Both doors (create-with-`assign_to`, assign-existing) go
   through `assignmentStatements`, so both are fixed at once — as is the API for agents.
2. **`/task-assignees` gains `sessions: [{id, title}]`** so the picker can offer them.
3. **UI — a session control per selected speaker** in both the create form and the row
   assign panel. Exactly one session is preselected and labelled as automatic; two or more
   opens a select; none says so plainly. Sends `session_assignments`.
4. **Export honesty** (`files-export.routes.ts`): a task with no session lands in
   `No_Session_<Speaker>` rather than sharing `Unscheduled_<Speaker>` with sessions that
   exist but are not yet scheduled. The dialog already offers session grouping by default;
   it should not lie about why a file could not be placed.

## Tests

`tests/integration/api/task-session-link.MRQ-140.test.ts` — fails at base:
- assigning to a one-session speaker with no `submission_id` attaches that session;
- a two-session speaker stays unattached, and an explicit choice attaches;
- a choice belonging to another speaker/conference is refused (422);
- creating a template with `assign_to` attaches the same way.

`tests/node/task-session-link-ui.MRQ-140.test.mjs` — the page actually sends
`session_assignments` and renders the picker (source-contract style, as MRQ-96/114 do).

## Validation

`npx vite dev`, seeded demo: author a file task, assign it through the picker, confirm
/files shows the session, upload, and check the grouped export path.
