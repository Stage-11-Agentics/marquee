# MRQ-101: Submission record: the breadcrumb is dead, the title is rendered twice, and a rejected record still offers a Reject button

The submission record is the screen the walkthrough video spends the most time
on, and three things about it read wrong to the operator on the live site
(2026-08-12). All three live in one file, so they are one ticket.

## 1. The breadcrumb is not a breadcrumb

`src/ui/shell/Topbar.tsx:14`:

    <div class="breadcrumbs">{eventName}&nbsp; / &nbsp;<strong>{routeName}</strong></div>

It renders as `AIE NYC 2026 / Submission record` but it is a plain `<div>` —
nothing in it is clickable. The operator kept trying to use it:

> *"I keep wanting to click the AIE NYC 2026 to the left of the slash to return
> to whatever screen I was in. So for example, inside of submission record, I
> want to click that to go back."*

**Required outcome.** Make the breadcrumb a real one, with a middle crumb:

    AIE NYC 2026  /  Submissions  /  Submission record

- `AIE NYC 2026` → `/dashboard` (Program home).
- `Submissions` → `/submissions` (the list). Only for routes that sit under
  submissions; do not invent a false parent for routes that have none.
- The trailing crumb stays the current route name, not a link.

**Then delete the redundant "Back to submissions" button** at
`SubmissionRecordPage.tsx:152`. Operator decision, asked and answered: the
breadcrumb replaces it, so there is one obvious way back instead of two controls
six inches apart. Keep the button on the **error** state (line 149) — there is no
record there to breadcrumb from.

**Ownership warning.** MRQ-99 / open PR #53 makes the *sidebar* conference name
link to the dashboard (`src/ui/shell/Sidebar.tsx`). Same destination, different
element, and that is fine — but **do not touch `Sidebar.tsx`**. Rebase onto
`github/main` immediately before opening your PR; #53 also touches this file.

## 2. The record title is rendered twice

`SubmissionRecordPage.tsx:152` puts `record.title` in the gray `PageHeader`.
Line 155 puts the *same* `record.title` in the white summary card, under the
`Program record` eyebrow. The operator read the duplicate as a layering mistake:

> *"Right now, 'Governing financial AI across regulated teams' — might as well
> move that into the white box, because outside in the gray it seems like it's
> more related to subtitles or admin. Inside of the white box is where the
> content of that specific item is."*

He is describing a real rule, and the code already half-implements it. **Remove
the title from the gray `PageHeader`**; the white card's `<h2>` already carries
it. The gray band keeps identity/context (`record.id · Session · organizer
origin`) and the state chip. Nothing is "moved" — a duplicate is deleted.

## 3. Decision state is invisible, and the buttons offer a decision already made

The operator's exact flow: open *Debugging Open-Model Infrastructure from
Prototype to Production* → **Reject** → **Reject and notify** → returns to the
record.

> *"I know the status on the top right hand corner says rejected, but the record
> action, they're all still there. It's very unclear."*

**Mechanism.** `SubmissionRecordPage.tsx:157` renders **Accept / Maybe / Reject
unconditionally** whenever `record.actions.can_decide`. The only signal that a
decision stands is `decidedNote(record.decisions[0])` — MRQ-86's cue, PR #28,
merged — which renders `Decided Rejected · Aug 12, 2026` into a **`.subtle`**
slot in the card header. A low-contrast caption is losing against three
full-weight buttons, one of which is `variant="danger"`. The cue is there; it is
just outranked.

The state also appears a third time as a plain `<Chip>` in the gray header
(`record.stage_label`, line 152) with no tone unless the stage is `published` or
`waved` — so a **Rejected** record's most authoritative status indicator is an
untoned chip in the corner.

**Required outcome — four parts:**

1. **Name the standing decision inside the Record action card**, at the weight
   of content rather than a caption. The organizer must be able to tell in one
   glance that this is a *change* of decision, not a first one.
2. **Give the header state chip real visual prominence**, with a tone that
   distinguishes a terminal negative (Rejected / Withdrawn) from an accepted or
   in-flight record. Operator: *"we should make it more prominent, the state in
   the top right corner."*
3. **Do not offer the decision that is already in effect.** A Rejected record
   must not show a live **Reject** button. Remove or disable-with-explanation
   the current decision's own button; the other two stay live.
4. **Never let the UI post a decision the server will refuse.** Re-submitting
   the standing decision reaches
   `src/routes/submission-decisions.routes.ts:88`, which throws
   `ApiError.unprocessable(...)` — the operator saw this as the change *"would
   leave the program in a state that it could not be in."* An impossible action
   should be unavailable on screen, not explained in an error after the click.

### The trap — read this before you touch the buttons

**MRQ-83 (PR #21) deliberately restored decision buttons on declined,
waitlisted and withdrawn records so an organizer can change their mind**, and
`can_decide` includes `declined`. MRQ-86's ticket says in terms: *"the re-decide
affordance itself is intentional. Do not undo that."*

So the distinction this ticket turns on is narrow and you must hold it exactly:

- **Changing a decision stays possible.** Rejected → Accept must still work.
- **Re-asserting the decision already in effect goes away.** Rejected → Reject
  is a no-op the server rejects, and it must not be offered.

Do not change `can_decide`. Do not add a confirmation step — the decision dialog
is already one, and R7 grades speed.

## 4. Also seen once: "The record is not available"

The operator hit the `state.kind === "error"` branch (line 149) on a record that
then loaded fine on retry:

> *"I just did submission record, the record is not available — here I'm going to
> do it again."*

**Investigate, do not guess.** Reproduce if you can; if you cannot, make the
failure legible — that branch currently prints `state.message` with no request
id or status code, so a transient fetch failure and a real 404 look identical to
both the organizer and to us. At minimum, distinguish "not found" from "could
not reach the server" and keep Retry. Report what you find in the PR even if the
answer is "could not reproduce."

## Constraints

- `DESIGN.md` Flight Deck tokens and voice. **Elements never jump**: swapped
  strings reserve their space, the card must not change height when a decision
  is taken on-screen, and `record-copy.ts` already documents this invariant for
  the header slot — keep its test passing or replace it with a stronger one.
- Organizer's language (`PHILOSOPHY.md`). No status slugs, no field names.
  `Maybe` is the waitlist's display name.
- No API change and no migration are needed: `record.decisions` is already on
  the payload, newest-first (`submission-record.routes.ts:245`).
- Test titles must begin `AC-<n> · ` or `CONTRACT · ` or `trace:ac` fails.
- Suite budget 45s, gate budget 120s.

## Acceptance criteria

- AC-1 · Both breadcrumb crumbs are links: `AIE NYC 2026` → `/dashboard`,
  `Submissions` → `/submissions`, from a submission record.
- AC-2 · The `Back to submissions` button is gone from the loaded record header
  and still present on the error state.
- AC-3 · The record title appears exactly once on the page, in the white card.
- AC-4 · On a decided record, the Record action card names the standing decision
  at content weight, not as a `.subtle` caption.
- AC-5 · On a decided record, the button for the decision already in effect is
  not offered; the other two decisions remain available and still work.
- AC-6 · The header state chip is visually distinct for a terminal-negative
  record versus an accepted one.
- AC-7 · The Record action card is the same height decided and undecided, and
  does not change height when a decision is taken on-screen.
- AC-8 · Changing a decision on a rejected record (Rejected → Accept) still
  succeeds — MRQ-83 is not regressed.

## Verification

Drive it in a browser locally: open an undecided record and a rejected record
side by side, screenshot both; reject a record on-screen and screenshot the
result; then change that rejected record to Accept and show it succeeding.
Attach all four. A passing test does not close this — the defect is that the
screen is unclear.

## File ownership

OWNS: `src/ui/submissions/SubmissionRecordPage.tsx`,
`src/ui/submissions/record-copy.ts`, `src/ui/submissions/record.css`,
`src/ui/shell/Topbar.tsx`, and its own tests.
MUST NOT TOUCH: `src/ui/shell/Sidebar.tsx` or `src/ui/health/**` (open PR #53),
`src/ui/submissions/SubmissionsPage.tsx` (open PRs #54, #56), `scripts/seed/**`
(MRQ-100), `can_decide` in `src/routes/submission-record.routes.ts`, or any
migration.

**Rebase onto `github/main` immediately before opening the PR.** PR #53 touches
`SubmissionRecordPage.tsx` and is expected to merge first.
