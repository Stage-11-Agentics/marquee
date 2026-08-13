# Code Review: MRQ-99 — shell dead end + organizer-language decision copy

**Reviewed:** branch `mrq-99-shell-copy` (`33bd97b`, `44ea8ef`, `68814b6`) on base `2543206`,
i.e. PR #53 — **already merged** into `github/main`. The diff supplied in the review prompt
was computed against a stale base and swept in MRQ-91/92/93/96/97 work that is not this
ticket's; this review covers only the six files MRQ-99 actually touched.

**Verification performed:** re-ran `npm test` in the worktree (**109 node tests + suite pass,
34.07s / 45s budget**, machine load 18.75 — inside budget under real contention); traced the
decision writer and mail templates to check every promise the new copy makes; swept `src` for
remaining `unavailable(...)` call sites; confirmed all four copy changes are still present on
`github/main` at `2969956` after MRQ-94/97/98/favicon merged on top (no drift).

## 1. Verdict

**PASS** — every acceptance criterion is met, the copy's factual claims check out against the
backend, and the sidebar change is geometry-safe for real (not just asserted). Findings below
are all minor: one piece of dead plumbing the ticket's own cleanup left half-finished, and four
copy/test nits. None warrant reopening a merged PR on their own; items 1 and 5 are worth
folding into whatever touches the shell next.

## 2. Summary

The conference name is now an `<a href="/dashboard">` using the same navigate-and-preventDefault
pattern as the `brand` link directly above it, the `unavailable(...)` seam is gone from `src`
entirely (both shells, not just the one the ticket named), and the record/bulk/reviewer copy
reads in an organizer's words with the `(optional)` convention applied consistently. The key
finding: `AppShell` still carries `overlay`/`setOverlay`/`closeOverlay` and renders `<OverlayHost>`
that can now only ever receive `null` — `DeliveryHealthShell` was cleaned all the way through in
`44ea8ef`, `AppShell` was not, leaving the "Not installed" component and its `.modal-*` CSS
unreachable app-wide.

## 3. Issues

**[MINOR] src/ui/shell/AppShell.tsx:44,51,175 — dead overlay plumbing; the "Not installed" surface is now unreachable**
`unavailable(...)` was the only producer of a non-null `OverlayState` in `AppShell`; after its
removal the remaining writer is `closeOverlay`, which sets `null`. So `overlay` is permanently
`null`, `<OverlayHost state={overlay}>` always returns `null`, and `OverlayHost` / `OverlayState`
in `OverlayHosts.tsx` have no reachable caller anywhere in the app (`DeliveryHealthShell` dropped
its host in `44ea8ef`). `.modal-head`, `.modal-body`, `.drawer-head`, `.drawer-content` in
`components.css:113-118` are likewise consumed only by that component — the reversal panel and
onboarding drawer use their own prefixed classes. The inconsistency is the real cost: the same
branch cleaned one shell completely and the other partially, so a later reader can't tell whether
the AppShell host is a deliberate extension point or a leftover.
**Fix:** delete `overlay`/`setOverlay`/`closeOverlay`, the `<OverlayHost>` render, and the
`OverlayHost`/`OverlayState` export plus its CSS block — or, if the host is meant to survive for a
future drawer, leave a one-line comment saying so. Half-cleaned is the only bad option.

**[MINOR] src/ui/submissions/SubmissionRecordPage.tsx:158 — the notify promise is still falsifiable when the trigger template is off**
The new sentence, *"the speaker will see the same words in the decision email,"* and the retained
`Accept and notify` / `Reject and notify` CTAs are true for the seeded default (both `acceptance`
and `rejection` templates in `src/jobs/mail/templates.ts:56,61` carry `{{decision.feedback}}`, and
`writeSubmissionDecision` enqueues for every non-waitlist status). But `enqueueTrigger`
(`src/jobs/mail/triggers.ts:29`) returns `null` when `template.enabled !== 1`, and organizers can
toggle exactly those triggers off from Comms → Templates (`CommsScreen.tsx:318`).
**Failure scenario:** organizer switches the `acceptance` trigger off in Comms, then accepts a
submission from the record page. The decision and feedback are written, `outbox_inserted` is
`false`, no message is ever sent — and the dialog just promised the speaker would read those exact
words. This is pre-existing (the old "rendered through the standard conference email" made the
same assumption) and the new copy is strictly more truthful about waitlist, but the ticket's own
standard is "the promise matches what the action actually does."
**Fix:** read the decision trigger's `enabled` state where the dialog already loads record data and
swap to "…is saved with the decision; acceptance mail is currently off" when it is disabled — or,
cheaply, phrase it as conditional on the mail being on.

**[MINOR] src/ui/submissions/SubmissionsPage.tsx:620 — bulk copy presumes feedback will be typed, and dropped the "every selected record" fact**
*"Each selected speaker will receive the feedback you add in the decision email."* describes
nothing that happens when the (optional) box is left empty — the speakers still receive a decision
email, just without feedback. The record dialog gets this right with its "Feedback is optional. If
you add it, …" framing; the bulk dialog lost the conditional and also lost the previous copy's
useful "The decision is written on every selected record."
**Fix:** mirror the record dialog — "Feedback is optional. If you add it, every selected speaker
sees the same words in their decision email." That also gets the two dialogs closer to the "one
voice" the ticket asked for.

**[MINOR] src/ui/submissions/SubmissionRecordPage.tsx:157 — "(optional)" used as prose, not as a field label**
The Record Action summary reads *"Feedback (optional) is saved with the decision; accepted and
rejected decisions also include it in the speaker email."* The parenthesized convention this ticket
established is a **field-label** convention; used mid-sentence it reads like a schema annotation —
the exact register the ticket was removing. "Decisions" also do the including, rather than the
conference doing it.
**Fix:** "Feedback is optional. Accepted and rejected speakers see it in their decision email."

**[MINOR] tests/node/mrq-99-organizer-copy.test.mjs:11-14 — the sweep the ticket cared about is the one line not asserted**
The contract tests assert `Sidebar.tsx` and `AppShell.tsx`, but `DeliveryHealthShell.tsx` — the
second `unavailable` seam, found and removed in a follow-up commit (`44ea8ef`) precisely because it
was missed the first time — has no assertion. It is a parallel shell that duplicates AppShell's
wiring, so it is the file most likely to regrow the seam. Separately, the assertions pin exact
marketing sentences (`/speaker will see the same words in the decision email/`), so any
semantically identical rewording turns the suite red, and `doesNotMatch(sidebar, /unavailable\s*\(/)`
is a substring guard that would trip on innocuous future wording.
**Fix:** add `DeliveryHealthShell.tsx` to the `doesNotMatch(/unavailable\s*\(/)` sweep — one line,
and it covers the failure that actually occurred once already.

## 4. Positive Observations

- **The truthfulness claims were verified, not assumed.** `writeSubmissionDecision`
  (`decisions.ts:854`) short-circuits mail for `waitlisted`, and the bulk path does the same at
  `:982` — so "A waitlist does not send a message" is exactly right, and dropping the CTA from
  "Waitlist and notify" to "Waitlist" is the correct consequence. Both `acceptance` and `rejection`
  templates really do interpolate `{{decision.feedback}}`, so "the same words" holds for both
  notifying branches. The `notifies` flag in `BULK_ACTIONS` carries a comment explaining why it is
  not cosmetic — good.
- **Elements never jump, and for a structural reason rather than luck.** `.event-switcher` sets no
  `display`, so an `<a>` would normally be inline and drop `width: calc(100% - 8px)`. It survives
  because `.sidebar` is `display: flex; flex-direction: column`, which blockifies its children —
  the anchor is a flex item with identical box geometry to the old button. `tokens.css:62`
  (`a { color: inherit; text-decoration: none }`) keeps the visual identical, and the anchor
  actually *gains* the pointer cursor a bare `<button>` lacks.
- **Prototype fidelity.** The binding prototype ships this element as an anchor already
  (`prototypes/skins/skin-c.html:336`, and the same in skin-a/skin-b/pipeline), so the change moves
  the build toward the design language rather than away from it.
- **The sweep was completed properly.** No `unavailable(...)` call site remains anywhere in `src`
  — the delegator found the `DeliveryHealthShell` copy the ticket never named and removed its whole
  overlay host with it. The PR body carries the inventory with a per-site judgement, the judgment
  calls, and an explicit statement of what was deliberately left alone (`Pattern · optional regular
  expression`, `Optional note to the program team`), which is the right scope discipline for a
  three-surface vocabulary fix.
- **MRQ-98 boundary respected.** The touch on `SubmissionsPage.tsx` is confined to the bulk label
  and its adjacent sentence; MRQ-97's status grouping and "Ready to place" vocabulary came through
  the rebase untouched, and all four MRQ-99 strings are still intact on `main` after four
  subsequent merges.
