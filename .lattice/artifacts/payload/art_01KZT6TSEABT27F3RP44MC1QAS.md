# Plan Review: MRQ-100 — seed data has no submitted, no withdrawn, no ready-to-place row

## 1. Verdict

**FAIL (plan-level)**

## 2. Summary

Reviewed the MRQ-100 plan against the live seed generator (`scripts/seed/**`), the
stage predicates (`src/routes/submissions.queries.ts`), and the checks and tests that
guard the seed (`scripts/checks/seed.ts`, `tests/node/seed-spine.test.mjs`,
`tests/node/seed-pool.AC-3.test.mjs`). The diagnosis in the plan is right and the
"Ready to place is a derived stage, not a status" distinction is correctly carried
through — but the implementation plan's central move, *"add deterministic, realistic
seed upserts"* for three new submissions, collides head-on with a set of exact-count
CONTRACT assertions the plan never mentions: the seed is asserted to contain **exactly
1,000 submissions** and **exactly 60 accepted** in three separate files, two of which
sit outside the ticket's OWNS list. Separately, the plan has invented **AC-6** (declined
/ pending agenda confirmations), which is nowhere in the task description and which
directly contradicts an existing CONTRACT test.

## 3. Issues

**[CRITICAL] Implementation plan — "add seed upserts" breaks three exact-count invariants, two of them outside OWNS**

The plan's first bullet adds new submission rows. The seed's row counts are pinned:

- `scripts/checks/seed.ts:117` — `assert.equal(submissions.length, 1_000, "seed must contain exactly 1,000 submissions")`
- `scripts/checks/seed.ts:118` — `assert.equal(... status === "accepted" ...length, 60)`
- `tests/node/seed-pool.AC-3.test.mjs:29-30` — same two assertions
- `tests/node/seed-spine.test.mjs:96-98` — `CONTRACT · the accepted core is exactly 60 accepted records…`, computed over **all** submissions with `status === 'accepted'`, not just the core module

Adding a submitted row + a withdrawn row + an accepted row fails all of them. The
ticket's constraints say `scripts/checks/check-seed.mjs` **must still pass**, and it
runs `runSeedApiChecks` from `scripts/checks/seed.ts` — a file the ticket's OWNS list
(`scripts/seed/**`, `SEED-DATA.md`, its own tests) does not cover. `seed-spine.test.mjs`
and `seed-pool.AC-3.test.mjs` are likewise pre-existing tests, not "its own tests".

**Recommendation:** Pick and state the strategy explicitly before implementation:
*(a)* **convert in place** — re-status two existing synthetic pool rows (e.g. two of the
280 `in_review`) to `submitted` and `withdrawn`, keeping IDs, titles and the 1,000 total
intact; or *(b)* **add rows and update the invariants**, which requires an explicit
ownership carve-out for `scripts/checks/seed.ts:117-118`,
`tests/node/seed-pool.AC-3.test.mjs:29-30`, and `tests/node/seed-spine.test.mjs:96-112`.
(a) is strongly preferable — it is smaller, it cannot drift the accepted-core contract,
and it keeps every count-based assertion honest. Either way the plan must name the files
it will touch; "extend seed-focused tests … as needed" is not enough given that two of
the three are outside OWNS.

**[CRITICAL] Acceptance criteria — the plan's own AC-6 contradicts an existing CONTRACT test**

AC-6 (added by the plan; absent from the task) requires a `declined` participant and a
multi-role agenda case where `has_declined_participant` is true. `has_declined_participant`
is computed from participations of agenda sessions (`src/routes/agenda.queries.ts:187`),
and agenda sessions belong to accepted submissions. But `tests/node/seed-spine.test.mjs:163-168`
asserts, for **every** participation of **every** accepted submission:

```
const expected = wavesById.get(...) === "wav_wave-1" ? "confirmed" : "pending";
assert.equal(participation.confirmation_status, expected);
```

There is no third value permitted. A seeded `declined` participant on any accepted
submission fails this CONTRACT — and there is currently no `declined` row anywhere in
`scripts/seed/**` (only `confirmed` and `pending`), so this is genuinely new data, not a
gap the test already tolerates.

**Recommendation:** Drop AC-6 from this ticket. If declined-participant seed coverage is
wanted, it needs its own ticket that owns the wave-1/wave-2 confirmation contract in
`seed-spine.test.mjs` and can relax it deliberately.

**[MAJOR] Acceptance criteria / Verification — AC-6 is scope creep beyond the task description**

The task description's Required outcome is three states: submitted, withdrawn, ready to
place, with the operator's own framing *"just one of each, let's say."* AC-6 adds
confirmation-state seeding and a second browser verification surface ("open an agenda/session
surface that visibly exposes the declined participant treatment"). That is a different
defect on a different surface, it enlarges the verification burden on a deadline day, and
it touches data that agenda tests key on.

**Recommendation:** Remove AC-6 and the corresponding verification sentence and
implementation bullet; keep the plan's ACs identical to the ticket's AC-1…AC-5. File the
confirmation-state work separately if the operator wants it.

**[MAJOR] Implementation plan — no seed module is named, and the two obvious homes both reject new rows**

The plan never says *where* the rows go, and neither existing module accepts them:

- `scripts/seed/pool.ts:344-346` throws if the status mix stops summing to `POOL_SIZE`
  (940 = 280 in_review + 550 rejected + 70 waitlisted + 40 draft). Adding a status
  branch inside the pool loop without rebalancing is a build-time throw. Note also
  `tests/node/seed-pool.AC-3.test.mjs:114` pins `drafts.length === 40`, so drafts are
  not a free source of conversions; the 280 `in_review` rows are the unpinned pool.
- `scripts/seed/accepted-core.ts` is generated from the real published 2025 program
  (`_source.ts`), and `seed-spine.test.mjs:105-107` requires every accepted submission's
  `external_ref` to match `/^aie-2025:\d+$/` with 60 unique values. A synthetic accepted
  row cannot be added here without failing provenance.

**Recommendation:** State the module and mechanism per row. The likely-correct shape:
submitted + withdrawn by re-statusing two existing `in_review` pool rows in `pool.ts`
(IDs and titles preserved, so the "do not renumber/re-key/re-title" constraint holds);
ready-to-place by *modifying* an existing accepted submission's associated rows rather
than adding a submission.

**[MAJOR] Implementation plan — AC-3 as written ("add an accepted submission") is not reachable; it must be an existing wave-1 record**

Beyond the 60-accepted count, a new accepted row must satisfy `seed-spine.test.mjs:126`
(`waves.has(submission.wave_id)` — every accepted submission has a known wave) and
`:110-112` (wave-1 = 32, wave-2 = 28 exactly). Wave 2 is deliberately unsent
(`scripts/seed/event.ts:220`), so a wave-2 row trips `pendingWavePredicate` and lands in
*Waved*, not *Ready to place*. That leaves exactly one viable target: an existing
**wave-1**, **non-agenda** accepted submission whose open speaker tasks are closed
(`status = 'done'`), giving `status='accepted' AND agenda IS NULL AND NOT pendingWave AND
NOT open-task` → the accepted stage.

**Recommendation:** Rewrite the AC-3 bullet as "close the open speaker tasks on N wave-1
accepted submissions that hold no agenda slot." Also check the interaction the plan does
not mention: `scripts/checks/seed.ts` asserts `overdueTasks >= 10`, and the landing
Onboarding count (currently 12) drops by exactly the number of submissions moved — pick
targets whose tasks are not among the overdue set, and confirm Onboarding stays non-zero
(the ticket's own verification screenshots require it).

**[MINOR] Implementation plan — "run the seed twice and compare row counts" is only sound for in-place conversion**

`scripts/seed/_sql.ts:19-31` emits `INSERT … ON CONFLICT(id) DO UPDATE`, with no delete
pass, and `buildSeedRows` uses a frozen clock. So AC-4 holds trivially for *added* or
*converted* rows — but if any strategy *removes* rows (e.g. shrinking the pool), an
already-seeded local or remote database keeps the orphans forever and the counts differ
between a fresh DB and a re-seeded one.

**Recommendation:** Add one line: no seed row is deleted or re-keyed; changes are
status/field edits on existing IDs plus purely additive rows. Then AC-4 is structural
rather than empirical, and the twice-run check is a confirmation instead of the proof.

**[MINOR] Verification — the landing page label is "Accepted", not "Ready to place"**

`src/routes/landing.route.tsx:189` renders `<PreviewStage label="Accepted" …>` over
`counts.accepted`, which is the derived accepted stage (`stageCount("accepted")` →
`acceptedStagePredicate`). The sidebar is where "Ready to place" appears. AC-5 talks about
the landing pipeline and the verification step talks about the sidebar; an implementer
screenshotting the landing page will not find a "Ready to place" tile and may conclude
something is broken.

**Recommendation:** Say which label lives on which surface in the verification bullet —
landing tile "Accepted" (same predicate) and sidebar "Ready to place" — so the evidence
is unambiguous.

**[MINOR] Implementation plan — the withdrawn row's decision history is unspecified**

The ticket ties the withdrawn row to MRQ-83 ("restored decision buttons on withdrawn
records; a withdrawn row is what proves that path is reachable"). A withdrawn record with
no `submission_decisions` row reads as a status that arrived from nowhere, and it may not
exercise the decision-history/reversal surfaces the ticket is pointing at
(`src/ui/submissions/AcceptanceReversalPanel.tsx`, `src/lib/decision-history.ts`).

**Recommendation:** State whether the withdrawn row is a plain speaker withdrawal from
the pool or an accepted-then-reversed record, and whether it carries a decision row. The
plain-pool withdrawal is the safer choice on deadline day (an accepted-then-withdrawn
record would perturb the 60-accepted contract), but the plan should say so rather than
leave it to discovery.

**[MINOR] Implementation plan — no test-to-AC mapping under the naming constraint**

The constraints require test titles to begin `AC-<n> · ` or `CONTRACT · ` or `trace:ac`
fails. The plan says only "extend seed-focused tests … as needed."

**Recommendation:** Name the tests: `AC-1 · …` (stored `submitted` present), `AC-2 · …`
(stored `withdrawn` present), `AC-3 · …` (at least one submission satisfies the accepted
stage: accepted, no agenda item, no open task, wave sent). AC-3 is expressible as a pure
assertion over `buildSeedRows()` output, which keeps it inside the 45s suite budget
instead of needing a live DB.

## 4. Positive Observations

- **The diagnosis is genuinely good.** Separating "Ready to place is empty" from the two
  missing stored statuses — and pointing at `acceptedStagePredicate` rather than the
  status column — is the insight that keeps this ticket from being fixed wrongly. The
  warning that this one "is easy to seed wrongly and still see zero" is exactly right.
- **Determinism is treated as a first-class constraint**, not an afterthought, and the
  plan correctly refuses to renumber or re-title existing rows — the constraint that
  protects `sub_what-rl-means-for-agents` and MRQ-86's evidence.
- **Verification is real.** Insisting on a reseed plus browser screenshots, with the
  explicit note that "a passing test alone does not close this — the defect is that the
  app *looks* empty," is the right standard for a data-visibility bug.
- **Worktree discipline and the no-touch list are respected**, including the open-PR
  collision surfaces (`SubmissionsPage.tsx`, `SubmissionRecordPage.tsx`,
  `submissions.queries.ts`, migrations) and the "no deploy, no remote migrations" boundary.
