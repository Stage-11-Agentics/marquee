# MRQ-82: Acceptance reversal is not recorded in Decision History

Reversing an acceptance leaves no trace of itself. Evidence: `sequence/UX-SWEEP-FINDINGS-PASSB.md` (Flow 2), screenshot `B-organizer-submission-reversed-DEADEND.png`.

## What was seen

Accept a submission, then apply an acceptance reversal from the record's Acceptance Reversal panel (any branch combination). Decision History still shows count **1** — only the original "Accepted · AIE Program Committee". There is no second entry recording that the decision was reversed, by whom, when, or with which branch choices (tasks cancelled or kept, emails cancelled or retained, invite cancelled or retained, resulting status Withdrawn or Rejected).

A withdrawn record therefore carries no visible audit trail of its own reversal. An organizer looking at it later cannot tell whether it was never accepted or was accepted and then pulled — and cannot tell what happened to the speaker's tasks and mail as a consequence.

## Why this matters

The reversal cascade is a consequential, multi-branch, speaker-visible action: it can cancel a real person's portal tasks, kill queued mail, and send a calendar cancellation. Every other decision on this record writes to Decision History. This one does not, so the most destructive action available on the screen is the only one that leaves no record.

## Scope

Record the reversal as a Decision History entry alongside the decisions it reverses: who, when, resulting status, and the branch choices taken. The existing decision-history rendering already handles entries generically (`src/ui/submissions/SubmissionRecordPage.tsx`), so this is likely a write-side gap rather than a new surface.

Confirm first whether the reversal already writes a row that the history query filters out — if the data exists and is merely unselected, this is a read fix, not a write one. Check `src/routes/submission-reversal.routes.ts` and how `decisions` is assembled in `src/routes/submission-record.routes.ts` before adding any write.

## Constraints

- Deliberately LOW priority: audit completeness, not a walkthrough blocker. Do not let it displace MRQ-79 or MRQ-76.
- No migration if the existing decision/audit tables can carry it. `submission_decisions` already exists.
- Never surface a raw error string or SQL to an organizer; match the existing history idiom and voice.
- Test titles must begin `AC-<n> · ` or `CONTRACT · ` or `trace:ac` fails.

## Verification

Accept a record, reverse it, and confirm Decision History shows both entries in order with the reversal's branch choices legible. Confirm a record reversed twice reads correctly. Confirm nothing changes for records that were never reversed.

## File ownership

Coordinate before starting: `src/routes/submission-record.routes.ts` is owned by MRQ-76 until it merges. Do not begin this ticket while MRQ-76 is open unless the work is confined to `src/routes/submission-reversal.routes.ts`.
