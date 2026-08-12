# MRQ-83: A decided record is a dead end — restore the path back to reconsidering it

A decision is a one-way door. Once a record is Withdrawn or Rejected there is no control anywhere on its page to change your mind — the Record Action card is gone entirely, not disabled. Evidence: `sequence/UX-SWEEP-FINDINGS-PASSB.md` (Flow 2, Flow 3), screenshots `B-organizer-submission-reversed-DEADEND.png` and `B-organizer-submission-rejected-WAVED-STAGE-BUG.png` in `/private/tmp/claude-501/-Users-atin-Projects-Stage11-deployments-Marquee/972723d5-04c2-41fc-9683-2735da94bd06/scratchpad/passb-shots/`.

## Why this exists

Organizers change their minds. A speaker withdraws and then un-withdraws; a rejection turns out to have been the wrong call; a reversal is applied to the wrong record. PHILOSOPHY.md's "respect the operator" does not survive a screen where the most consequential action available is also the only irreversible one — the operator is left with a record they can see, cannot act on, and cannot explain.

This also cost the sweep a test it was explicitly sent to run. `sequence/UX-SWEEP-PLAN.md` asks Pass B to verify "that re-acceptance restores rather than reassigns" — the wave-preservation behaviour that `writeSubmissionDecision` implements via `preserveWave: target.status === "accepted"` (`src/jobs/cascade/decisions.ts:818`). **That assertion has never been executed against the product**, because there is no way to re-accept anything. Whatever this ticket does, it must end with that verification finally run.

## What was seen

Pass B accepted `sub_synthetic-pool-0001`, then applied an acceptance reversal from the record's Acceptance Reversal panel (branches: Portal tasks **Keep tasks active**, Scheduled emails **Cancel queued emails**, Calendar invites **Send cancellation**, Resulting status **Withdrawn**), and clicked **Apply reversal**.

- Before reversal the record page carried a **Record action** card (Accept / Maybe / Reject) directly under the program-record summary.
- After reversal that card is **absent** — not disabled, not behind a toggle. The page was checked top to bottom, then reloaded. The only decision-adjacent thing left is the read-only Decision History.
- The Acceptance Reversal panel disappears too, so the branch choices that were just applied cannot be inspected or corrected either.
- The same dead end reproduces on a plain rejection, no reversal involved: `sub_synthetic-pool-0280` was rejected with feedback in Flow 3 and its Record action card is likewise gone.

## Root cause — confirmed in source, and the two halves are NOT the same bug

`src/routes/submission-record.routes.ts:406` computes the affordance:

```
can_decide: ["submitted", "in_review", "accepted", "waitlisted"].includes(row.status),
```

`src/ui/submissions/SubmissionRecordPage.tsx:138` renders the whole card behind `record.actions.can_decide &&`, so a false value erases it rather than explaining it. `SubmissionRecordPage.tsx:141` gates the reversal panel on `record.status === "accepted"` for the same reason.

Compare the server's own rule, `ACTIONABLE_STATUSES` at `src/jobs/cascade/decisions.ts:125-131`:

```
submitted, in_review, accepted, waitlisted, rejected
```

Two different defects fall out of that comparison:

1. **Rejected is a pure UI regression.** The decision writer already accepts a rejected record — `canTransition` (`decisions.ts:791`) lets it through, and re-accepting one would work today if anything called it. The UI whitelist simply omits `rejected` from a list the backend includes. Nothing needs deciding here; the two lists disagree and the UI one is wrong.
2. **Withdrawn is a genuine policy gap.** Neither list carries `withdrawn`, so the server would refuse a re-decision even if the button existed. This half needs a ruling before code (below).

Do not fix these by adding `"withdrawn"` and `"rejected"` to the literal at line 406 and stopping. That produces a button that half-works and, for withdrawn, a button that fails at the API with a raw `submission is withdrawn and cannot be decided` string.

## The ruling this ticket must make

**Can a withdrawn record be re-decided, and by whom?** Recommendation: **yes, and it re-enters as a normal decision.** A withdrawal is a state, not a tombstone — the reversal dialog itself offers Withdrawn and Rejected as peers, and treating one as recoverable and the other as final would be arbitrary. Add `withdrawn` to `ACTIONABLE_STATUSES` and let the existing cascade do its work: `preserveWave` already restores rather than reassigns on re-acceptance, task cancellation already carries `cancelled_at` (migration 0003, MRQ-66) so a re-accept can reconcile idempotently through MRQ-67's path rather than double-assigning.

Take a different reading if the code contradicts this, and say why in the PR. What is not acceptable is the record staying unactionable.

## Scope

- A Withdrawn or Rejected record offers a visible, honest path back to a decision. Whether that is the same Record action card returning or a distinct "Reconsider this record" affordance is a design call — make it, and justify it against DESIGN.md and the binding prototype.
- Reconcile `can_decide` with `ACTIONABLE_STATUSES` so one rule governs both sides. A second hand-maintained status literal in the route is how this drifted; prefer deriving the affordance from the writer's own rule over copying its contents.
- Re-deciding must run through `writeSubmissionDecision`, not a new path. Wave preservation, decision-history writes, the outbox trigger and the acceptance-task cascade all already live there.
- **Never hide an action to express that it is unavailable.** Where a record genuinely cannot be decided, the card states why in the organizer's language — not an empty space the reader has to interpret. This is the durable half of the fix; the status list will change again.
- Confirm what a re-accepted record does with tasks that a reversal cancelled, and with a speaker who has already been told they were rejected. If re-acceptance sends a second decision message, that is correct and should be visible; if it silently sends nothing, that is a stranded speaker and belongs in the PR body even if the fix lands elsewhere.
- Out of scope: the reversal's own missing audit entry (**MRQ-82**), the stage pill reading "Waved" on these same records (**MRQ-76**), and the CFP blocker (**MRQ-81**). All three came out of the same sweep and are already ticketed — do not re-fix them here.

## Constraints

- **Sequencing — this ticket collides head-on with two open PRs.** `src/routes/submission-record.routes.ts` is owned by **MRQ-76** (`pr_open`) and `src/ui/submissions/SubmissionRecordPage.tsx` by **MRQ-77** (`pr_open`). MRQ-76 is rewriting line 406 specifically — gating decision affordances on the derived stage rather than the raw `status` column — which is the same line this ticket changes, in a compatible direction. **Do not start until both have merged**, then build on MRQ-76's derivation instead of reintroducing a status literal.
- DESIGN.md / Flight Deck tokens; `check:design` stays green. The build reproduces the binding prototype one-to-one.
- **ELEMENTS NEVER JUMP.** A card that appears and disappears as the record's status changes is exactly the failure this rule names. Reserve the space.
- Never surface a raw error string or SQL to an organizer; match the existing decision-dialog idiom and voice.
- No new D1 table and no migration — the statuses and the decision writer already exist.
- If you add or change an API route, `npx vite build && node cli/generate-api-registry.mjs` — `check:api` asserts exact registry parity.
- Test titles must begin `AC-<n> · ` or `CONTRACT · ` or `trace:ac` fails.
- Fleet gate while the merge queue drains (merge driver, this run): three `tsc --noEmit` passes, `npx vite build`, `check:design`, `check:api`, `trace:ac`, and your own diff's test files. **No full `npm test` and no `pr-gate`** on this box — say so in the PR body and let GitHub CI run the suite.

## Verification

1. Unit test on the affordance rule itself: every status the decision writer accepts must render a decision path, and any status it refuses must render a stated reason rather than nothing. Assert the two lists cannot drift — that invariant is the actual defect and is what makes this unrepeatable.
2. Integration test: re-decide a `rejected` record and a `withdrawn` record through the real endpoint; assert status, the decision row, and the outbox row.
3. **The verification this ticket exists to unblock** — accept a record, note its `wave_id`, reverse it to Withdrawn, re-accept it, and assert the wave is **restored, not reassigned** (`preserveWave`, `decisions.ts:818`). Nobody has ever run this.
4. **REAL-ARTIFACT SMOKE, non-negotiable.** Start your own Worker on a free port (8787/8801/8802/8803/8863 are taken — pick 8804+) against the full seed. Then, in a real browser: accept `sub_synthetic-pool-0001`, reverse it to Withdrawn, and confirm the record page offers a way back; take it, and confirm the record returns to Accepted with its Decision History reading as a coherent story. Separately reject a record and confirm it too can be reconsidered. Zero uncaught console exceptions throughout.
5. Confirm no regression in the direction MRQ-76 tightened: a scheduled or published record must still not offer live decision buttons.

## Delivery

Own git worktree, branch `mrq-83-reconsider-decided-record`, cut off current `github/main` **after MRQ-76 and MRQ-77 merge**. PR via `gh pr create --repo Stage-11-Agentics/marquee --base main`.

## File ownership

OWNS (post-merge): `src/routes/submission-record.routes.ts` decision-affordance derivation, `src/ui/submissions/SubmissionRecordPage.tsx` record-action rendering, `src/ui/submissions/AcceptanceReversalPanel.tsx` visibility, `src/jobs/cascade/decisions.ts` `ACTIONABLE_STATUSES` / `canTransition`, its own tests.
MUST NOT TOUCH: `src/ui/public/form/*` (MRQ-81), `src/routes/submission-reversal.routes.ts` decision-history writes (MRQ-82), `src/routes/submissions.queries.ts`, `src/api/board.ts`, `src/routes/landing.route.tsx` (MRQ-76), `scripts/seed/*`, `package.json`.
