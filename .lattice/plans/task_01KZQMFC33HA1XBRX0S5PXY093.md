# MRQ-69: Audit remediation — make the seed exercise the product, wire the applicability guard, and collapse the reviewer-queue query

Full report: `sequence/code-quality-audit.md` (read it first — every finding there carries a file:line, a failure input, and the smallest correct fix). This ticket is the actionable half.

Source: read-only architectural audit of the whole merged tree at `3fd129f` (27 tickets, four models, three harnesses). Baseline verified before filing: `npm ci` clean, `npm run pr-gate -- --ticket MRQ-40` PASS in 26.5s, `npm run check:api` PASS. Nothing below is a regression — every item is something that was never wired, or a check that was never finished.

The unifying defect: **the code is largely correct and the shipped seed cannot exercise it.** This is the venue-coordinates failure (green tests, inert feature) repeating three more times, on the single most-graded screen.

## SCOPE — do these five here

**1. [BLOCKING] Seed 0 answers / 0 attachments → the reviewer detail is empty.**
No module under `scripts/seed/` writes `submission_answers` or `attachments`. Measured on the built seed: `submissions: 1000, submission_answers: 0, attachments: 0`.
`src/routes/review.routes.ts:242-298` LEFT JOINs answers onto form fields, so `fields` returns ~8 non-identity `frm_cfp` rows with `value_text: null`, and `src/ui/review/ReviewerPage.tsx:139-148` maps every null to the literal string `"Not answered"`. A judge opening any of the 1,000 seeded submissions in walkthrough step 8 sees eight rows reading "Not answered" and "Attached files · 0 — No files attached to this submission." `answers` is `[]` for every row.
Green because `tests/integration/api/reviewer-queue.AC-59-65-244-246.test.ts:173-174` proves AC-244 against a fixture that hand-inserts one answer and one attachment. Tier A, no waiver.
Fix: seed 4-6 `submission_answers` per submission from `frm_cfp`'s non-identity fields (`audience_outcome`, `format`, `tracks`, `vendor_content`, and `vendor_product` on the conditional subset — that vendor conditional is a Tier A surface with no shipped instance today), plus one `submission_file` attachment on a subset large enough that the first queue cards have one.

**2. [MAJOR] Seed 0 `kind='session'` submissions, against SPEC §6's required 25-40 sponsor Sessions.**
Measured: `SUBMISSION KIND: { abstract: 1000 }`. Consequences:
- `src/routes/submission-record.routes.ts:548` rejects every seeded row with "only Sessions can be placed on the agenda".
- `:355` `actions.can_schedule` is always false → `src/ui/submissions/SubmissionRecordPage.tsx:96` "Working agenda" card never renders.
- `:357` `can_publish` is false for all 60 accepted (24 scheduled are already `is_published=1`; the other 36 have no slot) → `SubmissionRecordPage.tsx:97` "Publish Session" card never renders.
- The `Session` filter in `SubmissionsPage.tsx:262` and `ProgramBoardPage.tsx:122` returns zero rows, always.
- `bypass_evaluation` has no shipped example.
NOT loop-blocking: the graded scheduling step goes through the agenda pool, and `src/routes/agenda.queries.ts:410-424` filters on status not kind, so the 36 unscheduled accepted abstracts do appear and drag correctly. This is a dead affordance, not a dead end.
Fix: seed ~30 `kind:'session'`, `bypass_evaluation:1`, status `accepted` — a subset unscheduled so `can_schedule` is reachable, one scheduled-but-unpublished so `can_publish` is reachable.
NOTE: run-state.md:82 already routed "0 Sessions" to MRQ-5 on 2026-08-10. MRQ-5 merged and the gap is still open — do not assume it is handled.

**3. [MAJOR] `isFieldApplicable` exists and is never called on a write path.**
`src/lib/form-conditions.ts:262` (`projectApplicableAnswers`) has ZERO production callers — only `tests/unit/form-conditions.AC-132-133.test.ts`. `isFieldApplicable` (`:161`) has one, `src/ui/forms/FormsPage.tsx:169`, the builder *preview*.
The one live answer-write path is `src/routes/submission-record.routes.ts:493-496`, which inserts every supplied answer verbatim; `validateOwnedIds` (`:391-400`) only checks that each `field_id` belongs to the conference.
Repro: `POST /api/v1/events/{eventId}/submissions` with `{"kind":"abstract","title":"…","answers":[{"field_id":"<vendor_product field>","value_text":"x"}]}` and no `vendor_content="Yes"` persists a hidden-by-condition answer. SPEC.md:204 requires those be **absent, not null** (AC-133). The same request persists `"x"` into a field configured `minLength: 8` — `validateField` (`form-conditions.ts:192`) never runs — the AC-25 class.
SPEC.md:175 names four required consumers: public form, builder preview, **server-side submit validation**, draft queue. One of four is wired.
Fix (this ticket owns the admin-create half only): in `createSubmission`, load the form's fields once, run the body's answers through `projectApplicableAnswers`, persist `result.answers` only, 422 on `result.issues`.

**4. [MAJOR] Reviewer queue costs ~203 sequential D1 statements per load.**
`src/routes/review.routes.ts:151-176` fetches 40 candidate IDs (1 statement) then authorizes each — 2 statements apiece via `src/lib/reviewer-scope.ts:83-90` + `:100-130` = 80 — and returns only those that passed. `:361-386` then loops the already-authorized IDs and calls `authorizeReviewerScope` AGAIN at `:371` (another 80) plus one `queueRow` each (40). Eighty of the 203 are the byte-identical round lookup. `reviewerExportRoute:509-513` has the same double pass.
AC-62's 300ms budget is safe (the queue is fetched once and advanced client-side, `ReviewerPage.tsx:261-263`) — this is the *initial* load of a Tier A screen, and speed is graded (R7).
Fix, all safe: (a) delete the duplicate authorize at `:371` — the list it iterates was produced by authorizing every element; (b) hoist the round lookup out of `authorizeReviewerScope`, it is per-round not per-submission; (c) replace the per-ID `queueRow` loop with one `WHERE submission.id IN (…)`. 203 → ~4.

**5. [MAJOR, one line] `pr-gate` never runs `check:api`.**
`scripts/checks/pr-gate.mjs:11-19` runs three tsc projects, vite build, check:design, npm test, trace:ac. EVALUATION.md:50 marks `check:api` "Every PR; the gate".
Be precise about what this buys: it would NOT have caught either manifest-glob dodge, because `check:api` only proves served JSON / rendered docs / operation count all derive from the same manifest — a route missing from the manifest is consistently missing from all three. The half that catches an omitted route is the traffic-parity replay, and it does not exist (`scripts/checks/check-api.mjs:19` defers it to MRQ-9 and its own report says so in `notCoveredHere`; `run-e2e.mjs` is a stub). Today nothing mechanical detects a route leaving the manifest.
Fix here: append `["api parity", "npm", ["run", "check:api"]]` to the gate list. The structural detector is a handoff (see H3).

## HANDOFFS — capture only, do NOT implement here

Each already has a live owner whose ACs cover it. Implementing them here causes a same-file collision — MRQ-23 is **in progress on `check:seed` right now**.

- **H1 → MRQ-23 (IN PROGRESS).** `check:seed` implements ~10% of its contract: `scripts/checks/check-seed.mjs` is 47 lines, six assertions, all venue geography. EVALUATION.md:48 requires counts, status distribution, format/track coverage, agenda density, the deliberate ugliness, and "the organizer demo persona's review queue returns ≥20 unreviewed candidates". SPEC §6 adds "at least two live double-bookings".
  I reimplemented the missing assertions out-of-band so MRQ-23 knows what already holds: organizer queue **40** reachable (0 blocked on track intersection, 0 already evaluated) ✅ · speaker on 3 submissions ✅ · 4-person panel ✅ · 1 overdue task ✅ (thin — SPEC says "set") · 3 room clashes + 2 person clashes ✅ · status mix accepted 60 / rejected 550 / draft 40 / waitlisted 70 ✅, in_review 280 vs ~350 spec'd ⚠ · answers 0, attachments 0, sessions 0 ❌ (items 1 and 2 above).
  Six of seven pass today — pure regression insurance. Two fail and are this ticket's items 1 and 2. **MRQ-23 must not land its seed assertions before items 1-2 land, or its own gate goes red.** Sequence them.
- **H2 → MRQ-42.** `trace:ac` cannot tell which suite covered an AC. `scripts/checks/trace-ac-core.mjs:60-77` credits an AC to any test whose title contains its ID, wherever it lives; the EVALUATION §2 evidence column (`e2e:` / `test:` / `check:`) is parsed only for the tag. Measured against the gate's own `ac-coverage.json`: 212 live ACs, 125 whose evidence names `e2e:`, of which **54 are covered ONLY by non-e2e tests** and 71 have zero tests. `tests/e2e/` does not exist (`run-e2e.mjs:9-14` is a stub; `playwright.config.ts` points at an absent dir). `--scope=all` at CP-2 will report those 54 green. Fix: match the evidence-command prefix against the covering test's path; warn on `merged`, fail on `all`. MRQ-42 should fix its own definition of "covered" before closing coverage against it.
- **H3 → MRQ-42.** Structural manifest-dodge detector that needs no deployed URL: assert no module under `src/` calls `.get/.post/.put/.patch/.delete/.on` on a Hono app except `src/routes/*.routes.ts` and the three named SSR page modules (`landing.route.tsx`, `public-agenda.route.tsx`, `embed.route.tsx`). I ran this by hand — **the tree is clean today**, so it lands green and stays honest.
- **H4 → MRQ-50.** Blind-mode redaction is a fail-open substring denylist on field keys (`src/routes/review.routes.ts:251-259`, `:283-296`: key contains name/email/company/bio/headshot/speaker/submitter/contact/phone). Every seeded key is covered, but the builder mints arbitrary keys (`forms.routes.ts:565`) — `linkedin`, `employer`, `github`, `who_are_you`, `org` all flow into the blind detail and the CSV export. SPEC §7 G9 says identity is stripped "by construction"; a denylist is a guess that is right about the seed. Fix: `form_fields.is_identity` flag, or invert to a type allowlist. **MRQ-50's byte-scan must run against a form carrying a non-matching identity key, not only the seeded form**, or the audit inherits the blind spot.
- **H5 → MRQ-51.** AC-214 has zero tests and the tracer structurally cannot notice: `grep -rn "AC-214" tests/` returns nothing, and because AC-214 has no EVALUATION §2 row by design (post-competition range) it never enters `parseEvaluationContract`'s map, so `--scope=all` can never flag it. run-state.md:100 records MRQ-3 being told to confirm the test exists; it does not. Behaviour looks correct (`scope-resolution.ts:42`, schema CHECK `migrations/0001_init.sql:159`, `reviewer-scope.ts:92-95`) — this is a missing assertion, not a live leak. Add one test: two events, reviewer scoped to A, 403 with no metadata on every reviewer route of B.
- **H6 → MRQ-51 or MRQ-47.** `roleForEvent` (`src/lib/auth/scope-resolution.ts:36-47`) ignores `org_id`: a membership with `event_id IS NULL` matches ANY eventId and the function never checks the event belongs to `membership.org_id`. Same in `principalHasGrant` (`src/api/router.ts:121-123`). `memberships.event_id` is nullable (`migrations/0001_init.sql:152`). Latent, not live — nothing writes a NULL-event membership today and the demo is single-org. Fix: require `membership.org_id === event.org_id`; `requireFormAccess` (`forms.routes.ts:201-205`) already does this and is the only one of four guards that does.
- **H7 → MRQ-51.** `tests/integration/api/reviewer-queue.AC-59-65-244-246.test.ts:188-201` asserts 403 and a clean body on an out-of-scope evaluation POST but never that no row was written. Not a live defect — the guard runs at `review.routes.ts:548`, before the insert at `:555`. One line: `SELECT COUNT(*) FROM evaluations WHERE submission_id = OUT_OF_SCOPE_ID` → 0.
- **H8 → MRQ-15 (IN PROGRESS) and MRQ-34 (IN PROGRESS).** The other three consumers of `projectApplicableAnswers` named in SPEC.md:175. Brief both now so they call the shared projector rather than writing a second evaluator — that is exactly how a second condition evaluator gets born.

## Verified-clean, recorded so nobody re-does the work

- **The manifest dodge is closed today.** No HTTP write handler exists outside `src/routes/*.routes.ts` — every `.get/.post/.put/.patch/.delete` call in `src/` was checked.
- **All 38 `authenticated`-policy routes are guarded.** evaluation 14 routes / 14 call sites (`requireProgram`); comms 7/7 (`requireComms`); forms 17/17 (`requireFormAccess`/`getOwnedForm`, lifecycle routes via `setFormLifecycle:488-489`, field routes via `getField:257-258`). No hole.
- **G3 mail containment holds as specified (pre-clears part of MRQ-45).** `insertOutbox` defaults to `demo_safe` (`src/jobs/mail/outbox.ts:53-56`); exactly TWO `always_live` write sites (`:126` public-form confirmation, guarded by a typed-address equality check at `:123`; `:131` the smoke harness); consumer-side suppression is the single choke point (`src/jobs/mail/consumer.ts:137-147`); seed sets `demo_mode: 1` (`scripts/seed/event.ts:95`).
- **AC-246 centralization holds.** queue, detail, files, export, and evaluation-write all call `authorizeReviewerScope`.
- **`Principal`/`AuthContext` did not fork** — one union with an alias (`scope-resolution.ts:24`). Likewise one list/pagination contract, one condition evaluator, one presign path, one outbox writer.

## Acceptance

1. Built seed reports non-zero `submission_answers` and `attachments`, and ≥25 `kind='session'` submissions.
2. Opening any seeded submission in the reviewer detail shows populated evaluator fields and at least one attachment on the first queue cards — no row reading "Not answered".
3. A seeded accepted Session exists for which `actions.can_schedule` is true, and one for which `actions.can_publish` is true.
4. `POST /api/v1/events/{eventId}/submissions` carrying an answer for a field whose condition is unmet persists NO row for that field (assert the row count, not the status code), and 422s on a value violating the field's own config.
5. A reviewer queue load issues single-digit D1 statements; the duplicate `authorizeReviewerScope` at `review.routes.ts:371` is gone.
6. `npm run pr-gate` runs `check:api`.
7. `npm run pr-gate -- --ticket MRQ-69` PASS, still inside the 30s `npm test` budget.
8. Handoffs H1-H8 are recorded on their target tickets (comment or description), not implemented here.

Filed by the code-quality auditor; read-only pass, no source touched.
