# MRQ-242 implementation plan

## Outcome

Give authenticated conference staff an append-only, org-scoped internal note
seam on a submission. A note is attributed from the authenticated seat's
existing people row, is never editable, is never sent to the submitter, and is
visible to another authorized organizer on the same submission. Keep the Notes
card at a stable position while empty, loading, and populated states resolve.

The implementation includes the ticket's complete cut: staff GET/POST routes,
the CLI verbs and shipped SKILL parity, the evaluation empty-state CTA, and the
no-email decision refusal fix path. MRQ-249 depends on this seam, so the PR
handoff will name the durable table and route contract explicitly.

## Contract and allocation boundary

The current unminted acceptance draft has exactly six criteria:

1. A fresh conference with no evaluation plan saves a note in one action and
   creates no evaluation row.
2. A second authorized organizer reads the note with the first organizer's
   people attribution.
3. A sentinel note is absent from speaker-facing, public, and outbound
   surfaces.
4. The card's neighboring geometry is stable in empty, loading, and populated
   states.
5. The evaluation empty state exposes a working link to `/evaluation`.
6. A no-email accept/deny refusal names the missing address and links to the
   person record for repair.

The allocation is now fixed: story **US-96**, criteria **AC-337 through
AC-342**, and migration **0029** for the `submission_notes` table and its
`(submission_id, created_at)` index. MRQ-224 owns migration 0028 and AC-329
through AC-336. Before final exact-head review and the full gate, rebase over
the landed MRQ-224/main contract and resolve the branch as an additive union.
If the count changes, stop before minting outside AC-337 through AC-342 and
report it to the Adoption Orchestrator.

## Implementation phases

1. Baseline the worktree and inspect the canonical seams: submission routes,
   staff auth/person resolution, `SubmissionRecordPage`, decision cascade,
   CLI command registry and SKILL chapter, migration/delete plans, wipe/seed
   helpers, and existing route/integration/UI test fixtures. Run the focused
   baseline tests before editing.
2. Add migration **0029** with the exact foreign keys and cascade:
   `submission_notes(id, submission_id, author_person_id, body_md, created_at)`.
   Add the submission index, `WIPE_ORDER`/delete-plan coverage, schema-delta
   receipt, and event-delete behavior. Keep the table append-only: no update or
   delete route, and no event-scoped or speaker-facing duplicate.
3. Add authenticated `GET` and `POST
   /api/v1/submissions/:id/notes` routes using the existing staff authorization
   and authenticated-seat-to-org-scoped-people resolution. Validate non-empty
   note bodies, scope reads/writes to the submission's organization, order
   newest-first, and return the author display data needed by the card. Ensure
   no decision/evaluation/outbox write is reachable from the note path.
4. Add the Notes card beside Decision history on `SubmissionRecordPage`. Render
   one fixed card frame for all three states; use the exact safety label
   "Write an internal note — never sent to the speaker", newest-first metadata
   (`name · time · text`), one-action save, and an explicit "No notes yet."
   empty state. Preserve fixed skeleton dimensions and avoid list/card jumps.
5. Add the CLI note commands through the existing registry and API client
   conventions, with help/examples matching the staff route. Update the
   shipped SKILL triage guidance to describe internal notes as append-only,
   attributed, and never speaker-visible. Keep CLI and route behavior aligned.
6. Replace the evaluation empty-state dead text with a real `/evaluation` CTA.
   Repair the no-email accept/deny refusal so it names the missing address and
   links to the owning person record, without sending or creating a misleading
   decision/outbox row.
7. Add tests named with **AC-337 through AC-342**: migration/schema
   and delete-plan checks; route integration for one-action write/read,
   attribution, org isolation, append-only behavior, no evaluation-row delta,
   and sentinel absence from speaker/public/outbound projections; UI tests for
   all three card states and the CTA; CLI/SKILL parity; and the no-email fix
   path. Add positive controls proving ordinary decision/evaluation behavior
   still works.
8. Commit and push each meaningful increment. After MRQ-224 lands on main,
   fetch and rebase this branch over the landed contract, resolving any
   conflict as an additive union; rerun `npm ci` after the rebase. Complete
   self-review or one fresh reviewer over the post-rebase HEAD, attach a PASS
   review artifact, request and receive the serialized full `pr-gate` slot from
   `merge-captain`, and enter `in_validation`. Run the real local Worker flow
   with two seats: organizer A posts the sentinel note, organizer B reads the
   attributed note, and inspect evaluation rows plus speaker/public/outbound
   responses. Attach that running evidence, create the GitHub PR, attach its
   URL, and stop at `pr_open`.

## Verification and handoff evidence

- Record the exact branch HEAD, `github/main` base, test commands and status
  fields, review commit, serialized gate result, and runtime URLs/responses.
- Separate static/unit evidence, running-system evidence, and inference. Do
  not claim deployment or merge; the Adoption Orchestrator owns those stages.
- Report **US-96 / AC-337–AC-342 / migration 0029** and the MRQ-224 additive
  rebase anchor in the PR and Lattice artifacts. Report completion or
  recoverable blockers to the Adoption Orchestrator mailbox
  `adoption-orchestrator` and surface:513.
