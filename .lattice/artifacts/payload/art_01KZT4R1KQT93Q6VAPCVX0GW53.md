# Code Review: MRQ-97 — accepted fact filter and categorized status control

Reviewed at commit `85f35ff` on `mrq-97-accepted-filter`, worktree
`/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-97-accepted-filter`.

Verification actually run during this review:

- `npm test` → **pass**, 0 failures (`pass-over-budget`: 54.4s against the 45s objective;
  machine load average was 28 at the time, so this is contention, not a defect —
  `run-test.mjs` is explicit that the budget is an objective, not a gate).
- `npm run check:design` → **pass** (see Issue 1 — it passes for the wrong reason).
- `npm run check:api` → **pass**, no findings; the regenerated OpenAPI sha in
  `cli/api-registry.json` matches.
- Read the screenshot at `artifacts/mrq-97-accepted-filter.png`: real local app, sidebar
  reading "Ready to place", the status control showing `Accepted (any stage)` in the
  accent-selected state, 60 matching records. Local browser validation is genuine.
- Traced the predicate consumers by hand: `dashboard.routes.ts`, `board.ts`,
  `landing.route.tsx`, `agenda.queries.ts` (`readPool`), `jobs/mail/audience.ts`,
  `lib/saved-views.ts`, `route-table.ts`.

## 1. Verdict

**FAIL (implementation-level)**

The approach is right and the operator's defect is genuinely fixed — this is not a
plan-level problem. One finding is a hard blocker (a repo check made green by a code
comment), one is a real test-hygiene regression, and the rest are small. All fixes are
narrow; this should come back quickly.

## 2. Summary

The core defect is fixed correctly and minimally: `accepted_any` is a one-line stored-fact
predicate (`s.status = 'accepted'`), it is additive, and the MRQ-76 shared stage projection
is untouched — which the existing `pipeline-stage-consistency.MRQ-76` and
`dashboard.AC-14-15-240` (AC-15 pairs *every* count with its href, including
`snapshot.metrics`) tests still prove green. The dashboard `Unscheduled` repoint is better
than a relabel: `agenda.queries.ts:readPool` selects on **stored** status, so the metric now
agrees with the agenda builder's own pool where it previously under-counted every accepted
record sitting in a wave or onboarding.

The blocking finding is `src/ui/shell/route-table.ts:19-21`: the sidebar label was changed to
"Ready to place", and `scripts/checks/verify-design-contract.mjs` — which greps that file's
raw text for `label: "Accepted"` — is satisfied only because those exact characters appear
inside a comment placed there to satisfy it. `check:design` reports pass with zero findings
for a contract that is no longer met.

## 3. Issues

**[MAJOR] src/ui/shell/route-table.ts:19 — the design contract check is defeated by a comment, not honoured**

`verify-design-contract.mjs:28-30` reads `route-table.ts` as raw text and asserts the
substring `label: "Accepted"` is present. The label is now `"Ready to place"`, so the
contract is genuinely broken — the check passes only because the comment on lines 19-20
contains the literal `label: "Accepted"`. I confirmed both halves: `grep 'label: "Accepted"'`
matches line 19 and nothing else, and `npm run check:design` reports
`{"status":"pass","findings":[]}`.

Two things are wrong with this. It is a green check that no longer verifies anything about
the sidebar, on a project whose own rules warn that a green suite is not a working product.
And it silently arms a trap: the next person who reflows or deletes that comment breaks CI
with a failure that points at prose, not at code. The comment even documents the bypass in
its own text, which means it was a known trade rather than an oversight — but the trade goes
the wrong way, because the checker exists precisely to catch an unannounced rename of a
binding-prototype label.

**Fix:** make the rename honest. Update the expected-label list in
`scripts/checks/verify-design-contract.mjs:28` — `"Accepted"` → `"Ready to place"` — and
delete the comment on lines 19-20. The label change then has to be stated in the PR body,
which is what the ticket's "no status is silently dropped from the vocabulary without saying
so in the PR" clause is asking for anyway. (If the intent is instead that the checker should
be label-agnostic, change it to assert on route `id`s and say so — but do not leave a text
check passing on a comment.)

**[MAJOR] tests/integration/api/submission-decisions.AC-66-69-114-117.test.ts:218-238 — the new test mutates shared fixture state and silently changes what AC-114 covers**

The file is `describe.sequential` over one `beforeAll` fixture. The new MRQ-97 test is
inserted between AC-66-69 and AC-114-117, and it permanently mutates shared state: it sets
`wave-mrq19.sent_at`, then schedules and publishes `sub-mrq19-001`.

`sub-mrq19-001` is exactly the record the following AC-114 test picks up, via
`SELECT id FROM submissions WHERE status = 'accepted' ORDER BY id LIMIT 1` (line 260-262) —
its stored status is still `accepted` after scheduling and publication, which is the whole
point of this ticket. So AC-114 now rejects a **published, scheduled Session** where it
previously rejected a plain accepted Abstract. The suite is green, so nothing is broken
today; what is lost is the meaning of a pre-existing contract test. On a project that traces
coverage by AC number, a decision-cascade AC quietly changing its subject is a real cost, and
the next person to debug AC-114 will be reading a fixture that no longer says what it did.

The `kind` seeding change on line 110 makes this worse rather than better: `n = 1` was chosen
as the `session` precisely because it is the record the new test drives, and it is also the
lowest id.

**Fix:** move the MRQ-97 target off the record AC-114 reaches for. Seed
`CASE WHEN n = 150 THEN 'session' ELSE 'abstract' END` on line 110 and drive the new test
against `sub-mrq19-150`, or alternatively pin AC-114's subject explicitly
(`WHERE id = 'sub-mrq19-003'`) instead of `ORDER BY id LIMIT 1`. The former is preferable —
it leaves the existing test untouched.

**[MINOR] prototypes/pipeline-v1.1/index.html:2252 — the new "Onboarding" option in the prototype dropdown returns nothing**

The rebuilt prototype `<select>` adds `Onboarding` to the Pipeline stages optgroup, but the
filter chain in `filteredSubmissions()` (lines 2156-2164) has no `Onboarding` arm, so it
falls through to `s.status === "Onboarding"`. No submission ever carries that status —
onboarding is derived by `boardStageFor()` (line 1372-1377) from `boardStage`/`accepted`.
Selecting it yields an empty list. The app's own dropdown is fine (`onboarding` is a real
server-side predicate); this is prototype-only, but the prototype is the binding artifact and
the rubric punishes dead ends.

**Fix:** add the missing arm alongside the one written for `Accepted`:

```js
(state.submissionFilter === "Onboarding" && boardStageFor(s) === "Onboarding") ||
```

**[MINOR] src/ui/submissions/SubmissionsPage.tsx:104 — the row status chip still speaks the old vocabulary**

Every stage-naming surface now says "Ready to place" (sidebar, dashboard tile, board column,
landing preview, the dropdown's Pipeline stages group), but `statusLabel` title-cases the raw
value, so rows in that stage still render a chip reading **Accepted**. Filter by
"Ready to place" and the result set is a column of "Accepted" chips; filter by
"Accepted (any stage)" and you get the same word on rows that are in three different stages.
This is largely inherited (the chip has always mixed the stored fact with the derived
scheduled/published values), so it is not a regression — but the ticket's whole complaint is
that one word carries three meanings, and the chip is now the last place it still does.

**Fix:** either leave it and say so in the PR ("the chip reports the stored decision, the
control reports the stage"), or map the derived-accepted case to the same words the control
uses. A decision stated in the PR is enough; an unstated one is what produced this ticket.

**[MINOR] Acceptance not yet closed — no branch on the remote, no PR**

`git ls-remote --heads github mrq-97-accepted-filter` is empty and `gh pr list` shows no PR
for this head, so the ticket's final acceptance line ("PR open against
`Stage-11-Agentics/marquee` `main`") is outstanding. Consistent with the plan's own
checkpoint ordering (`pr_open` comes after review), so this is a status note, not a defect —
but two acceptance clauses can only be satisfied in the PR body itself and must not be
forgotten there: the judgment call between the two credible shapes, and the explicit
statement of every vocabulary change (`Accepted` → `Ready to place` on the stage, new
`Accepted (any stage)` fact filter, the `Unscheduled` metric's widened definition, and the
`agenda`/`onboarding` empty-state hrefs repointed to `accepted_any`).

## 4. Positive Observations

- **The fix is the smallest correct one.** `submissionStatusPredicate` gains a single arm
  returning `s.status = 'accepted'` and sits *above* the stage arm without touching it, so
  MRQ-76's shared projection is provably unchanged — `idsFor("waved") !== idsFor("accepted")`
  and the whole distinct-partition assertion still hold, and the new unit test pins the fact
  set across all five stages in one line.
- **The `Unscheduled` repoint is a real consistency win, not cosmetics.**
  `agenda.queries.ts:readPool` filters on *stored* status with `NOT EXISTS(agenda_item)`, so
  the dashboard metric now counts the same set the agenda builder actually shows. The old
  stage-based count omitted every accepted record in a wave or with open onboarding tasks —
  the same class of omission the operator hit. Both the count and its href moved together,
  and AC-15 (`dashboard.AC-14-15-240.test.ts:135-147`) already enforces that pairing over
  `snapshot.metrics`, so the change is covered by an existing gate rather than an assertion
  written to match itself.
- **The lifecycle test is the right test.** It drives the real API — bulk accept, then wave
  send, then `POST /schedule`, then `POST /publish` — and re-queries `accepted_any` after each
  transition, asserting both that the record stays in the fact filter *and* that its reported
  stage moves. That is precisely the invariant the defect violated, and it would have caught
  the original bug. Adding the `statusSemantics: "stored"` selector assertion in the same test
  closes the bulk/comms path that would otherwise have silently returned zero rows.
- **Splitting `SUBMISSION_LIST_STATUSES` from `SUBMISSION_STATUS_FILTERS` fixes a latent
  schema lie.** The response item enum previously advertised `not_notified` as a status a row
  could carry; it now advertises only what `toItem` can actually emit, and the new filter-only
  token never leaks into the response contract. `check:api` confirms the registry sha was
  regenerated rather than hand-edited.
- **Consumer sweep was thorough.** The agenda and onboarding empty states — organizer-language
  entry points that promise "accepted" records — were repointed to `accepted_any`, with
  `placement=unplaced` added on the agenda one so it matches the pool it is standing in front
  of. That is the detail an incomplete pass would have missed.
- **The optgroup control is the right shape and honours the taste rules.** "All statuses" sits
  outside every group as a real neutral default, "Maybe" survives as the product's word for
  waitlisted, and the `is-default` / `has-selection` classes both set `font-weight: 600`, so
  the control does not resize when its state changes.
