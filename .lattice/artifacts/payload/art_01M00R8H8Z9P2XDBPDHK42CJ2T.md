# Plan Review: MRQ-201 — The conference timezone is the only timezone

## 1. Verdict

**PASS** — Implementation can proceed. The plan is a faithful, correctly-scoped condensation of an unusually complete task description, built on a verified-current base. The issues below are refinements the implementer should absorb, not gaps requiring a replan.

## 2. Summary

The plan proposes a four-part execution (extract the shared `event-time.ts` seam, fix the eight display consumers, fix the three behaviour consumers, restate the calendar-day contract comments) with a test strategy pinned to a third timezone and both 2027 DST transitions. I verified the plan's key factual premises against the tree: `zonedStart`/`localParts` exist as described (`src/ui/agenda/AgendaPage.tsx:92`, `src/ui/agenda/track-board.tsx:124`), both bug sites are real (`FormsPage.tsx` close-date field writes browser-local and reads UTC; `SubmissionRecordPage.tsx` schedule write uses `new Date(value).getTime()`), the base commit `c2c3da03` is the current head of `github/main`, and the `mrq-201-timezone` worktree and branch already exist. The main concern is that the plan compresses several of the task's explicit guardrails (walkthrough validation, no-browser-fallback rule, commit sequencing) into hedged or implicit language; these should be treated as binding during implementation.

## 3. Issues

**[MAJOR] Verification — walkthrough validation is hedged with "if available"**
Acceptance criterion 13 requires the 11-step walkthrough loop to complete with zero dead ends, unconditionally — a dead end anywhere in it is a project-level defect. The plan says "Perform local-only walkthrough/browser validation if available," which converts a hard AC into an optional step. B1 changes what instant a scheduled session stores and D1 changes what the form builder reads back; both sit on walkthrough-visible surfaces.
**Recommendation:** Make walkthrough validation unconditional. If browser automation is genuinely unavailable in the worktree, substitute an explicit fallback (local dev server + the seeded walkthrough path via curl/integration tests) and say in the PR which method was used. Do not merge with AC 13 unexercised.

**[MINOR] Scope — display-first/behaviour-second sequencing not committed to**
The task prescribes three steps landed as separate commits ("preferably separate PRs") because they carry very different risk: the seam extraction is behaviour-neutral, D1–D8 are safe, and B1–B3 move stored instants and firing times. The plan collapses this into one branch and one PR without stating the commit structure. A single mixed commit makes the risky part unreviewable in isolation and unrevertable without dragging the safe part with it.
**Recommendation:** One PR is acceptable, but structure it as (at least) three commits matching the task's Step 1/2/3, and state in the PR body that B2 moves when reminders fire for organizers outside the conference zone — the task explicitly asks for that sentence.

**[MINOR] Scope — the no-browser-fallback rule (AC 7) is not restated**
The task warns twice that when `useEventContext().event` is still `null`, the surface must render its existing placeholder rather than falling back to the browser zone — "that reintroduces this bug intermittently and invisibly." The plan never mentions this. It is exactly the kind of convenience fallback (`event?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone`) an implementer writes reflexively.
**Recommendation:** Treat AC 7 as binding at every changed site and add at least one test asserting the placeholder renders while the event is unloaded, or that the conversion helpers are simply not invoked without a zone.

**[MINOR] Verification — the AC 2 grep sweep is absent from the verification list**
AC 2 is mechanical and cheap: no `datetime-local` control in `src/ui/` writes via `new Date(value).getTime()` or reads via `toISOString()`. The plan's verification section lists the test suites but not this sweep, which is the check that proves no third instance was missed and no new one snuck in with the change itself.
**Recommendation:** Add the grep to the verification checklist and paste its (empty) result into the PR body.

**[MINOR] Scope — follow-up recording and the operator sanity-check are unaddressed**
The task designates the calendar-day contract resolution as "the one item worth an operator sanity-check" and instructs that follow-ups be recorded on the ticket rather than minted as new tickets. The plan's stop conditions cover migrations but say nothing about surfacing the B3 contract question or recording the four listed follow-ups.
**Recommendation:** When reporting to Eval Triage, explicitly note that calendar-day fields were kept UTC-midnight-encoded per the task's contract resolution, so the operator gets the sanity-check the task asked for; append the follow-ups to the ticket.

**[MINOR] Context — task line numbers have drifted; locate sites by pattern**
The task cites `SubmissionRecordPage.tsx:660` for B1; in the current tree the schedule write sits at `:691` (the `new Date(schedule.starts_at).getTime()` inside the "Working agenda" card). Other citations may have drifted similarly since the task was written.
**Recommendation:** Locate every listed site by its code pattern, not its line number, and re-verify the "already right" table entries before assuming them current.

## 4. Positive Observations

- **The base is verified-correct, not assumed.** Cutting from `github/main` at `c2c3da03` (confirmed the current remote head) follows the project's hard-won rule about the parked primary checkout; the worktree and branch already exist and match the plan.
- **The plan's factual premises check out.** Every claim I spot-checked — the `zonedStart`/`localParts` inverse pair, the FormsPage write/read asymmetry, the end-of-UTC-day `dueAtFromDateInput` encoding against `schedule.ts:88`'s `due_at < ?` comparison, the `{ name, slug }`-only public form conference payload — is accurate in the tree. `src/lib/event-time.ts` does not yet exist, so the seam extraction is genuinely new work, correctly identified.
- **Non-goals are respected precisely.** No migrations, no API shape change, no date library, no touching the instant comparisons, no deploy during an eval freeze — and the stop condition (halt and flag if stored rows need repair, rather than improvising a migration) is exactly the right boundary for this ticket.
- **The test strategy preserves the task's most distinctive insight**: pinning the machine zone to a *third* zone (`Asia/Tokyo` against a `America/New_York` conference) so browser-local, UTC, and conference-local are three distinguishable answers, with `finally`-restored `TZ`, both DST transitions, the gap/overlap edge cases, Worker-side expected-string assertions, and the five protected contract test files held green and unmodified.
- **The review loop is real**: independent exact-head adversarial review, re-gate after any push, and merge-SHA reporting to Eval Triage — the full contract, not a gesture at it.
