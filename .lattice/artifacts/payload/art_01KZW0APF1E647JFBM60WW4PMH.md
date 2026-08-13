# Plan Review: MRQ-154 — V2-5: submitting a proposal gives you a seat that shows it

### 1. Verdict

**FAIL (plan-level)**

### 2. Summary

Reviewed the MRQ-154 plan against the task brief (`Marquee-worktrees/.briefs/eval-gap-v2-human-lens.md` §4, V2-5), against `main` at `22e4a75f`, and against the *actual diff* of the dependency it names — PR #136 (`portal-submitter`, branch tip `831867bf`, state OPEN / **CONFLICTING**). The plan correctly identifies the dependency and correctly refuses to duplicate it, which is the single most important judgment call here. It fails for two connected reasons: it is written as if #136 delivers only an "honest empty state" (the brief's assumption) when #136 in fact already ships participation-based event resolution, a per-submission list, and a status label — so the plan never states what the remaining delta actually *is*; and every step that produces the deliverable is gated on a merge that has not happened and has no stated fallback, leaving no executable implementation pass.

### 3. Issues

**[CRITICAL] "Dependency and scope" + steps 3–4 — the plan has no executable path and no fallback**

Steps 3 and 4 both begin "once #136 is merged," and the scope section forbids touching #136's owned production files before then. PR #136 is currently `CONFLICTING` against `main` and has been since `2026-08-12T21:56`. As written, an implementer who picks this ticket up can execute exactly one step (write a test that is expected to fail), then must stop. There is no decision rule for the branch not landing, no timebox, and no alternative base. The brief itself offered a second option the plan discarded without comment — *"sequence after it, **or brief the same agent**."*

**Recommendation:** Pick a base that exists today. Either (a) branch `v2-5-submitter-seat` from `github/portal-submitter` rather than `main`, layer the delta there, and let the two land as a stack; or (b) fold MRQ-154 into #136 (same agent, same PR) since the surface, the files, and the test files are identical. If the plan insists on sequencing, state the fallback explicitly: "if #136 is not merged by <time>, resolve its conflicts as part of this ticket and carry both."

**[MAJOR] Plan §"Plan" step 2 — the plan describes work #136 has already done, and never states the real delta**

The brief was written against MRQ-150's *planned* fix ("an honest empty state"). The merged-candidate diff on #136 goes considerably further and already satisfies most of CFP-05's criterion:

- `findSubmitterEvent()` resolves the event through `participations`, not `memberships` (`src/routes/portal.routes.ts`).
- `submitterSnapshot()` returns the person's own submissions, one row per submission, scoped by `EXISTS (participations … person_id = ?)`.
- `SubmitterPortal` / `SubmissionRow` render each submission with `submitterStatusLabel(status)` → `"Submitted"`.
- The confirmation CTA already changed from "Open your speaker portal →" to "Track your submission →" (`src/ui/public/form/PublicForm.tsx`).

The genuine remaining delta for MRQ-154 is narrow: the status copy (`Submitted · awaiting review`) and the "this link is your sign-in" line on the confirmation. The plan does not say this, so an implementer reading step 2 ("a submitter sees only their own proposal and its status") will plausibly re-derive behavior that already exists — and will write a test that is a near-verbatim duplicate of #136's existing `CONTRACT · MRQ-150 · one submitter never sees another submitter's abstract` (in `tests/integration/api/submitter-portal.MRQ-150.test.ts`).

**Recommendation:** Rewrite the plan against #136's actual diff, not the brief's forecast of it. State the delta in one paragraph: what #136 already closes of CFP-05, and the two or three specific things MRQ-154 adds. Drop or narrow step 2's contract test to the assertions #136 does *not* already make.

**[MAJOR] Plan step 1 — `Submitted · awaiting review` is not "the vocabulary the decision flow already uses"; it does not exist in the codebase**

Step 1 instructs the implementer to "read the existing decision-flow status vocabulary and make the submitted-state copy exactly `Submitted · awaiting review`." `grep -rn "awaiting review" src/ tests/` returns zero hits on `main` and zero in #136's diff. The decision flow's actual vocabulary is `"Submitted"` (`src/ui/submissions/SubmissionsPage.tsx:57`) and `"In review"` (`src/ui/submissions/record-copy.ts:15`); `portal.routes.ts:242` and `PortalPage.tsx` both derive labels mechanically by title-casing the status token. The step therefore sends the implementer to read a source that will not confirm the string, and the plan gives no guidance on what to do when it doesn't.

**Recommendation:** Say plainly that this string is *new speaker-facing copy*, not existing vocabulary, and decide its relationship to the organizer-side labels — either introduce it only on the submitter seat (fine, different audience, different register) and say so, or reconcile the two. Also decide whether `in_review` gets its own phrasing, since "awaiting review" becomes false the moment review starts.

**[MAJOR] Plan step 1 — the copy will not fit the surface it lands on, and the plan does not name where it goes**

#136 renders the status into `.portal-submitted-status`, which is `font: 600 10px/1 var(--mono); letter-spacing: .08em; text-transform: uppercase; text-align: right`, inside a `grid-template-columns: minmax(0, 1fr) 104px` row with `min-height: 60px`. `SUBMITTED · AWAITING REVIEW` in uppercase letterspaced mono will not fit 104px; it will wrap and change the row height — which also violates the standing UI rule that elements never jump between states (rows for `Submitted` and `Accepted` would then be different heights).

**Recommendation:** Decide the placement explicitly — status chip vs. the row's secondary line — and include the CSS consequence in the plan (widen the column, drop the uppercase transform for this seat, or put "awaiting review" on the meta line beside `Submitted <date>`). Add a rendering assertion so the layout claim is tested, not eyeballed.

**[MAJOR] Plan — no files are identified**

The plan names no file it will create or modify. Given that this ticket shares every file with an open, conflicting PR, the file list *is* the coordination artifact: it is how the orchestrator and the #136 author can see the overlap before it becomes a conflict.

**Recommendation:** List them. On current evidence the set is `src/ui/portal/PortalPage.tsx`, `src/ui/portal/portal.css`, `src/ui/public/form/PublicForm.tsx` and/or `src/routes/public-form.shared.ts` (confirmation copy), plus one new test file and `tests/ac-claims/MRQ-154.json`.

**[MAJOR] Plan §GOOD LOOKS LIKE / step 4 — "this link is your sign-in" is only true when `event.demo_mode = 1`**

`src/routes/public-form.routes.ts:758-762` mints the portal magic link **only** if `event.demo_mode === 1`; otherwise `portal_url` stays `null` and the confirmation renders no portal link at all. Two consequences the plan does not address: the new "this link is your sign-in" sentence must be conditional on `state.confirmation.portal_url`, or it will claim a link that isn't on the page; and the browser verification in step 4 will silently produce nothing unless the fixture event is in demo mode.

**Recommendation:** State the `demo_mode` precondition in the verify step, and specify that the sign-in sentence renders only alongside the link. If a non-demo event should also get the link, that is a scope decision to raise now rather than discover at validation.

**[MAJOR] Plan step 2 — deliberately committing a red test conflicts with the project's testing discipline and the PR gate**

Step 2 accepts that the new test "may fail before the #136 rebase because its dependency is intentionally absent." `CLAUDE.md` is explicit: *"A red suite must mean a real defect."* A branch carrying a knowingly-failing test also cannot pass `npm run pr-gate` (`hermetic fast suite` is a hard gate), so the branch is un-openable as a PR for as long as #136 is unmerged.

**Recommendation:** Don't commit a red test. Either take the base-on-`portal-submitter` route from the CRITICAL issue above (so the dependency is present and the test is green from the first commit), or hold the test uncommitted until the rebase.

**[MINOR] Risk not identified — the returning speaker never sees their new proposal**

The confirmation link redirects to `/portal` with no event id (`redirectTo: "/portal"`), and both resolvers order `e.starts_on ASC` — the *earliest* event. A person who holds a speaker membership on a past event and submits to this year's CFP takes the speaker path on the old event, and their new submission is invisible: precisely the CFP-05 human problem the ticket exists to close, for the population most likely to submit. Step 2's framing ("the accepted-speaker portal remains on the established speaker path") entrenches this without noting it.

**Recommendation:** Either scope the confirmation redirect to the submitted event (`/portal?eventId=…`) or record this as an explicit, reasoned non-goal so the next eval run doesn't rediscover it as a regression.

**[MINOR] Plan header — the brief path is wrong from any worktree**

The plan (inheriting the ticket) says to read `.briefs/eval-gap-v2-human-lens.md`. That path does not exist in the primary checkout or in `Marquee-worktrees/v2-5-submitter-seat/`. The file lives at `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/.briefs/eval-gap-v2-human-lens.md` — i.e. `../.briefs/…` from a worktree, and outside the repo entirely.

**Recommendation:** Use the absolute path in the plan. An instruction to "read this before starting" that resolves to nothing is how a fresh implementer ends up working from the ticket summary alone.

**[MINOR] Plan step 3 — no AC claim file, and `pr-gate` is ticket-scoped**

`npm run pr-gate` requires `--ticket MRQ-N` and runs `trace:ac --scope=merged --ticket=MRQ-154`; `scripts/checks/trace-ac.mjs:38` emits a `missing-current-ticket-manifest` warning when no `tests/ac-claims/MRQ-154.json` exists. It is a warning rather than a failure, so this is not a blocker — but every one of the 56 existing tickets carries one.

**Recommendation:** Add `tests/ac-claims/MRQ-154.json` to the plan's deliverables with its `owns` / `exercises` lists.

**[MINOR] Plan step 4 — the organizer-side half of VERIFY has no automated cover**

"The organizer's list shows the same record intact" is checked only by hand in the browser. That is the assertion most likely to regress silently later, and it is cheap to assert in the integration suite.

**Recommendation:** Add one integration assertion that the submission the submitter sees is the same row the organizer's submissions list returns, with the same status.

### 4. Positive Observations

- **The dependency call is right, and rare.** Most plans in this position would have re-implemented the resolver and produced a conflicting PR. This one names #136 by number, by branch, by review sha, and by conflict state, declares its owned files off-limits, and scopes itself to a delta. That is exactly the discipline the shared-surface rule asks for; the failure above is that the delta was never computed, not that the instinct was wrong.
- **Non-goals are specific and load-bearing.** "No new account or membership machinery," "no widening of a submitter's query beyond their own participations," and "no reimplementation of MRQ-150's event-resolution" each rule out a concrete, plausible over-reach — including the security-relevant one. This is what good non-goals look like.
- **Browser approval is pre-scoped.** The validation section states the surface, the port posture, the data (local demo fixtures), and the limits (no external credentials, no consequential external requests) up front rather than asking mid-run. That matches the standing rule that browser scope is approved during planning.
- **Verification is a real user walk, end to end** — public form → submit → confirmation link → portal → organizer list — rather than a test-suite claim standing in for the product. The gap is coverage of the organizer half, not the shape.
