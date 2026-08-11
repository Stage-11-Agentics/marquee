# Plan Review: MRQ-69 — audit remediation

## 1. Verdict

**PASS** — with two major issues that must be resolved during implementation (both are semantic clarifications inside the plan's existing structure, not structural gaps requiring re-planning). The plan's own guardrails (database-as-oracle tests, full pr-gate before PR) would surface both if mishandled, but resolving them deliberately up front is much cheaper than discovering them in a red gate.

## 2. Summary

Reviewed the MRQ-69 plan against the ticket's five scope items, eight handoffs, and eight acceptance criteria, with the claims spot-verified against the working tree (`form-conditions.ts`, `submission-record.routes.ts`, `review.routes.ts`, `pr-gate.mjs`, `scripts/seed/event.ts`, and the existing admin-create integration tests). The plan is well-scoped, respects the handoff boundaries (notably staying out of `check-seed.mjs` while MRQ-23 holds it), and its verification sequence maps cleanly onto the acceptance criteria. The key concern is that scope item 2 ("422 on `result.issues`") is under-specified in a way that, implemented literally, breaks existing green tests — and the seed-answer count in the plan cannot satisfy acceptance criterion 2 as written.

## 3. Issues

**[MAJOR] In-scope §2 (admin-create applicability) — "422 on projector issues" implemented literally breaks existing admin-create tests**
`projectApplicableAnswers` (`src/lib/form-conditions.ts:262-276`) iterates **all** fields and, via `validateField` (`:194`), emits a "This field is required." issue for every applicable required field with an empty answer. The seeded CFP form has ~11 required fields. Meanwhile the existing admin-create tests (`tests/integration/api/submission-record-board.AC-118-120-238-240-243-251.test.ts:102-121` and onward) POST submissions with **no `answers` and no `form_id`** and assert 201. A naive "run all answers through the projector, 422 on any issue" therefore fails every existing admin create — the pr-gate goes red at `npm test`, discovered late. There is also an impedance mismatch the plan doesn't mention: the request body's answers are keyed by `field_id`, while the projector is keyed by `field.key` — a mapping in both directions is required.
**Recommendation:** Decide and state the semantics before coding: (a) when the body supplies no answers, skip projection entirely (admin minimal-record creation stays legal); (b) when answers are supplied, map `field_id → key`, project, and filter `result.issues` to the **supplied** field keys — enforce applicability and per-field config on what was sent, not required-completeness of the whole form (that enforcement belongs to the public form/draft consumers owned by MRQ-15/MRQ-34); (c) specify which form's fields load when `form_id` is absent but answers reference fields (resolve the form via the supplied `field_id`s, since `validateOwnedIds:441-450` already allows any form of the event).

**[MAJOR] In-scope §1 (seed answers) — "4-6 answers per submission" cannot satisfy acceptance criterion 2's "no row reading 'Not answered'"**
The reviewer detail LEFT JOINs answers onto **all** non-identity form fields, and `displayField` (`src/ui/review/ReviewerPage.tsx:141-149`) renders every null as "Not answered". Counting against the denylist, the seeded CFP form has exactly **8** non-identity fields: `title`, `abstract`, `audience_outcome`, `format`, `tracks`, `supporting_file`, `vendor_content`, `vendor_product` (`scripts/seed/event.ts:264-279`). The ticket's fix text names only five fields; the plan repeats "4-6 non-identity answers". Seeding only those leaves `title`, `abstract`, and `supporting_file` rows rendering "Not answered" on every submission — acceptance 2 fails as written, or passes only under a charitable reading nobody has agreed to.
**Recommendation:** Seed an answer for **every applicable non-identity field**: mirror `submissions.title`/`abstract` into the `title`/`abstract` field answers, and tie the `supporting_file` answer to the seeded attachment on the subset that has one (with `vendor_product` present only where `vendor_content = "Yes"`). If the implementer instead interprets acceptance 2 narrowly, that interpretation must be raised to the Orchestrator, not silently assumed.

**[MINOR] In-scope §3 (queue collapse) — statement-count probe mechanism unspecified**
No statement-counting instrument exists in `tests/` today. "Add or update a speed/shape probe that proves single-digit D1 statements" is the right intent but names no mechanism, and this is the piece most likely to eat unplanned time.
**Recommendation:** Name it in the plan: wrap the test environment's `env.DB` in a counting proxy around `prepare()` (or `batch()`), run one queue request, assert the count. Keep it in the hermetic suite so it guards the fix permanently.

**[MINOR] In-scope §1 (sessions) — side effects on invariants other tickets measure are not called out**
Adding ~30 accepted Sessions moves the status mix (accepted 60 → ~90) that the ticket's own H1 brief records as currently passing, and the scheduled-but-unpublished Session adds an agenda slot that must not create an unintended clash or perturb the organizer queue of 40 (Sessions bypass evaluation, so they must receive no `round_assignments`). The plan says "preserve existing fixtures" but doesn't state these three invariants explicitly, and the H1 handoff comment should carry the **post-MRQ-69** counts so MRQ-23 asserts the new reality, not the audit's snapshot.
**Recommendation:** Add to §1: no round assignments for seeded Sessions; the new slot placed clash-free in an empty room/time; and include the updated distribution numbers in the H1 handoff text.

**[MINOR] In-scope §4 / Verification — pr-gate wall budget not acknowledged**
`pr-gate.mjs` enforces a 45s **wall** budget (`PR_GATE_BUDGET_MS`, line 22) on top of the 30s `npm test` budget the plan tracks. Baseline is 26.5s; this ticket adds `check:api` to the list plus new tests. Headroom is probably fine, but the plan only promises to record the default-suite duration.
**Recommendation:** Record the full gate wall time too, and treat approaching 45s as a finding to report, not absorb.

**[MINOR] Verification §3-4 — acceptance 3 has no explicit probe**
The plan seeds Sessions so `can_schedule`/`can_publish` are *reachable* but never says it will assert `actions.can_schedule === true` / `actions.can_publish === true` through the record endpoint for a seeded Session (acceptance 3 requires exactly that).
**Recommendation:** Add one assertion each against `GET`/record payload for a seeded unscheduled accepted Session and the scheduled-unpublished one.

**[MINOR] In-scope §1 — files to be modified not enumerated for the seed work**
The plan names exact files for scope items 2-4 but describes the seed work only as "extend the deterministic seed". `scripts/seed/` has a clear module structure (`pool.ts`, `accepted-core.ts`, `event.ts`, `agenda.ts`, …); saying where answers/attachments/sessions land (new module vs. extending `pool.ts`) would make the diff reviewable against intent.
**Recommendation:** One sentence naming the target seed modules (or the decision to add e.g. `answers.ts`) before implementation starts.

## 4. Positive Observations

- **Handoff discipline is exactly right.** The plan records H1-H8 on their owners and explicitly refuses to touch `check-seed.mjs` while MRQ-23 is in progress — the precise collision the ticket warns about. The MRQ-23 sequencing hazard is respected rather than absorbed.
- **The proof strategy targets the actual failure mode.** Requiring the reviewer-detail proof to run against a *seeded* submission (not a hand-built fixture) directly attacks the "green tests, inert feature" pattern the audit is about. Same for using the database as the oracle on the hidden-condition test (row absence, not status code) with a positive control — that matches acceptance 4's letter.
- **Feasibility of scope item 2's core is confirmed.** `projectApplicableAnswers` already runs `validateField`, so the minLength-422 case falls out of the shared projector with no second evaluator — the plan correctly commits to the shared seam.
- **Deliberate independence from line numbers.** The audit's line references have already drifted (the tree has moved since `3fd129f`); the plan's "without relying on line numbers" for the queue probe shows awareness that the audit is a map, not a diff.
- **Verification sequence is complete and ordered**: rebase hygiene, focused tests, seed-against-disposable-DB counts, full gate, self-review, review/validation transitions, PR, and the terminal c11 notification — nothing in the lifecycle contract is missing.

---

*Reviewed with the working tree as evidence: `form-conditions.ts:161-292`, `submission-record.routes.ts:380-519`, `review.routes.ts:240-395`, `pr-gate.mjs` (full), `scripts/seed/event.ts:250-294`, `ReviewerPage.tsx:141-149`, `submission-record-board.AC-118-120-238-240-243-251.test.ts:90-200`, and the `scripts/seed/`+`scripts/checks/` listings.*
