# Plan Review: MRQ-134 — agent evaluator seats

## 1. Verdict

**FAIL (plan-level)**

The plan is well-oriented and its architecture is right. It fails on evidence: stage 5 (the seed,
which the ticket marks "NOT optional" and which AC-293 grades) is built on a fixture row that does
not exist, and lands squarely on two assertions in an existing green test. Neither is expensive to
fix in the plan — but both change what stage 5 *is*, and one of them requires a deviate-with-flag
call that belongs in a plan rather than in a surprise at review time.

## 2. Summary

Reviewed the plan against the binding design (`sequence/agent-evaluator-design.md`),
`EVALUATION.md` §2.5 (AC-288–293), and the actual code on the branch base
(`72648d63`, with MRQ-107/108/109/110 all landed). The build sequence, the refusal to branch the
write handler, the live `kind='agent'` predicate at both issue and resolution, and the correct
migration number (0013 — verified against merged `main`, max is `0012`) are all right. The key
concern is that four of the five stages assume seams that do not exist in the shape the plan
describes: the seeded submission, the shown-once *component*, the assign-select badge, and the
claims manifest.

## 3. Issues

**[CRITICAL] Build sequence 5 — the seeded submission "Taming 40-Minute CI" does not exist**
The plan says "assign it to `Taming 40-Minute CI`" as though the row is in the fixture. It is not.
`grep` across `scripts/seed/` and `src/lib/reset-demo/` returns nothing; the string appears only in
test fixtures (`tests/integration/api/content-editing-history.MRQ-118.test.ts:31`,
`files-library.MRQ-115.test.ts:111`, and others). The demo's accepted core is derived from the real
captured AIE program (`sequence/research/sources/aie-summit-2025-program.json`, which contains no
such title), and the non-accepted pool is machine-generated from `TITLE_PREFIXES`/`TITLE_SUBJECTS`
in `scripts/seed/pool.ts:230`. AC-293 names the title literally (`e2e:` "open *Taming 40-Minute CI*
as the chair"), so this is not cosmetic — the AC is unsatisfiable until the row is authored.
**Recommendation:** Add an explicit sub-step: designate one deterministic `in_review` pool row as
the CI submission (title, abstract mentioning CI duration / monorepo / build caching, synthetic
speaker), rather than appending a new one — see the next issue for why. Note in the plan that
`SEED-DATA.md` ("Demo workflow coverage") must gain a line for the fabricated submission and the
agent seat, since that file is the provenance contract for invented rows.

**[CRITICAL] Build sequence 5 — the required seeded evidence breaks two live assertions in `tests/node/seed-pool.AC-3.test.mjs`**
The plan asserts a green gate without naming the collisions it will cause:
- `:29` — `assert.equal(submissions.length, 1_000)`. Appending a submission reddens AC-3.
- `:78–83` (AC-245) — `for (const evaluation of evaluations) { assert.equal(evaluation.score, null);
  assert.equal(evaluation.criteria_scores, null); }` over **every** seeded evaluation. The design
  §9 and AC-293 require a seeded agent evaluation carrying a score with rationale, and AC-292's
  aggregate story wants a scored human review beside it. Seeding either one turns AC-245 red.
- `:94–99` (AC-246) — `unreviewed.length === ORGANIZER_UNREVIEWED_ASSIGNMENTS` (40), computed over
  `STAFF_PERSON_ID`'s round-one assignments minus anything with an evaluation
  (`scripts/seed/evaluations.ts:200–212`). If the seeded human review is the demo organizer's on a
  submission drawn from `candidates.slice(0, 40)`, that count drops to 39.
**Recommendation:** State the resolution for each in the plan. Suggested: (a) convert an existing
pool row rather than adding one, holding 1,000; (b) relax AC-245's null assertions to human-kind
evaluations only — the AC row's own wording is "*without requiring* numeric scores", so the test is
stricter than the criterion, but this is contract-adjacent and must be called out as a
deviate-with-flag in the completion comment; (c) draw the CI submission from outside
`candidates.slice(0, ORGANIZER_UNREVIEWED_ASSIGNMENTS)` and use a non-organizer human reviewer.

**[MAJOR] Build sequence 3 — there is no shown-once panel *component* to reuse**
AC-288 requires the secret to render "through the existing shown-once panel (**component identity
asserted, not a second implementation**)". At `src/ui/settings/ApiTokensPage.tsx:195` that panel is
inline JSX inside the page body, not an extracted component — there is nothing to import and
nothing whose identity a test can assert. The plan's "render the returned secret through the
existing shown-once panel component" is therefore not yet true.
**Recommendation:** Scope the extraction explicitly: lift the panel into a shared component,
refactor `ApiTokensPage` to consume it (so there remains exactly one implementation), and assert
identity by importing the same symbol in both tests. This also means `ApiTokensPage.tsx` joins the
modified-file set, which the plan does not currently anticipate.

**[MAJOR] Build sequence 3 — the `Agent` Chip cannot render in the assign-reviewer select**
The design (§5.3) and the plan both list "the Assign reviewer select" as a badge surface. That
control is `<option value={reviewer.id}>{reviewer.name}</option>` at
`SubmissionRecordPage.tsx:237` — an HTML `<option>` renders text content only; a `Chip` inside it
will not render. The plan repeats the requirement without noticing it is unimplementable as stated.
**Recommendation:** Rule now: text marker inside the option label (`Triage agent · Agent`), `Chip`
everywhere else. Record it as a deviate-with-flag against design §5.3, since the design says "a
`Chip`, not a color, not an icon."

**[MAJOR] Verification matrix — no `tests/ac-claims/MRQ-134.json`**
`EVALUATION.md:642` conditions §2.5's enforcement on "MRQ-134's claims manifest," and the mechanism
is real: `scripts/checks/trace-ac.mjs:28–38` reads `tests/ac-claims/*.json` and warns
`missing-current-ticket-manifest` when `--ticket` names a ticket with no manifest. The plan runs
`npm run pr-gate -- --ticket MRQ-134` but never produces the artifact, so AC-288–293 stay
unenforced and "ACs covered by tests you can point at" has no pointer.
**Recommendation:** Add the manifest as a named deliverable —
`{"ticket":"MRQ-134","owns":["AC-288",…,"AC-293"],"notes":[…]}`, matching the shape of
`tests/ac-claims/MRQ-10.json`.

**[MAJOR] Build sequence 3 — R1 aggregate exclusion is one sentence covering four query sites and several undecided figures**
"Exclude agent scores from human aggregates" is not a single edit. `reviewAggregateColumns`
(`src/lib/review-aggregate.ts:53`) is a correlated fragment spliced into three different FROM
clauses via `src/routes/submissions.queries.ts:13`, and `evaluation-results.routes.ts` computes its
own per-criterion mean (`:80`) and recommendation tally (`:103`) and exports both to CSV. The plan
also leaves the derived figures unruled: does `review_count` (and `reviewCountLabel`, "3 reviews")
count the agent? Does the recommendation tally? Does MRQ-109's per-reviewer progress? AC-292 only
pins the mean, so a reviewer and an implementer can disagree in good faith.
**Recommendation:** Name the files, and state the ruling per figure. Suggested and consistent with
R1/R2: the *score* excludes agents (mean, criterion means, `score_is_weighted`); the *counts of
work done* include them (coverage, per-reviewer progress); `review_count` sits under the score
column and describes the number, so it excludes agents — and the agent line is labelled and
separate. Whatever is chosen, put it in the plan so the tests encode a decision rather than an
accident.

**[MAJOR] Build sequence 5 — the claim's surface and its static detector are undefined**
This is the ticket's designated trap and the plan addresses it in the abstract: "add the public
'Evaluation is open' claim only in the same change, with static protection." It names no surface
(landing page? README? `/evaluation` copy?), no marker the scanner can key on, and no detector.
AC-293's static half must assert *both* directions, which requires a mechanical definition of "the
claim is present." The plan also does not note that design §9 explicitly permits shipping neither —
"ship the claim and the evidence in the same PR **or ship neither**" — so shipping the claim is a
choice being made silently.
**Recommendation:** Pick the surface, define the claim as a single exported constant (or a marker
comment) that both the UI and the scanner import, and write the coupling test both ways: constant
present ⇒ seeded agent evaluation exists; seeded evaluation removed ⇒ scan fails. Or state
deliberately that the claim ships and why.

**[MINOR] Build sequence 2 — comparison writes become reachable for free, and the design calls them out of scope**
Every `review:write` route lives in `review.routes.ts`, including `writeComparisonRoute` (`:696`).
Once `reviewerPersonIdForEvent` accepts `actingPersonId`, a bound seat can write comparisons —
which design §11 lists as out of scope. Out-of-scope-to-build is not the same as blocked, and
AC-289's "enumerate every `authorizeReviewerScope` call site" will surface it.
**Recommendation:** Rule explicitly (allowing it is defensible and consistent with "no parallel
subsystem"), and add one test asserting the chosen behaviour so the reviewer isn't left guessing.

**[MINOR] Build sequence 1 — say plainly that a bound token's memberships become the seat's**
`auth-middleware.ts:59` currently loads `loadMembershipsForOrg(db, createdBy, …)` — the *issuer's*
memberships — into the token principal. The plan says "a bound token resolves only its seat," which
is right in spirit, but the substitution of that one line is what makes AC-290 (403 on an organizer
route the issuer can reach) true and what would otherwise let the issuer's reviewer membership
satisfy the check in `reviewerPersonIdForEvent:226` while `personId` is the seat. It is the single
riskiest line in the change and deserves to be named.
**Recommendation:** State it as its own step, and pair it with a test asserting the bound principal
carries exactly the seat's memberships.

**[MINOR] Build sequence 5 — do not seed a usable credential; and the file list is thin**
The seed needs the agent *person*, membership, track scopes, assignment, and evaluation — it does
not need a working bound token, and this repo is destined for public open source. Worth an explicit
"seed no token secret / no reversible hash" line. Separately, the plan names very few concrete
files; stages 3 and 5 in particular would be easier to review against if they listed them.

## 4. Positive Observations

- **The organizing idea is held.** "Keep the evaluation write route generic; identity and
  authorization must be supplied through `Principal`/`reviewer-scope.ts`" is exactly the design's
  §4.4 discipline, and the plan states it as a resolution rather than leaving it implicit. Verified
  against `review.routes.ts:874–902`: no branch is needed, and R2 (agent coverage counts) is free
  because the assignment-complete update at `:901` already keys on `authorization.personId`.
- **The two hardest security invariants are correctly identified as live predicates**, not stored
  facts: `kind='agent'` re-checked at resolution so a row edited under a live token fails closed,
  and issuer/seat separation. That is the difference between this feature and an impersonation hole,
  and the plan puts it in the authoritative resolutions section rather than the prose.
- **The base was actually re-observed, not assumed.** `github/main @ 72648d63` is current, MRQ-109
  is confirmed present (`7c064bd1`), and the migration number 0013 is correct against merged `main`
  (max `0012`) rather than the stale `0011` the ticket warned about. The plan also commits to
  re-checking at write time.
- **The verification matrix is per-AC and mostly mechanical**, and the plan commits to a real smoke
  run through the built artifact — UI seat creation, one-time secret, the actual CLI writing an
  evaluation, chair read — rather than trusting a green suite. That is the right gate for this
  ticket.
