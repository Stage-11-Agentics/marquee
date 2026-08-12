# MRQ-99: Conference name is a dead-end stub, and the decision dialogs explain themselves in engineer

Three small organizer-facing defects from the live site (operator, 2026-08-11/12):
a dead-end button in the shell, and decision-dialog copy written in engineer.
Small diffs, but two of them sit on the walkthrough path, which must complete with
**zero dead ends**.

## 1. The conference name is a dead-end stub

*"When I clicked the conference switcher, it said the shell of ordinance is ready.
Its owning modules have not landed yet."*

`src/ui/shell/Sidebar.tsx:11`:

    <button class="event-switcher"
      onClick={() => unavailable("Conference switcher",
        "Switching between conferences arrives with conference administration.")}>
      <small>Conference</small><strong>{eventName}</strong></button>

The conference name — "AIE NYC 2026" — **is** the switcher button, and clicking it
opens the "Not installed" overlay from `src/ui/shell/OverlayHosts.tsx:41`
(*"This shell affordance is ready; its owning module has not landed yet."*). So the
most prominent piece of identity in the sidebar is a button whose only behavior is
to apologise.

The operator's own instruction resolves it: *"Let's make AIE NYC 2026 — that should
take you to like the home page or something."*

**Make the conference name a link home** (the dashboard, matching the `brand` link
directly above it at `Sidebar.tsx:10`) and drop the switcher stub. Multi-conference
switching is genuinely not built; an affordance that only announces its own absence
is worse than no affordance.

While you are there: **sweep for other `unavailable(...)` call sites** and list them
in the PR with a one-line judgement each — dead end on the walkthrough path, or
acceptable. Do not fix them all in this ticket; the operator needs the inventory more
than the fixes right now. If any sit on the 11-step loop, say so loudly.

## 2. The accept dialog explains itself in engineer

`src/ui/submissions/SubmissionRecordPage.tsx:158`:

> "Feedback is optional. If supplied, the exact normalized note is saved on this
> decision row and rendered through the standard conference email."

"Normalized note", "decision row", "rendered through the standard conference email"
— that is the schema talking. `PHILOSOPHY.md` binds this: **the organizer's language**.
An organizer about to accept a speaker wants to know one thing: *will this person read
exactly what I typed?*

Rewrite it as a plain sentence that answers that. Keep the promise accurate — do not
claim mail is sent if this action does not send it (the same file's waitlist path
deliberately does not notify; check before you write). One or two short sentences.

Apply the same read to the sibling dialogs in that component (accept / waitlist /
reject) so the three read as one voice.

## 3. "optional" belongs in parentheses

Operator: *"and then for optional put that in parentheses."*

The field label is `Feedback for the speaker · optional`
(`SubmissionRecordPage.tsx:158`). Make it read `Feedback for the speaker (optional)`.

The identical pattern exists on the bulk dialog —
`Feedback for the speakers · optional` (`SubmissionsPage.tsx:607`) — and in the
reviewer surface (`src/ui/review/ReviewerPage.tsx:403-405` uses "Optional scorecard",
"Optional context for the committee"). **Make the treatment consistent everywhere a
field is marked optional**, and say in the PR what convention you settled on. A
mixed vocabulary for "optional" across three surfaces is its own small defect.

## Ownership boundary

**MRQ-97** owns `submissions.queries.ts` and the status control; **MRQ-98** owns the
submissions list's loading behavior, search field, and saved-view strip. You are
touching `Sidebar.tsx`, `OverlayHosts.tsx` (read-only sweep), and the decision
dialogs in `SubmissionRecordPage.tsx`. Your one point of contact with MRQ-98 is the
bulk dialog label in `SubmissionsPage.tsx:607` — take just that line, keep the diff
to it, and note it in a Lattice comment so the rebase is trivial.

## Constraints

- Flight Deck aesthetic per `DESIGN.md`; the conference name must not change size or
  position when it becomes a link (**elements never jump**).
- Work in your own git worktree. **Never** branch, stash, or clean in the primary
  checkout — see `CLAUDE.md`, "The primary checkout is the Lattice board's home".
- No auto-deploy: validate locally, do not run `wrangler deploy`. See `DEPLOY.md`.
- Suite budget 45s, gate budget 120s.

## Acceptance

- Clicking the conference name goes home; no "not landed yet" overlay is reachable
  from the sidebar.
- The PR lists every remaining `unavailable(...)` affordance with a verdict on each.
- The accept/waitlist/reject dialogs explain in an organizer's words what the speaker
  will receive, and the promise matches what the action actually does.
- Optional fields read `(optional)` consistently across the record dialog, the bulk
  dialog, and the reviewer surface.
- Validated locally with browser automation, screenshots in the PR.
- `npm test` green within budget; PR open against `Stage-11-Agentics/marquee` `main`.

## Delegator plan — 2026-08-12

### Approach

1. Keep the existing Flight Deck `.event-switcher` markup and CSS geometry, but
   render the conference identity as the same `/dashboard` client-side link as
   the Marquee brand. Remove the sidebar's dead-end callback wiring without
   changing the reusable overlay host or unrelated affordances.
2. Rewrite the record decision dialog's explanatory copy as one organizer-facing
   sentence whose promise follows the actual action: accept/reject feedback is
   included in the queued decision email; waitlist feedback is saved with the
   decision but no message is sent. The waitlist confirmation control will stop
   saying “notify” for the same reason.
3. Standardize the named decision/review field labels to put the qualifier after
   the noun: `Feedback for the speaker (optional)`, `Feedback for the speakers
   (optional)`, `Scorecard (optional)`, and `Committee note (optional)`. This is
   intentionally scoped to the three ticket-named organizer/reviewer surfaces;
   unrelated copy about optional form configuration or public-form metadata is
   not this ticket's field vocabulary.
4. Add a focused source-contract test for the home link, absence of the removed
   call site, action-specific decision copy, and optional-label convention. Run
   the baseline and final `npm test` within the 45s suite budget, then use the
   c11 embedded browser against a local Wrangler instance to drive the sidebar
   home link and all three decision-dialog states and capture screenshots.
5. Commit the focused change, push only to the `github` remote, open the GitHub
   PR against `main`, and include the complete `unavailable(...)` inventory,
   judgment calls, local browser evidence, and the explicit no-auto-deploy
   follow-up in the PR body.

### Judgment calls

- The conference link uses the existing `event-switcher` class and `/dashboard`
  route so its size and position do not change when the element changes from a
  button to an anchor.
- “Accept and notify” and “Reject and notify” remain accurate because the
  decision writer queues the corresponding mail; “Waitlist” is the accurate
  control because the waitlist branch intentionally does not enqueue mail.
- The reviewer convention applies `(optional)` to the field labels themselves,
  not to unrelated prose or placeholders elsewhere in the product.
