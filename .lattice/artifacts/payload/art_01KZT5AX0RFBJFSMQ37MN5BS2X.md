# Code Review: MRQ-97 — accepted fact filter and categorized status control

Reviewer: independent Claude review agent (cold context)
Branch: `mrq-97-accepted-filter` (tip `a689f3b`, PR #51)
Worktree: `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-97-accepted-filter`

## 1. Verdict

**FAIL (implementation-level)**

The plan is sound and the headline defect is genuinely fixed and genuinely tested. One
change in the final commit (`a689f3b`) re-introduces the ticket's own disease on the very
screen the operator complained about: the list's **Status** column now labels the stored
fact `accepted` with the *pipeline-stage* name "Ready to place", which is false for every
accepted record that is waved, in onboarding, or otherwise not ready to place. One line to
fix; everything else in the change stands.

## 2. Summary

Reviewed the full diff: the new `accepted_any` predicate and its filter/stored-semantics
plumbing, the dashboard "Unscheduled" count/href repointing, the stage rename to "Ready to
place" across route table / board / dashboard / landing / prototype, the grouped
`<optgroup>` status control, and the new lifecycle regression test. The core is right:
`accepted_any` is `s.status = 'accepted'` with no stage conditions, it holds through wave
pending → onboarding → scheduled → published, the MRQ-76 shared stage predicate is
untouched, and the dashboard count↔destination pairing is preserved and still covered by
the existing AC-15 parity test. `npm test` is green at the tip (105 node tests + the worker
suites, 36.0s against the 45s budget); `check:design` and `check:api` both pass.

The key finding is the row status chip: `SubmissionsPage.tsx:108` maps the *stored* status
`accepted` to the *stage* label "Ready to place". The list item's `status` is the stored
value for any unplaced record (`submissions.queries.ts:345-349`) — the project's own new
test asserts `status: "accepted"` on a record whose `stage` is `"waved"` — so the chip now
asserts a stage the record is not in, and the word "Accepted" no longer appears anywhere in
the list.

## 3. Issues

**[MAJOR] src/ui/submissions/SubmissionsPage.tsx:108 — the row Status chip labels a stored fact with a stage name it does not hold**

`statusLabel()` feeds the Status column (`:190`) and the CSV export (`:476`). Its input is
`SubmissionListItem["status"]`, which `toItem()` sets to the **stored** status
(`submissions.queries.ts:345-349`) unless the record is on the agenda — never to a derived
stage. `unreviewed` / `waved` / `onboarding` can never arrive there. So mapping
`accepted → "Ready to place"` labels every unplaced accepted record — including ones with a
pending wave and ones with open onboarding tasks — as "Ready to place", which is precisely
the set the "Ready to place" *stage* filter excludes.

Failure scenario, straight from the change's own coverage
(`tests/integration/api/submission-decisions.AC-66-69-114-117.test.ts:206-210`): 150 records
are accepted into a pending wave. The list returns them with `status: "accepted"` while
`GET /submissions/{id}` reports `stage: "waved"`. An organizer picks **Accepted (any stage)**
and gets 150 rows, every chip reading "Ready to place". They then pick **Ready to place**
(sidebar item 4, `?status=accepted`) and get **0 rows**. Two filters, one screen, flatly
contradictory — the same "a label counts a different set than its destination" failure
MRQ-76 exists to prevent. The same record's detail page shows the chip "Accepted"
(`record-copy.ts:14-18`) *next to* the stage chip "Ready to place"
(`SubmissionRecordPage.tsx:152,155`), so the record page gets this right and the list does
not. The CSV export inherits the same wrong string.

**Fix:** delete line 108 so the chip reads "Accepted" again — the column is the stored-fact
column, and "Accepted" is the organizer's word for that fact (`PHILOSOPHY.md`). If a stage
belongs in the list, it has to be a separate column fed by the derived stage (the list item
carries no `stage` field today, so that is a bigger change and out of this ticket's scope).
Note this change arrived only in `a689f3b`; `85f35ff` — the commit the PR's gate evidence
was captured against — did not have it.

**[MINOR] tests/node/* — no test pins the new status control or the chip label**

Nothing in `tests/` mentions `status-filter`, `optgroup`, or `All statuses`; the acceptance
item "the status control reads as categories, not a flat 14-item list, and 'All statuses' is
visibly the default" is asserted only by the browser screenshot. The `tests/node` harness
already renders `SubmissionsPage` (e.g. `views-ui.AC-134-248.test.mjs`), so a render
assertion is cheap.

**Fix:** add one node test asserting (a) the three `<optgroup>` labels and the `is-default`
class on an empty status, and (b) that an item with `status: "accepted"` renders the chip
"Accepted". (b) would have caught the issue above and would keep the vocabulary from
drifting again.

**[MINOR] tests/integration/api/submission-decisions.AC-66-69-114-117.test.ts:201 — the regression leans on sibling-test ordering and a raw SQL wave send**

The new test never performs the acceptance itself; it depends on an earlier test in the same
`describe.sequential` having bulk-accepted 150 records, and it advances the wave with
`UPDATE waves SET sent_at = ?` rather than the product's send action. Reordering or skipping
the earlier test turns this into a confusing failure, and the raw update means the real
wave-send path is not exercised by this particular guarantee.

**Fix:** either accept the target record inside this test (it is idempotent enough — the
decision route is already exercised above) or add a short comment naming the ordering
dependency. Driving the wave send through its route would also close the last real-path gap.

**[MINOR] src/routes/dashboard.routes.ts:236-242 — "Unscheduled" now counts records that can never be scheduled**

The count and href are correctly paired (`accepted_any` + `placement=unplaced`, verified by
the AC-15 parity loop), and the note was honestly requalified. But neither side filters
`kind = 'session'`, so accepted **abstracts** inflate a metric named "Unscheduled" — a
pre-existing wart the widened predicate makes more visible, since waved and onboarding
abstracts now join it. The agenda empty-state link
(`AgendaPage.tsx:638`) has the same gap: it opens a list containing records the agenda pool
would never show.

**Fix:** if you take it, add `kind: "session"` to **both** the count query and
`submissionsHref({...})` in the same edit so the pairing invariant holds, and to the agenda
empty-state href. Safe to defer — flagging so it is a decision, not an oversight.

**[MINOR] SPEC.md:19 — lifecycle vocabulary not updated for the stage rename**

`Submitted → In Review → Waved → Accepted → Onboarding → Scheduled → Published` and the
"list chips" reader note at `:190` still use the old name. The PR body documents the rename;
the spec does not. `check:design` passes because it checks the route table, which was
updated in lockstep with the prototype.

**Fix:** one-line spec touch-up to `… → Ready to place → …` with a parenthetical that the
stored fact is still `accepted`.

**[NIT] PR #51 body — the screenshot is linked at a branch path**

`https://github.com/.../blob/mrq-97-accepted-filter/artifacts/...png` 404s once the branch is
deleted after merge. The file is committed (precedent: `artifacts/mrq-95-local-speaker-date.png`),
so the durable form is a `blob/main/...` link or an uploaded attachment. Also worth noting:
the PR's gate/browser evidence is stamped at `85f35ff`, but the branch tip is `a689f3b` — I
re-ran the suite at the tip and it is green, but the browser proof predates the chip change.

## 4. Positive Observations

- **The judgment call is the right one.** Keeping `status=accepted` as the MRQ-76 shared
  stage projection and adding an explicit, additive `accepted_any` fact filter avoids
  inventing a parallel stage derivation and avoids silently re-meaning existing saved views
  and URLs. The reasoning is stated plainly in the PR, as the ticket asked.
- **The invariant is protected by an existing test, not by assertion.** Repointing the
  Unscheduled metric to `accepted_any` + `unplaced` keeps count and href paired, and
  `dashboard.AC-14-15-240.test.ts:146-148` re-verifies every dashboard number against its own
  destination's total — so this could not have drifted silently.
- **The lifecycle regression is the right test for this defect.** It walks one real record
  from wave-pending → onboarding → scheduled → published against the running Worker and
  asserts the fact filter holds while the *stage* visibly moves. That is exactly the shape of
  coverage whose absence let the original bug ship green, and it exercises the stored-semantics
  selector path too (`selectSubmissionIds(..., { statusSemantics: "stored" })`), which is the
  arm that would otherwise have returned zero rows for `accepted_any` in bulk/comms.
- **Splitting `SUBMISSION_LIST_STATUSES` from the filter enum** is a small, precise piece of
  API hygiene: `accepted_any` is advertised as a query value and can never be returned as a
  row status. The registry SHA was regenerated and `check:api` passes.
- **The binding prototype was updated in lockstep** — nav item, pipeline tiles, mini-pipeline,
  board column label, and the grouped status select — rather than letting the build diverge
  from `DESIGN.md`'s one-to-one rule. `boardStageFor`-based prototype filters for
  `Accepted`/`Onboarding` were tightened to match the app's derivation too.
- Filter, saved-view, bulk, comms, evaluation, and mail-audience consumers were all traced
  and all resolve `accepted_any` correctly through `submissionFilterSchema`; no consumer was
  left behind, and no status was dropped from the vocabulary.
