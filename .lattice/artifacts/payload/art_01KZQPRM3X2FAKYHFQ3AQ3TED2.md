# Plan Review: MRQ-32 (M-34 + M-35 + M-31 — comms cluster)

## 1. Verdict

**PASS** — Plan is complete, feasible, and aligned. Implementation can proceed. The issues below are addressable via resolution blocks appended to the plan; none requires a return to `in_planning`.

## 2. Summary

Reviewed the MRQ-32 plan (automated triggers, filtered group email, rejection at scale — 9 h merged cluster riding M-11's outbox) against the task description, the AC contract in `sequence/USER_STORIES.md`, and the actual code in the `mrq-32-comms` worktree. The plan is unusually well-grounded: every factual claim checked out against the codebase — the seven trigger keys exist in `src/jobs/mail/templates.ts`, `enqueueTrigger` with its `enabled !== 1` gate exists in `src/jobs/mail/triggers.ts:25-29`, the two `always_live` writers are exactly `enqueuePublicFormConfirmation` and `enqueueSmokeHarnessMail` (`src/jobs/mail/outbox.ts:121-133`), acceptance/rejection triggers are already wired at `src/jobs/cascade/decisions.ts:360-364`, the hourly cron exists at `src/index.ts:160`, `reminder_offset_hours` is already editable in `FormsPage.tsx`, `comms.routes.ts` already carries the single `/comms/send` route, and no `/messages/send` exists anywhere. The key concern is a small unaddressed seam: the `submission_confirmation` trigger's enable/disable gate versus the existing `always_live` public-form confirmation path, which the plan's own AC-126 test will collide with.

## 3. Issues

**[MAJOR] §1 / §4 (AC-125/AC-126 tests) — `submission_confirmation` disable gate bypassed by the existing public-form confirmation path**
The plan's test promises "all seven actual trigger paths produce rows, every trigger can be disabled without a row." But the current `submission_confirmation` wiring is `enqueuePublicFormConfirmation` at `src/routes/public-form.routes.ts:464` → `insertOutbox(input, "always_live")` — it never passes through `enqueueTrigger`'s `template.enabled !== 1` gate, and the form can substitute `thankyou_template_key ?? "submission_confirmation"`. As written, either the AC-126 test fails for that trigger, or the implementer must mid-flight decide whether disabling the trigger suppresses the public-form thank-you (and whether the `always_live` policy survives a gated path). This is exactly the kind of semantic decision that should be settled at plan time — it also touches `public-form.routes.ts`, outside the "module-local under `src/routes/comms.routes.ts` / `src/ui/comms/*`" framing.
**Recommendation:** Add one sentence to §1 stating the chosen semantics — e.g., "the public-form confirmation path checks the stored `submission_confirmation` template's `enabled` gate before calling `enqueuePublicFormConfirmation`; the row it writes remains `always_live` and is not counted as an MRQ-32-created row" — and list `public-form.routes.ts` among the files touched.

**[MINOR] §4 (AC-116) — Portal outcome has a test but no implementation statement**
The test asserts "a rejected submitter's authenticated portal outcome is visible," but the implementation shape never says whether the portal already renders rejection or needs work. `src/routes/portal.routes.ts:377-378` already returns submission `status` + `status_label`, so this is very likely test-only — but the plan should say so, because if the portal UI hides or soft-labels rejected submissions, scope silently appears during implementation.
**Recommendation:** Add a sentence: "AC-116's portal half is already served by `portal.routes.ts` status/status_label and the portal UI; MRQ-32 adds only the test" — or, if inspection shows otherwise, add the (small) UI step explicitly.

**[MINOR] §4 (AC-117) — Provider-delivery assertion vs. hermeticity constraint needs its mechanism named**
The AC-117 test asserts "one provider delivery, and … the provider request carries that row's idempotency key" while the same section forbids invoking a real provider or writing `always_live` rows. This is achievable — the consumer delivers demo-safe rows to `demo_safe_allowlist` addresses (`src/jobs/mail/consumer.ts:125-152`) and stamps `Idempotency-Key` (`consumer.ts:53`), so an allowlisted fixture address plus a mocked fetch does it — but the plan doesn't say which mechanism it will use, and a naive reading makes the two sentences contradictory.
**Recommendation:** Name the mechanism: "the AC-117 delivery assertion uses a `demo_safe_allowlist`-ed fixture address and the existing mocked provider fetch from the mail fixture."

**[MINOR] §1 — Cross-ticket file contention on `src/jobs/cascade/decisions.ts`**
The ticket declares "Shared files: none," but the plan wires `task_assigned` inside `reconcileTaskSet` (`src/jobs/cascade/decisions.ts:268`) — the decision-cascade module that MRQ-28 (two-round funnel, dispatched in the same wave) is most likely to touch. The plan's phase-boundary rebase discipline mitigates this, but the risk isn't named.
**Recommendation:** Add `decisions.ts` (and `public-form.routes.ts`, per the first issue) to a short "files touched outside the comms module" list, and note MRQ-28 as the contention partner so the rebase step knows what to watch for.

## 4. Positive Observations

- **Every claim is verified, not assumed.** The plan's statements about existing code — the two `always_live` writers being the complete set, the seven trigger keys, the UNIQUE-constraint idempotency design, the existing route inventory — all matched the worktree exactly on inspection. This is a plan written after reading the code, and it shows.
- **Correct idempotency posture.** Explicitly refusing a racing pre-check and letting the `sha256(template_key, entity_id, person_id)` UNIQUE constraint decide (§2) is the right call, and the AC-117 test exercises the constraint path rather than the pre-check it declined to build.
- **Route discipline is handled structurally, not aspirationally.** One send route, exactly-one-of enforced server-side, `/messages/send` proven absent via the OpenAPI/registry parity check in `check:api` — the plan leans on the gate that was built to catch exactly this alias.
- **Guardrail tests with positive controls.** Every absence assertion (cross-event preview leak, disabled-trigger no-row) is paired with a positive control proving the test isn't vacuously green — a discipline most plans omit.
- **Baseline and process hygiene.** Recorded base SHA, `npm ci` after refresh, passing baseline with timing, explicit demo-safe policy enumeration promised in the PR body, and a handoff that stops at `pr_open` — all per the orchestration contract.
- **Honest edge-case coverage.** Cancelled-task exclusion from both the selector and the overdue scan, restore-of-cancelled-task not re-notifying, unknown merge fields remaining visible, and the zero-recipient UI state are all named in advance rather than discovered in review.
