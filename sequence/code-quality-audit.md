# Marquee — Code Quality Audit

**Auditor:** read-only architectural + quality pass over the whole merged tree.
**Base:** pinned snapshot of `forgejo/master` at `3fd129f` (27 tickets merged, four models, three harnesses).
**Date:** 2026-08-11.
**Method:** `npm ci` clean; `npm run pr-gate -- --ticket MRQ-40` **PASS in 26.5 s** (types ×3, vite build, check:design, 33 tests, trace:ac merged); `npm run check:api` **PASS**; plus out-of-band analysis of the built seed and the full route/authorization matrix. Every finding below was traced end to end in the code; where something is a suspicion rather than a confirmation it says so.

---

## Verdict

This is a healthy codebase for thirty hours old and four authors — much healthier than the ticket count suggests. The API core is genuinely single-source (one route object generates the handler, the OpenAPI document, and the registry), reviewer resource authorization really does funnel through one helper, the two `always_live` mail sites are exactly two, and the `Principal`/`AuthContext` seam that usually forks in multi-model builds was reconciled rather than duplicated. The route-manifest dodge is closed today: **no HTTP write handler exists outside `src/routes/*.routes.ts`** — I checked every `.get/.post/.put/.patch/.delete` call in `src/`.

The weakness is not the code. It is that **the shipped seed cannot exercise the code**, and the checks that were designed to notice that were never finished. The venue-coordinates defect the run already caught was not a one-off — it is the tree's dominant failure mode, and three more instances of it are live right now on the single most-graded screen. Fix the seed and finish `check:seed`, and this build is in good shape.

---

## Findings

Ordered by severity. Every one carries a `file:line`, a concrete failure input, and the smallest correct fix.

---

### 1 · BLOCKING — the reviewer detail screen is empty on the shipped seed (0 answers, 0 attachments)

**Where.** Seed: no module under `scripts/seed/` writes `submission_answers` or `attachments` — `scripts/seed/pool.ts`, `accepted-core.ts`, `ugliness.ts` all skip them. Reader: `src/routes/review.routes.ts:242-298`. Render: `src/ui/review/ReviewerPage.tsx:139-148` (`displayField`), `:369` (fields grid), `:372` (files section).

**Measured.** Building the seed and counting rows:

```
submissions: 1000    submission_answers: 0    attachments: 0
```

**What breaks.** Walkthrough step 8 is Tier A, no-waiver. `detailRow`'s `fields` subquery `LEFT JOIN`s `submission_answers`, so it returns the ~8 non-identity `frm_cfp` fields with `value_text: null`. `displayField` maps every null to the literal string `"Not answered"`. So a judge who opens any of the 1,000 seeded submissions in the reviewer detail sees **eight rows all reading "Not answered"**, then **"Attached files · 0 — No files attached to this submission."** The `answers` array is `[]` for every row.

**Why the gate is green.** `tests/integration/api/reviewer-queue.AC-59-65-244-246.test.ts:173-174` proves AC-244 against a hand-built fixture that inserts one answer (`audience_outcome: "Build reliable systems"`) and one attachment (`reviewer-guide.pdf`). The code is correct; the data it will actually meet is empty. This is the venue-coordinates defect exactly — green test, inert feature.

**Smallest fix.** In the pool seeder, write 4–6 `submission_answers` per submission drawn from `frm_cfp`'s non-identity fields (`audience_outcome`, `format`, `tracks`, `vendor_content`, and `vendor_product` on the conditional subset — the last one is the SPEC §5.4 vendor conditional and currently has no shipped instance either), and one `submission_file` attachment on a subset large enough that the first few queue cards have one. Then add both to `check:seed` (finding 5).

**Ticket routing.** MRQ-5 owns the pool; it is `done`, so this needs a **new ticket** or a reopen. The assertion half belongs to **MRQ-23** (in progress).

---

### 2 · MAJOR — the seed ships zero `kind='session'` submissions, against SPEC §6

**Where.** `scripts/seed/pool.ts` / `accepted-core.ts` — all 1,000 rows are `kind: 'abstract'`. SPEC §6 status mix requires **"sponsor Sessions ~25–40 (bypass the competitive path)"**.

**Measured.** `SUBMISSION KIND: { abstract: 1000 }`.

**What breaks.**

- `src/routes/submission-record.routes.ts:548` — `POST /api/v1/events/{id}/submissions/{id}/schedule` throws `unprocessable("only Sessions can be placed on the agenda")` for **every** seeded submission.
- `src/routes/submission-record.routes.ts:355` — `actions.can_schedule` is `kind === "session" && …`, therefore always `false`, so the record page's "Working agenda" card (`src/ui/submissions/SubmissionRecordPage.tsx:96`) **never renders on the demo**.
- `actions.can_publish` (`:357`) is also false for all 60 accepted rows: the 24 that have an agenda slot are already `is_published = 1`, and the other 36 have no slot. So the "Publish Session" card (`SubmissionRecordPage.tsx:97`) never renders either.
- The `Session` option in the submissions filter (`SubmissionsPage.tsx:262`) and the program board's type filter (`ProgramBoardPage.tsx:122`) return zero rows, always.
- The `bypass_evaluation` path — a real differentiator — has no shipped example a judge can open.

**Not loop-blocking.** The graded scheduling step (US-50/51, AC-70-75) goes through the agenda pool, and `readPool` (`src/routes/agenda.queries.ts:410-424`) filters on *status*, not kind — so the 36 unscheduled accepted abstracts do appear and drag correctly. This is a dead affordance, not a dead end.

**Note for the orchestrator.** `run-state.md:82` already routed "0 Sessions" to MRQ-5 on 2026-08-10. MRQ-5 merged and the gap is still open.

**Smallest fix.** Seed ~30 sponsor submissions with `kind: 'session'`, `bypass_evaluation: 1`, status `accepted`, a subset unscheduled so `can_schedule` is reachable and one scheduled-but-unpublished so `can_publish` is reachable.

**Ticket routing.** New ticket (MRQ-5 is closed), or fold into the same seed ticket as finding 1.

---

### 3 · MAJOR — `isFieldApplicable` exists and is never called on a write path

**Where.** `src/lib/form-conditions.ts:262` (`projectApplicableAnswers`) and `:161` (`isFieldApplicable`). Production callers: **one**, `src/ui/forms/FormsPage.tsx:169` — the builder *preview*. `projectApplicableAnswers` has **zero** production callers; only `tests/unit/form-conditions.AC-132-133.test.ts` uses it.

The one live answer-write path is `src/routes/submission-record.routes.ts:493-496`, which inserts every supplied answer verbatim. Its only validation is `validateOwnedIds` (`:391-400`), which checks that each `field_id` belongs to the conference — nothing about applicability, and nothing about the field's own rules.

**What breaks.** `POST /api/v1/events/{eventId}/submissions` with

```json
{"kind":"abstract","title":"…","answers":[{"field_id":"<vendor_product field>","value_text":"x"}]}
```

and no `vendor_content = "Yes"` answer persists a hidden-by-condition answer. SPEC.md:204 says those must be **absent, not null** (AC-133). The same request also persists `"x"` into a field configured `minLength: 8` — `validateField` (`form-conditions.ts:192`) never runs — which is the AC-25 class ("a crafted request bypassing the client cannot persist an invalid record").

SPEC.md:175 names the required consumers explicitly: *"the public form (§5.5), the builder preview (§5.4), **server-side submit validation**, and the draft queue's applicable-missing-fields computation."* One of four is wired.

**Smallest fix.** In `createSubmission`, load the form's fields once and run the body's answers through `projectApplicableAnswers`; persist `result.answers` only, and 422 on `result.issues`.

**Ticket routing.** The public-form half is **MRQ-15** (in progress) — brief it now so it uses the shared projector rather than writing a second evaluator. The draft-queue half is **MRQ-34** (in progress). The admin-create half needs a **new ticket** (MRQ-33 follow-up).

---

### 4 · MAJOR — `trace:ac` cannot tell which suite covered an AC; 54 `e2e:` criteria are green on unit tests

**Where.** `scripts/checks/trace-ac-core.mjs:60-77`. `parseEvaluationContract` reads only the *tag* cell (`auto`/`op-assist`/`oracle`/`felt`); `buildCoverage` then credits an AC to any test whose title contains its ID, wherever that test lives. The EVALUATION §2 evidence column — which names the suite (`e2e:` / `test:` / `check:seed:` / `repo:`) — is never compared against the covering file.

**Measured.** Cross-referencing `EVALUATION.md`'s §2 rows against the gate's own `ac-coverage.json`:

```
live ACs in coverage:                                    212
ACs whose EVALUATION evidence names e2e:                 125
  … of those, covered ONLY by non-e2e tests:              54
  … of those, with zero tests at all:                     71
```

`tests/e2e/` **does not exist** — `scripts/checks/run-e2e.mjs:9-14` is a stub, and `playwright.config.ts` points `testDir` at an absent directory. So all 54 are covered by unit/integration tests standing in for a browser-driven loop assertion.

**What breaks.** `npm run trace:ac --scope=all` is the CP-2 gate. It will report those 54 green. The 71 zero-coverage ACs *will* be caught, so the gate is not useless — but the substitution class is invisible to it, and it is the larger number of the two that matters, because those ACs look done.

**Smallest fix.** Extract the leading command token from each AC's evidence cell and require at least one covering test whose path matches that suite (`tests/e2e/**` for `e2e:`, `tests/{unit,integration}/**` for `test:`). Warn under `--scope=merged`, fail under `--scope=all`.

**Ticket routing.** **MRQ-42** (AC-coverage closure). Worth telling MRQ-42 that its own definition of "covered" is the thing to fix first.

---

### 5 · MAJOR — `check:seed` implements about a tenth of its contract

**Where.** `scripts/checks/check-seed.mjs` — 47 lines, six assertions, **all about venue geography**.

EVALUATION.md:48 specifies: *"counts, status distribution, format/track coverage, agenda density, the deliberate ugliness (a speaker on 3 submissions, a 4-person panel, an overdue task set, a live double-booking), and that **the organizer demo persona's review queue returns ≥20 unreviewed candidates**."* SPEC §6 adds *"at least two live double-bookings visible in the agenda on load."*

**What breaks.** Nothing at runtime — but this is the check whose entire purpose is to catch findings 1 and 2, and it caught neither. It is also the only mechanical guarantee that walkthrough step 8 has an entry at all.

**What I verified out-of-band, so MRQ-23 knows what already holds.** I reimplemented the missing assertions against the built seed:

| Obligation | Actual | Verdict |
|---|---|---|
| Organizer queue ≥20 unreviewed | **40** reachable (0 blocked on track intersection, 0 already evaluated) | ✅ holds |
| A speaker on 3 submissions | max 3 per person | ✅ holds |
| A 4-person panel | max panel size 4 | ✅ holds |
| An overdue task set | 1 overdue `speaker_task` | ✅ holds (thin — SPEC says "set") |
| ≥2 live double-bookings | 3 room clashes, 2 person clashes | ✅ holds |
| Status distribution vs SPEC §6 | accepted 60 ✅ · rejected 550 ✅ · draft 40 ✅ · waitlisted 70 ✅ · in_review 280 vs ~350 spec'd · **sessions 0 vs 25–40 spec'd** | ⚠ see finding 2 |
| Seeded answers / attachments | 0 / 0 | ❌ see finding 1 |

**Smallest fix.** Add the seven assertions above to `check-seed.mjs`. Six of them pass today, so they are pure regression insurance; two fail and are findings 1 and 2.

**Ticket routing.** **MRQ-23** ("Seed and speed check suites", in progress) — this is squarely its job. Send it this table.

---

### 6 · MAJOR — the reviewer queue costs ~203 sequential D1 statements per load

**Where.** `src/routes/review.routes.ts:151-176` (`reviewerQueue`) and `:361-386` (`reviewerQueuePayload`).

**What happens.** `reviewerQueue` fetches the 40 candidate IDs (1 statement), then calls `authorizeReviewerScope` on each — 2 statements apiece (`src/lib/reviewer-scope.ts:83-90` round lookup, then `:100-130` the EXISTS probe) = 80. It returns only the IDs that passed. `reviewerQueuePayload` then loops over those same already-authorized IDs and **calls `authorizeReviewerScope` again** at `:371` — another 80 — plus one `queueRow` each = 40. With `activeRoundForEvent` and `reviewerTrackScopes`, that is **203 sequential awaited D1 statements** to paint walkthrough step 8's first screen. Eighty of them are the byte-identical round lookup. `reviewerExportRoute:509-513` has the same double pass.

Speed is a graded feature (R7) and this is a Tier A screen. AC-62's 300 ms budget is safe — the queue is fetched once and advanced client-side (`ReviewerPage.tsx:261-263`) — so this is the *initial* load, which has no named budget but is the judge's first impression of the review surface.

**Smallest fix, all safe.** (a) Delete the duplicate `authorizeReviewerScope` at `:371` — the list it iterates was produced by authorizing every element. (b) Hoist the round lookup out of `authorizeReviewerScope` (it is per-round, not per-submission). (c) Replace the per-ID `queueRow` loop with one `WHERE submission.id IN (…)`. That takes 203 → ~4.

**Ticket routing.** **MRQ-23** owns `check:speed` and would surface it; the code fix wants a **new ticket** or a fold into MRQ-51 (reviewer isolation audit), which is already reading these exact lines.

---

### 7 · MAJOR — `pr-gate` never runs `check:api`

**Where.** `scripts/checks/pr-gate.mjs:11-19`. The gate runs three `tsc` projects, `vite build`, `check:design`, `npm test`, and `trace:ac --scope=merged`. EVALUATION.md:50 marks `check:api` **"Every PR; the gate"**. It is not there. Neither is `check:repo` (which additionally cannot run without `--repo`/`--ref`, `scripts/checks/check-repo.mjs:21`) or `check:seed`.

**Be precise about what this would and would not have caught.** Adding `check:api` to the gate closes a contract gap, but it would **not** have caught either manifest-glob dodge, because `check:api` only proves that the served JSON, the rendered docs, and the operation count all derive from the same manifest — a route missing from the manifest is consistently missing from all three. The half that catches an omitted route is the traffic-parity replay, and it does not exist: `scripts/checks/check-api.mjs:19` defers it to MRQ-9 and its own report says so in a `notCoveredHere` field, while `run-e2e.mjs` is a stub. So today **nothing mechanical detects a route that leaves the manifest.**

**Smallest fix, two parts.** (a) Append `["api parity", "npm", ["run", "check:api"]]` to the gate's check list. (b) Add a cheap structural detector that does not need a deployed URL: assert that no module under `src/` calls `.get/.post/.put/.patch/.delete/.on` on a Hono app except `src/routes/*.routes.ts` and the three named SSR page modules (`landing.route.tsx`, `public-agenda.route.tsx`, `embed.route.tsx`). I ran that check by hand against this tree — **it is clean today**, so the detector lands green and stays honest.

**Ticket routing.** (a) is a one-line change, fold into **MRQ-23** or **MRQ-42**. (b) is **MRQ-42** (public-repo assembly / coverage closure).

---

### 8 · MINOR — blind-mode redaction is a substring denylist on field keys, and it fails open

**Where.** `src/routes/review.routes.ts:251-259` and `:283-296` — the reviewer detail excludes any `form_fields` row whose lowercased `key` contains `name`, `email`, `company`, `bio`, `headshot`, `speaker`, `submitter`, `contact`, or `phone`.

**Status today: safe.** Every key the seed ships is covered — `speaker_name`, `speaker_email`, `speaker_role`, `speaker_company`, `co_speaker_*` (`%speaker%`), `biography` (`%bio%`), `headshot` (`%headshot%`).

**What breaks.** The form builder lets an organizer mint any key (`POST /api/v1/events/{eventId}/forms/{formId}/fields`, `forms.routes.ts:565`). A field keyed `linkedin`, `employer`, `github`, `who_are_you`, or `org` matches nothing on the list and flows straight into the blind reviewer detail — and, via `reviewerExportRoute`, into the CSV. SPEC §7 G9 states identity is stripped *"in the query layer … so API responses and exports are covered **by construction**."* A substring denylist is not by construction; it is a guess that is right about the seed.

**Smallest fix.** Make identity explicit rather than inferred — a `form_fields.is_identity` flag set by the builder for the known identity field types, filtered on in both subqueries. Failing that (no migration budget), invert to an allowlist of evaluator-visible field *types*.

**Ticket routing.** **MRQ-50** ("Audit — reviewer anonymity byte-scan"). Its byte-scan should be run against a form carrying a non-matching identity key, not only the seeded form — otherwise the audit inherits the same blind spot.

---

### 9 · MINOR — AC-214 has zero tests, and the tracer structurally cannot notice

**Where.** `grep -rn "AC-214" tests/` returns nothing. The only occurrence in the tree is a comment at `src/lib/auth/scope-resolution.ts:32`.

AC-214 sits in the post-competition range, so it deliberately has no EVALUATION §2 row — which means `parseEvaluationContract` (`trace-ac-core.mjs:6-16`) never puts it in the criteria map, and `--scope=all` can never flag it. `run-state.md:100` records the orchestrator telling MRQ-3 to *"confirm the enforcement test exists and name it in the PR body."* It does not exist.

**Is the behaviour right?** Yes, as far as I can trace it. `roleForEvent` (`scope-resolution.ts:42`) drops any `reviewer` membership whose `event_id` differs, the schema enforces `CHECK (role <> 'reviewer' OR event_id IS NOT NULL)` (`migrations/0001_init.sql:159`), and `authorizeReviewerScope` re-checks `round.event_id !== request.eventId` (`reviewer-scope.ts:92-95`). So this is a missing assertion on a named enforcement obligation, **not a live leak** — the one AC in the tree whose stated obligation is "asserted in `test:` from the first migration" and which no gate can see.

**Smallest fix.** One integration test: two events, a reviewer scoped to A, assert 403 with no metadata on every reviewer route of B — titled `AC-214 · …` so it becomes visible if the AC ever gains a row.

**Ticket routing.** **MRQ-51** ("Audit — reviewer event and track isolation").

---

### 10 · MINOR — `roleForEvent` ignores `org_id`, so an org-wide membership crosses org boundaries

**Where.** `src/lib/auth/scope-resolution.ts:36-47`. A membership with `event_id IS NULL` matches **any** `eventId`, and the function never checks that the event belongs to `membership.org_id`. `memberships.event_id` is nullable (`migrations/0001_init.sql:152`) and `org_id` is carried on the row but never consulted. Same shape in `principalHasGrant` (`src/api/router.ts:121-123`).

**Latent, not live.** Nothing in the tree writes a NULL-`event_id` membership today (`scripts/seed/evaluations.ts:24-34` always sets `EVENT_ID`), and the demo is single-org — so this cannot fire on the shipped artifact. It becomes real the first time an org-wide owner role is issued, which SPEC §4.1's role model contemplates.

**Smallest fix.** Resolve the event's `org_id` once and require `membership.org_id === event.org_id`. `requireFormAccess` already does exactly this (`forms.routes.ts:201-205`) — it is the only one of the four guards that does.

**Ticket routing.** **MRQ-51**, or **MRQ-47** ("cookie scope and session issuance") if that ticket is enumerating credential preconditions anyway.

---

### 11 · MINOR — the AC-246 guardrail test asserts a 403 and a clean body, but not "no row written"

**Where.** `tests/integration/api/reviewer-queue.AC-59-65-244-246.test.ts:188-201`. It POSTs to `/rounds/{id}/submissions/{out-of-scope}/evaluations`, asserts `403`, and asserts the body contains none of the out-of-scope ID, title, or organizer name. That is already better than most — but it never checks that no `evaluations` row landed.

**Not a live defect.** `authorizeReviewerScope` runs at `review.routes.ts:548`, before the insert at `:555`. The order is correct today. The test simply would not notice if it stopped being.

**Smallest fix.** One line: after the loop, `SELECT COUNT(*) FROM evaluations WHERE submission_id = OUT_OF_SCOPE_ID` and assert `0`.

**Ticket routing.** **MRQ-51**.

---

### 12 · NOTE — two authorization idioms, three near-identical private helpers

**Where.** Of 88 route policies, **34 are declarative `grants:`** (enforced by the pipeline's `authorize()`, `src/api/router.ts:47-64`) and **38 are `auth: { kind: "authenticated" }`** — the entire contents of `evaluation.routes.ts`, `forms.routes.ts`, and `comms.routes.ts` — which push authorization into the handler through three private helpers: `requireProgram` (`evaluation.routes.ts:120-140`), `requireComms` (`comms.routes.ts:86-99`), and `requireFormAccess` (`forms.routes.ts:193-218`).

**I checked all 38 and every one is guarded.** There is no hole. Recording the verification so nobody re-does it: evaluation 14 routes / 14 call sites; comms 7 / 7; forms 17 / 17 (lifecycle routes via `setFormLifecycle:488-489`, field routes via `getField:257-258`).

The cost is drift, not exposure. The role→grant mapping now exists twice with different tables (`router.ts:66-97` `MINIMUM_ROLE_BY_GRANT` + `LEGACY_ROLE_GRANTS`, vs `scope-resolution.ts:66-77` `minimumGrantByRole`), the three helpers each re-derive the token event-scope branch, and only one of them checks the org boundary (finding 10). See the architecture note.

---

## Ticket routing summary

| # | Severity | Finding | Route to |
|---|---|---|---|
| 1 | **BLOCKING** | Seed has 0 answers, 0 attachments → reviewer detail is empty | **New ticket** (MRQ-5 closed) · assertion half → **MRQ-23** |
| 2 | MAJOR | Seed has 0 `kind='session'` submissions → schedule/publish cards never render | **New ticket** (previously routed to MRQ-5, did not land) |
| 3 | MAJOR | `isFieldApplicable` never invoked on a write path | **MRQ-15** + **MRQ-34** (brief now) · admin-create half → **new ticket** |
| 4 | MAJOR | `trace:ac` blind to suite type; 54 `e2e:` ACs green on unit tests | **MRQ-42** |
| 5 | MAJOR | `check:seed` is ~10% implemented | **MRQ-23** |
| 6 | MAJOR | Reviewer queue = ~203 sequential D1 statements | **New ticket**, or fold into **MRQ-51** |
| 7 | MAJOR | `pr-gate` omits `check:api`; nothing detects a route leaving the manifest | **MRQ-42** (+ one-line gate change anywhere) |
| 8 | MINOR | Blind-mode redaction is a fail-open key substring denylist | **MRQ-50** |
| 9 | MINOR | AC-214 untested and structurally invisible to the tracer | **MRQ-51** |
| 10 | MINOR | `roleForEvent` ignores `org_id` | **MRQ-51** or **MRQ-47** |
| 11 | MINOR | AC-246 test asserts 403 but not "no row written" | **MRQ-51** |
| 12 | NOTE | Two authorization idioms, three private helpers | Architecture note below |

**Sharpening the audit tickets while they are still unassigned:**

- **MRQ-23** — its highest-value work is not the speed suite; it is the six missing `check:seed` assertions in finding 5's table. Hand it that table.
- **MRQ-42** — fix its own definition of "covered" (finding 4) before closing coverage against it.
- **MRQ-50** — run the byte-scan against a form carrying a key the denylist does not match, not only the seeded form.
- **MRQ-51** — findings 6, 9, 10, and 11 all live in the two files it already has to read. It is the cheapest place to land all four.
- **MRQ-45** (mail containment) — I verified its central claim independently: `insertOutbox` defaults to `demo_safe` (`src/jobs/mail/outbox.ts:53-56`) and exactly **two** call sites write `always_live` (`:126` public-form confirmation, guarded by a typed-address equality check at `:123`; `:131` the smoke harness). Consumer-side suppression is the single choke point (`src/jobs/mail/consumer.ts:137-147`). The seed sets `demo_mode: 1` (`scripts/seed/event.ts:95`). G3 holds as specified.

---

## Architecture note

**Where a stranger gets lost.** Not in the API core — `src/api/route.ts` → `_manifest.ts` → `router.ts` is the most legible thing in the tree, and the comment at the top of `router.ts` telling later tickets they may not edit the pipeline is the reason it stayed that way. A stranger gets lost at **authorization**, because the answer to "who may call this?" lives in a different place depending on which file they opened. In `submissions.routes.ts` it is a declarative `grants: ["program:read"]` and the pipeline enforces it. In `evaluation.routes.ts` it is `authenticated` plus a `requireProgram(context, eventId, true)` on line 3 of the handler. In `forms.routes.ts` it is `authenticated` plus `getOwnedForm(…, write)` buried inside a data-loading call, which also happens to be the only guard in the tree that checks the org boundary. In `review.routes.ts` it is a `grants:` policy *plus* `authorizeReviewerScope` doing the real work. Four idioms, all correct, none discoverable from the others.

**The duplications worth naming.** (a) The role→grant table exists twice with different shapes — `MINIMUM_ROLE_BY_GRANT` + `LEGACY_ROLE_GRANTS` in `router.ts:66-97`, `minimumGrantByRole` in `scope-resolution.ts:66-77`. (b) The token event-scope branch (`eventId === null ? eventIds.length === 0 || eventIds.includes(…) : eventId === …`) is written out four times: `router.ts:106-112`, `scope-resolution.ts:57-61`, `evaluation.routes.ts:133-135`, `comms.routes.ts` (same shape). (c) `roundForEvent` exists in both `review.routes.ts:105` and `evaluation.routes.ts:149` with near-identical SQL. (d) The reviewer queue's candidate query (`review.routes.ts:123-142`) and `authorizeReviewerScope`'s EXISTS probe encode the same assignment-or-committee rule twice, in different SQL.

**The seams that did *not* fork**, and are worth protecting: `Principal`/`AuthContext` is one union with an alias (`scope-resolution.ts:24`), not two; there is one list/pagination contract (`src/api/list.ts`, `pagination.ts`); one condition evaluator; one presign path; one outbox writer. For four models across three harnesses in thirty hours, that is a good result — the route-object contract in `src/api/route.ts` is what bought it, and it is worth saying so in the README, because "how do I add an endpoint" is exactly the change a judge would be asked to make.

**The one refactor most worth doing with ~40 hours left.** Not the authorization unification — moving 38 routes onto declarative `grants:` touches every guarded handler in the tree and is the wrong bet this close to a deadline. Instead: **extract the three private `requireX` helpers into one exported `requireEventRole(context, eventId, minimumRole)` in `src/lib/auth/event-access.ts`**, and have all 38 `authenticated` routes call it. It is mechanical, it deletes about sixty lines of triplicated token-scope branching, it closes the org-boundary divergence (finding 10) in one place rather than four, and — the part that matters for a recruiting exercise — it makes "who may call this?" a single grep. Pair it with a two-sentence README section naming the two idioms and when each applies.

If only one thing gets done: **finding 1**. It is the difference between a judge reading a populated review card and a judge reading eight rows of "Not answered" on the screen the whole competition is about.

---

*Read-only audit. No file under `src/`, `scripts/`, `migrations/`, or `tests/` was modified; nothing was committed, branched, or pushed; no Lattice state was changed.*
