# MRQ-86: An already-decided record gives no signal that a decision is locked in

Evidence: `sequence/UX-SWEEP-FINDINGS.md` (Pass A), `/submissions/sub_what-rl-means-for-agents`.

## What was seen

The record is already `Accepted` and `Scheduled`, yet the **Record action** card shows live **Accept / Maybe / Reject** buttons with no visual indication a decision was already made. An organizer reading the screen cannot tell at a glance whether they are making a first decision or changing an existing one.

## What is NOT the bug

The re-decide affordance itself is **intentional**. MRQ-83 (PR #21) deliberately restored decision buttons on declined/waitlisted/withdrawn records precisely so an organizer can change their mind, and `can_decide` (`submission-record.routes.ts:418`) now includes `declined`. **Do not undo that.** Do not add a confirmation step — the decision dialog is already one, and R7 grades speed.

## Scope

The gap is the *cue*. Add the smallest honest signal that the buttons are a re-decision rather than a first decision, in DESIGN.md Flight Deck tokens and voice. The card header already carries a `.subtle` slot (`SubmissionRecordPage.tsx:143`) whose copy is currently unconditional; `record.decisions` is already on the payload, ordered newest-first (`submission-record.routes.ts:245`), so the latest decision and its date are in hand with no API change.

Out of scope: a new confirmation step, disabling the current decision's button, any change to `can_decide`, and any new API field.

## Constraints

- **Elements never jump** (DESIGN.md). A swapped string must reserve its space — the header must be the same height decided and undecided, and must not grow when a decision is taken on-screen.
- No API change, no migration.
- Organizer-facing copy: plain language, no field names, no status slugs. `Maybe` is the waitlist's display name.
- Test titles must begin `AC-<n> · ` or `CONTRACT · ` or `trace:ac` fails.

## Verification

An undecided record and a decided record side by side in a browser: the decided one names its decision, the undecided one does not, and the two card headers are the same height. Take a decision on-screen and confirm the card does not change size.

## File ownership

OWNS: `src/ui/submissions/SubmissionRecordPage.tsx`, `src/ui/submissions/record.css`, its own tests. Must not touch `src/ui/public/form/PublicForm.tsx` (MRQ-81) or `BOARD_STAGE_SQL`.
