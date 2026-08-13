# Code Review: MRQ-149 — a chair can override a recorded score

Reviewer: independent Claude review agent, cold context.
Branch: `mrq-149-agent-eval-score` @ `33913df1`. Base: `github/main` @ `c2c17a80`.

**Scope note.** The diff embedded in the review prompt was computed against a stale
base and carried a lot of foreign work (MRQ-148 evidence PNGs, the Resend webhook
docs, `migrations/0014_inbound_delivery_state.sql`, the whole `sequence/submission/`
asset pack). `git diff github/main...HEAD` is exactly the 13 files of commit
`33913df1`, and that is what I reviewed. The `0014` → `0015` migration renumber the
implementer did was the right call.

---

### 1. Verdict

**PASS** — with four minor issues, two of which are one-line fixes I would land before
merging.

The gate is currently red, but **not because of this change**: see "Gate status" below.

---

### 2. Summary

The ticket's honest gap analysis holds up under independent checking. (a) and (b)
genuinely shipped with MRQ-134 — `scripts/seed/evaluations.ts` seeds the `Triage agent`
seat's 4.5 with abstract-specific reasoning on the pooled "Taming 40-Minute CI"
(`scripts/seed/pool.ts:235`), and the `Agent` chip plus the separate `Agent score` line
already distinguish it — so closing only (c) is the correct scope, not an under-delivery.
The (c) implementation is well-judged: the override is written **onto** the evaluation it
supersedes rather than smuggled in as a second peer review, the reviewer's original score
and reasoning stay on the record beside it, the write answers `program:write` only, and
`reviewer-scope.ts` and every reviewer authorization check are untouched — which is what
the ticket's "do not overclaim / do not create a second MRQ-146" instruction demanded.
The claim in `sequence/agent-evaluator-design.md` §1 ("a chair can override any of them")
is now true, where before it was not.

Key finding: the commit message states an invariant — "an override replaces the
reviewer's value wherever that value is used" — that the code does not fully honor. Two
surfaces still read the raw `evaluations.score` (issue #2), and one write path silently
outlives an override (issue #3). Neither breaks the ABS-14 flow; both are drift against a
promise the commit itself makes.

---

### 3. Issues

**[MINOR] src/routes/submissions.routes.ts:46 — `override_score` is returned by the API but absent from its OpenAPI schema**

`SubmissionAgentReview` in `src/api/submissions.ts:75` gained `override_score`, and
`submissions.queries.ts:383` serializes it (the MRQ-149 test asserts it on the wire at
`tests/integration/api/evaluation-override.MRQ-149.test.ts:205`). But
`submissionAgentReviewSchema` — the Zod object that generates the published
`SubmissionListItem` component — was not updated, so `/api/openapi.json` documents an
`agent_reviews[]` element without the field. `npm run check:api` passes, so no gate
catches this. It matters more here than it would elsewhere: `sequence/submission/
DIFFERENTIATORS.md` §1 and `BONUS-CLAIMS.md` both stake a public claim that "a docs-match-
code guarantee you can check with `curl` and `shasum`" and that "'undocumented endpoint'
is not a state the codebase can express." An undocumented *field* now is.

**Fix:** add `override_score: z.number().nullable(),` to `submissionAgentReviewSchema`.

---

**[MINOR] src/routes/evaluation.routes.ts:509 — the evaluation plan summary still reports the superseded number**

`highest_score` and `wide_spread` in the plan summary read `evaluation.score` directly,
with no `COALESCE`. After a chair overrides a human reviewer's 4.6 down to 3.0, the
submissions register, the results table, the CSV export, and the record all say 3.0 while
`/evaluation`'s summary still headlines 4.6 as the highest score, and `wide_spread`
measures dispersion against values that no longer govern. This is exactly the "wherever
that value is used" claim from the commit message, unmet. Impact on ABS-14 itself is nil
(the summary joins `kind = 'human'`, so overriding the Agent seat cannot move it), which
is why this is minor rather than major — but a judge comparing two organizer screens
would see two different numbers.

**Fix:** `COALESCE(evaluation.override_score, evaluation.score)` in the `highest_score`
expression, in the `wide_spread` outer comparison, and in the `SELECT AVG(other.score)`
correlated subquery.

---

**[MINOR] src/routes/review.routes.ts:884 — a reviewer's revision leaves a stale override governing, silently**

The evaluation upsert sets `recommendation`, `score`, `criteria_scores`, `comment`,
`abstained`, `updated_at` on conflict — the four `override_*` columns are untouched by
design of the `DO UPDATE SET` list. So: chair overrides the agent's 4.5 → 2.5; the
reviewer (human or agent seat) later re-runs and records 3.0; the aggregate and every
surface still report 2.5, attributed to a chair who was correcting a judgment that no
longer exists. The reviewer's own queue gives no indication their score is superseded.

Persisting the override may well be the right rule — a chair's authority shouldn't
evaporate because a reviewer touched the row — but right now it is an unstated
side-effect of which columns the upsert happens to list, with no test pinning it either
way.

**Fix:** decide it explicitly and encode the decision. Either (a) keep the override and
add a test asserting it survives a reviewer revision, plus a line on the reviewer's own
card that their score is currently overridden; or (b) clear `override_*` in the
`DO UPDATE SET` so a revision restores the reviewer's authority and the chair re-decides.
I'd take (a).

---

**[MINOR] src/ui/submissions/SubmissionRecordPage.tsx:369 — an off-scale override replaces the whole record with an error page**

`act()` catches every failure into `setState({ kind: "error" })`, which swaps the entire
record for "Record unavailable" (line 407). Every other caller of `act()` is a button
with no user-supplied value, so a 422 is essentially unreachable for them. The override
form is the first action in this file that submits a number the user typed and the server
can reject — and the server does reject, at `evaluation.routes.ts:1640`, for anything off
the plan's scale. Typing `9` on a 1–5 plan therefore blows the page away rather than
saying "1–5" next to the input. It is recoverable (the message is shown and Retry works),
but it is a dead-end-shaped moment in the one flow this ticket exists to make a judge
walk.

**Fix:** either surface override failures inline (the file already has the
`record-inline-message` pattern in the message form) or, better, carry the plan's
`scale_min`/`scale_max` into the record payload and set `min`/`max` on the number input
so the client cannot compose an off-scale request in the first place.

---

**[NIT] src/ui/submissions/SubmissionsPage.tsx:220 — the label swap shifts the row**

`Agent score` → `Overridden` are different widths and `.agent-review-label`
(`src/styles/components.css:211`) reserves none, so the reviewer name and the tabular
number both slide when an override lands. Contrast the care taken twelve lines away in
`record.css`, where the chip and the Clear button each get an explicit reserved slot with
a placeholder. Same rule (`CLAUDE.md`, "Elements Never Jump"), one surface short.
**Fix:** `min-width` on `.agent-review-label` sized to the longer of the two labels.

**[NIT] src/ui/submissions/SubmissionRecordPage.tsx:130 — the docstring overstates the layout guarantee**

"The override control is a fixed-height panel whether or not an override exists, so
recording one never shifts the rows below it." The chip slot and Clear slot are indeed
reserved, but recording an override also renders the `.evaluation-superseded` line, and
opening the form expands the panel well past its `min-height: 26px`. Rows below do move.
**Fix:** narrow the sentence to what is actually reserved (the chip and Clear slots), or
reserve the superseded line's height too.

**[NIT] tests — the plan's aggregate unit test was not written**

Plan step 5 called for "unit for the aggregate." The aggregate is covered only through
the integration path (`listScore()`), and the one behavior the `review-aggregate.ts`
change introduces that nothing exercises is the weighted interaction: an evaluation with
`criteria_scores` that is then overridden must report `weighted_value = NULL` and drop
`score_is_weighted` to 0 for the whole submission — the asterisk in the register and the
"Score basis" CSV column both key off it. Every seeded evaluation in the MRQ-149 fixture
has `criteria_scores = NULL`, so that branch is untested.
**Fix:** one fixture row with `criteria_scores` set, overridden, asserting
`score_is_weighted === false` and the override value as the score.

---

### Gate status — red, and not from this change

`npm run pr-gate` fails at the hermetic fast suite: **962 passed, 3 failed**, all three in
`tests/unit/r2/uploads-routes.test.ts` (presign 404s and `TypeError: Invalid URL string`).
They are environmental, not caused by the diff:

- This worktree's `.dev.vars` contains only `INSECURE_LOCAL_COOKIES` and
  `LOCAL_UPLOAD_SHIM`. `LOCAL_UPLOAD_SHIM=1` flips `usesLocalShim()`
  (`src/routes/uploads.routes.ts:122`) inside the workers pool, so the presign path under
  test returns a shim URL, and the R2 fakes the example file provides are absent
  (wrangler warns: "Missing required secrets: … R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, …").
- Nothing in the 13-file diff touches R2, uploads, or attachments.
- I left `.dev.vars` alone rather than mutating shared worktree state to prove it (per
  `CLAUDE.md`); the mechanism above is legible from the code without doing so.

Everything else I ran independently is green:

| Check | Result |
|---|---|
| `tests/integration/api/evaluation-override.MRQ-149.test.ts` | **5/5 pass** (2.6s) |
| `check:schema` | **pass** — 53 tables, 132 indexes, **105** foreign keys, 3 triggers |
| `check:api` | **pass**, zero findings |
| `check:routes` | **pass** — 41 SPA routes, 16 server pages |
| `check:design` | **pass**, zero findings |
| `check:clocks`, `check:shell-truth` | **pass** |

The suite ran in 39.4s against a 45s budget, `overBudget: false`.

**Before merge:** re-run the gate in a checkout with a complete `.dev.vars` (copy
`.dev.vars.example`'s fake R2 values, drop `LOCAL_UPLOAD_SHIM`) and confirm 965/965.
Do not merge on the red gate as it stands, even though the cause is external — the rule
is a green gate, and this one is a two-minute fix to the environment, not to the code.

**Also not present:** no `docs/evidence/mrq-149/` artifacts, where MRQ-148, MRQ-106 and
MRQ-94 all committed theirs. Plan step 6 promised real-browser validation on `vite dev`
(override the agent's 4.5, reload, confirm it persists and reads as an override). I could
not verify from the tree that this happened. Given the item is scored by an agent driving
a browser, a before/after pair of screenshots on `submission-record` for
"Taming 40-Minute CI" is cheap insurance and should be added.

---

### 4. Positive Observations

- **The gap analysis was done honestly, and it was right.** I checked (a) and (b)
  independently — the seeded agent evaluation, the `ReviewerName` agent chip, the separate
  `Agent score` line, and the `kind = 'human'` joins that keep an agent's score out of the
  committee average — and the ticket's claim that only (c) was missing is accurate. It
  would have been easy, and wrong, to rebuild an "AI triage" feature over the top of
  MRQ-134; the implementer read the design first and didn't.
- **The override is modeled where it belongs.** On the evaluation, not as a second peer
  review, not as an AI-specific side door. `overridableEvaluation()`
  (`evaluation.routes.ts:1586`) resolves the row through event → round → submission rather
  than by id alone, so an evaluation id from another conference cannot be steered into
  this one — and there is a test for exactly that (`:222`). Authorization is
  `program:write` + `requireProgram(…, true)`, with no relaxation anywhere near
  `reviewer-scope.ts`, and the negative test proves a reviewer session gets 403 *and* that
  nothing was written.
- **R1 is held explicitly, not incidentally.** The third test asserts that overriding the
  Agent seat's score to 5 still leaves the committee aggregate at the human's 4.2. That is
  the invariant most likely to be broken by a careless `COALESCE`, and it is pinned.
- **The aggregate change reasons about its own honesty.** Marking an overridden row
  unweighted — because a chair's scalar "is not a weighted computation over criteria, so
  an overridden row reports as unweighted rather than claiming an arithmetic it did not go
  through" — is the kind of decision most implementations get wrong silently. The comment
  block in `review-aggregate.ts:20` explains it in the codebase's voice.
- **`includeOverrides` follows the existing capability-probe pattern** rather than
  inventing a new one, so partially-migrated databases degrade the same way they already
  do for `reviewer_person_id` and `people.kind`.
- **Audit trail on both directions.** `evaluation_score_overridden` carries the superseded
  score, the reviewer's kind and person id; `evaluation_score_override_cleared` carries
  the restored value. Both are batched with the write, so the record and its history
  cannot disagree.
- **The tests re-read through the API rather than trusting the write's response** — the
  helper comment says so explicitly ("Always re-read from the API rather than trusting the
  write's own response"), which is precisely what "persists after reload" means in the
  rubric. The test names are contract sentences, not method names.
- **`scripts/schema-verify.mjs` was tightened, not just bumped.** Converting the bare
  `INSERT INTO evaluations VALUES` statements to explicit column lists means the next
  column added to that table won't silently break three unrelated assertions. That is a
  small, unglamorous improvement to someone else's future afternoon.
