# MRQ-170: CFP-09: a submitter cannot edit their own submission while the call is open

Rubric item **CFP-09** — `call-for-papers`, weight **2**, lane **absence**
(`not_found` → `pass` recovers the full 2.0 points). Failed identically in round 4
(build 29300ecf/0c169abf) and round 5 (build f9630de0), so this is a real absent
capability, not judge variance. Scenarios that walk it: **CFP-S2** (speaker side),
**CFP-S3** (organizer side).

## Acceptance criterion — the rubric's `pass_criteria`, verbatim

> The appended abstract sentence ("Updated: now includes 2026 benchmark data.")
> persists across reload in the speaker's view and appears verbatim in the
> organizer's view of the same submission

The rubric's `criterion` for context, verbatim:

> A submitter can edit an existing submission while the CFP is open, and the edited
> content is what the organizer subsequently sees (inferred norm from
> Sessionize/EasyChair, confirmed by SessionBoard participant docs)

Required evidence, verbatim:

> Speaker-side screenshot of the edited abstract after reload (CFP-S2);
> organizer-side screenshot of the submission detail containing the same sentence
> (CFP-S3)

## Why it fell short — the judge's own reasoning

Round 5 (`runs/2026-08-13T20-13-03/judgements/call-for-papers.json`, confidence
medium):

> The app offers the submitter no way to edit a submitted abstract while the call is
> open, so the scripted edit ('Updated: now includes 2026 benchmark data.') could
> never be applied and the organizer-side check has nothing to find. Two paths were
> tried while the CFP was open: (a) the submitter portal /portal lists each
> submission with its status but exposes no Edit / View submission / Withdraw
> control — the only controls on the page are Sign out, 'Sign in with your email',
> 'Open the call for speakers', 'Return to conference', 'View the agenda'; (b)
> re-opening the resume link that produced the submission renders only the read-only
> confirmation card, not an editable form. Drafts remain editable via the resume
> link, but only before submission. The organizer's copy of the abstract accordingly
> lacks the appended sentence. Caveat lowering confidence: the post-acceptance
> speaker portal does carry a per-talk edit affordance (seen later as a disabled
> 'Closed' button), so an edit surface exists for accepted speakers — but it was
> never reachable for a pending submission with the CFP open, which is what this
> criterion asks for.

Round 4 said the same thing independently, and added that CFP-S4 re-confirmed after
acceptance that "there is still no path anywhere for the speaker to edit the
submitted abstract text itself", and that this is "absence of the feature in the
product, not a run shortfall: the CFP was open at the time of the attempt and the
scenario completed."

## Where the code already is (read this before designing)

The product already has almost all the machinery; what is missing is the
*pre-decision* seat.

- `src/routes/portal.routes.ts:976` `talkIsEditable()` and `:1268` `editableTalk()`
  implement speaker-side talk editing, gated by a per-submission settings row
  `speaker_talk_editing:<submissionId>` that program staff reopen or close
  (`:1557`). `talk_editable` is projected into the portal view at `:951`/`:1129`.
  That path is built for the *accepted* talk, and it edits title/description.
- The public form's resume link renders read-only once the response leaves draft.
- So the gap is: a **submitted, not-yet-decided** proposal has no editable surface
  for the person who submitted it, on either the resume link or `/portal`.

## What to build

While the CFP is open and the submission has not been decided, the submitter can
edit their own submission's answers — at minimum the abstract/description — and the
organizer's view of that record shows the edited text.

1. **Reachable from the submitter's seat.** `/portal` must expose the control on
   the submission row (not a hidden URL), and the resume link must reopen the form
   in an editable state for a submitted-but-undecided response.
2. **Round-trips.** The edit persists across reload in the speaker's view.
3. **Organizer sees the same text**, verbatim, on the submission detail — the same
   record, not a copy or a pending-change queue.
4. **Honest when it is not available.** Once the CFP closes or a decision lands, the
   control renders **disabled with the reason stated** rather than disappearing.
   A capability that vanishes when inapplicable is undiscoverable — that is the
   (b)-class defect this loop keeps finding, and this ticket must not add another.
5. **History.** The record's HISTORY panel should show the speaker's edit (who,
   what, when). Round 4 separately logged "the record's HISTORY panel, captioned
   'Every change, who made it, and when', reads 'No history recorded yet'" as a
   minor defect; a speaker edit that leaves no trace would make the organizer's
   record untrustworthy.
6. **Authorization.** Only the submitter of that response, on their own submission,
   in that event. No cross-event or cross-person reach through a resume token.

Prefer extending the existing editing machinery over building a second one — one
notion of "this submission is editable by its speaker right now", with the CFP-open
+ undecided case added to the existing staff-reopened case.

## Constraints

- Work in your **own linked worktree**, created as your first act:
  `git worktree add ../Marquee-worktrees/mrq-170-submitter-edit -b mrq-170-submitter-edit main`.
  Verify with `pwd` and `git branch --show-current`. Never the primary checkout (it
  is the Lattice board's home); never `mrq-auto-eval*` (that is the loop's own
  machinery branch).
- **Never `git stash` anywhere in this repo** — the stash stack is shared across all
  worktrees and two agents stashing at once swap each other's work.
- **No migration without the operator.** If this needs a schema change, stop and say
  so on the ticket rather than adding one.
- **Do not deploy.** An eval round is running; a `.deploy-freeze` marker sits at the
  primary checkout. Merging is wanted; deploying is not, and is not yours.
- Gate serialized: `flock /tmp/marquee-gate.lock -c 'npm run pr-gate'`.
- PR: `gh pr create --repo Stage-11-Agentics/marquee --base main`.

## Reset 2026-08-13 by agent:codex-mrq-170
