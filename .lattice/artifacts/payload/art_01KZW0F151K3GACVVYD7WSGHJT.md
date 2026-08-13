# Plan Review: MRQ-151 — V2-2, the review chain tells the reviewer and the chair the same truth

*Reviewed against `github/main` = `5441cf1c`. Note: the primary checkout's local `main`
(`22e4a75f`) is behind the remote and does not contain `src/lib/review-aggregate.ts`,
the agent-reviewer columns, or the reviewer-invite dialog. Every file/line citation below
is from `github/main`, not the stale working tree.*

## 1. Verdict

**FAIL (plan-level)**

## 2. Summary

The submitted plan is a verbatim copy of the task description — the same four numbered
items, the same VERIFY paragraph, no added implementation content. That is not fatal on
its own for a 60-minute copy ticket, but three of the four items turn out to have real
technical decisions hiding inside them that a copied brief cannot make: item 3 is
**infeasible as literally written** for one of the two exports (it is a native anchor
download; the page never sees the response body or a row count), item 4 points at a shared
definition that today emits **submission-level aggregate columns only** — there is no
exported per-evaluation weighted value to reuse — and item 1's copy change leaves `SPEC.md`
and the binding prototype asserting the old sentence. Send back for a short revision: the
plan needs roughly ten lines naming files, the export mechanism, and the per-evaluation
score decision. The ticket's *substance* is sound — item 1's replacement sentence is
demonstrably what the engine enforces (verified below), and the anti-pattern note about
the phantom data bug is excellent.

## 3. Issues

---

**[CRITICAL] Item 3 (Exports say what they did) — one of the two exports cannot report a row count without a mechanism change the plan does not mention**

There are two export controls, and they work in completely different ways:

- **Export A — `exportMatching`** (`src/ui/submissions/SubmissionsPage.tsx:588-623`).
  Client-side: it pages the list API, builds the CSV in JS, and triggers a blob download
  named `marquee-submissions.csv`. It already holds `exported.length` and the filename.
  Item 3 is a two-line change here.
- **Export B — "Export scores (CSV)"** (`src/ui/evaluation/EvaluationPage.tsx:585` and
  `src/ui/submissions/SubmissionsPage.tsx:733`). This is a plain
  `<a href="/api/v1/events/{eventId}/plans/{planId}/results/export?format=csv" download>`
  anchor pointing at `src/routes/evaluation-results.routes.ts:146-212`. The browser
  performs the download; **the page never observes the response**, so there is no `n`, no
  server-side row count, and no success/failure signal to put in a notice slot. The plan's
  claim that "the error path already exists" is true of Export A only — an anchor download
  failure is silent today.

Making Export B say what it did requires a real decision: (a) convert the anchor to a
`fetch` + blob download — but `apiFetch` (`src/ui/shell/api-client.ts:343-386`) always
calls `response.json()`, so this needs a text-capable path or a raw `fetch`, plus handling
for the `program:read` grant/cookie and the `Content-Disposition` filename; (b) have the
route emit a count header (e.g. `X-Row-Count`) — unreadable from an anchor, so this only
helps if (a) happens anyway; or (c) derive `n` from state the page already has (the results
table's row count) and label it honestly. Each has a different blast radius and a different
test story.

**Recommendation:** State which export mechanism changes and how. The cheapest honest path
is: do Export A exactly as specified; for Export B, convert to `fetch` + `Blob` +
`URL.createObjectURL` (mirroring `exportMatching`'s download tail), count the CSV's data
lines, and reuse the same notice slot. If that is judged out of budget, say so explicitly
and scope item 3 to Export A only — but then the ticket must not claim "after either
export," because the acceptance line would be false.

---

**[MAJOR] Item 4 (One score, one name) — the "shared review-aggregate definition" has no per-evaluation export; reusing it naively means duplicating its SQL**

`src/lib/review-aggregate.ts` is genuinely the one definition, and it is well-built — but
what it exports is `reviewAggregateColumns(submissionRef)` (lines 56-62), which emits
**submission-level** `score` / `review_count` / `score_is_weighted` (an `AVG` across
contributing evaluations). The per-evaluation weighted expression
(`Σ(weight_pct × score) / Σ(weight_pct)`, with fallback to the scalar
`evaluations.score`) lives in the private `contributingRows()` helper (lines 26-47) and is
not exported.

Item 4 asks a **per-review row** to show "the same weighted value the list shows." Two
different implementations satisfy that sentence and only one is right:

1. Extract the per-evaluation `CASE … weighted_value / scalar_value` fragment into a new
   exported function in `review-aggregate.ts`, and splice it into the record route's
   evaluations query (`src/routes/submission-record.routes.ts:596-601`) so one row's number
   comes from one definition. Correct.
2. Compute the weighted mean client-side in `SubmissionRecordPage.tsx` from the
   `criteria_scores` JSON the route already returns (line 693) plus the round's criterion
   weights. This *looks* like less work and is exactly the drift the module exists to
   prevent — including the `element.type IN ('integer','real')` and `weight_pct > 0`
   subtleties that are easy to miss.

There is also a phrasing trap: the list column is an **average across reviews**; a
per-review row is **one review's** value. An implementer reading "the same weighted value
the list shows" literally could render the submission aggregate on every reviewer's row,
which would be a new lie in place of the old one.

**Recommendation:** The plan should say: *"Export a `perEvaluationScoreColumns()` (or
equivalent) from `src/lib/review-aggregate.ts`; add `weighted_value` + `is_weighted` to the
record route's evaluations SELECT; render `{value} weighted` on each row with the raw
scalar as secondary detail, reusing `scoreBasisLabel`/`scoreBasisCell`. The per-row number
is that reviewer's weighted score; the list's number remains the average across reviews —
label both so the relationship is legible."*

---

**[MAJOR] Plan names no files, no test surface, and no ordering — four items spanning at least six files across three surfaces**

The checklist asks which files change; the plan answers nothing. From source, the real
footprint is:

| Item | Files |
|---|---|
| 1 | `src/ui/review/ReviewerPage.tsx:455` (queue head), `:463` (responsibility sentence), `:465` (queue-clear copy) — and a decision on `SPEC.md:466` / the six API error strings (see next issue) |
| 2 | `src/ui/evaluation/EvaluationPage.tsx:665-672`, `src/ui/evaluation/evaluation.css:108-109` |
| 3 | `src/ui/submissions/SubmissionsPage.tsx:588-623, 733, 735`, `src/ui/evaluation/EvaluationPage.tsx:585, 591`, possibly `src/routes/evaluation-results.routes.ts` |
| 4 | `src/lib/review-aggregate.ts`, `src/routes/submission-record.routes.ts:596-601, 692-693`, `src/ui/submissions/SubmissionRecordPage.tsx:377`, `src/ui/review/ReviewerPage.tsx:545` |

Note that item 4's second half — *"'Saved by reviewer {actor_id}' becomes the reviewer's
name"* — is **not** on the organizer's record. The record already renders
`<ReviewerName name={evaluation.reviewer_name} kind={…} />`
(`SubmissionRecordPage.tsx:377`). The `actor_id` string survives only on the **reviewer's
own** detail drawer (`ReviewerPage.tsx:545`), which means the API shape there
(`detail.review.actor_id`) may need a name field added. An implementer who reads item 4 as
"fix the record" will find it already fixed and either skip the item or go hunting.

**Recommendation:** Add a file table like the above, note that item 4's rename target is
`ReviewerPage.tsx:545` (and check whether the review-detail response carries a reviewer
name or needs one), and state the test surface: which existing Vitest files cover these
routes/components, and which of the four items gets a new assertion versus relying on the
manual VERIFY pass. Items 1–4 are independent — say so, so a partial landing is safe.

---

**[MAJOR] Item 1 — the new sentence is correct, but the old one survives in SPEC.md, the binding prototype, and six API error strings**

I verified the replacement copy against the engine and it is accurate.
`src/lib/reviewer-scope.ts:76-104` enforces exactly three conjuncts: event membership,
track intersection (`REVIEWER_TRACK_SCOPE_SQL`), **and** a direct-or-committee assignment
for this round (`REVIEWER_ASSIGNMENT_SCOPE_SQL`). So "assigned to you — directly or through
your committee — within your track responsibility" is the truth, and the current
responsibility sentence ("A submission appears when any carried track intersects your
scope") is genuinely wrong — it omits the assignment requirement entirely. Good ticket.

But the old sentence is load-bearing elsewhere:

- `SPEC.md:466` specifies the head as `N of M in your authorized tracks · … followed by
  the reviewer's explicit track-scope chips and **the intersection rule**`. Shipping the
  fix without touching SPEC leaves the spec asserting the behaviour we just called a
  defect — in a repo whose stated rule is that requirements trace and the build reproduces
  the binding artifact.
- `prototypes/pipeline-v1.1/index.html:2630` renders the same old string.
- Six API error strings still read `"reviewer resource is outside your authorized tracks"`
  (`src/lib/reviewer-scope.ts:126,140,158,181`; `src/routes/review.routes.ts:639,768`). A
  reviewer who hits a 403 gets the phrasing we just retired.

I checked the gate: `scripts/checks/verify-design-contract.mjs` asserts tokens, layout
metrics, and route-table labels only — no reviewer copy — so none of this fails
`pr-gate`. It is a truthfulness/traceability problem, not a red build.

**Recommendation:** Update `SPEC.md:466` in the same PR (one line). Explicitly decide the
API error strings: either update them for one vocabulary, or state in the plan that they
stay because they are a deliberately vague authorization refusal (which is a legitimate
choice — the current wording avoids confirming that a submission exists). Leaving the
prototype alone is defensible; say so rather than leaving it ambiguous.

---

**[MINOR] Item 2 — the pattern already exists in-repo, and there are two invite surfaces, not one**

The reviewer invite (`EvaluationPage.tsx:669-671`) shows the credential as
`<input readOnly>` + Copy — the defect the eval logged. But
`src/ui/setup/OrganizersCard.tsx:158-170` already does the *exact* thing item 2 asks for:
`<code class="setup-token">{minted.invite_url}</code>` beside a Copy button. Reusing that
pattern (and its `.setup-token-line` / `.setup-token` CSS) is cheaper than inventing one
and keeps the two invite surfaces consistent.

Two things the plan should settle: (a) is the organizer invite in scope? It is not
defective by item 2's standard, so "no" is the right answer — but say it; (b) craft rule.
`.invite-link` is a two-column grid with a fixed `min-height: 32px` input
(`evaluation.css:108-109`). A wrapping `<code>` grows the dialog as the URL wraps, and the
dialog is centred — "elements never jump" means reserving the height or accepting a
deliberate, stated growth on first render.

**Recommendation:** Reuse the `setup-token-line` treatment; state that the organizer
invite card is out of scope because it already complies; note the layout reservation.

---

**[MINOR] Item 4 — "one score, one name" has two honest exceptions the labelling must not paper over**

The list aggregate is not simply "all reviews on this submission":

- `contributingRows()` joins `people reviewer … AND reviewer.kind = 'human'`
  (`review-aggregate.ts:42-44`), so **agent evaluations are excluded from the list score**
  and surfaced separately as `agent_reviews_json`
  (`submissions.queries.ts:475-478, 542`).
- Abstained rows are excluded everywhere (`WHERE evaluation.abstained = 0`).

The record page, by contrast, renders **every** evaluation inline, agent rows included with
a kind chip, plus "Conflict declared" rows. So a chair who averages the record's visible
rows will not always reproduce the list number — legitimately. If item 4 ships a bare
label like "same as the list," it re-creates the misreading it was written to prevent.

**Recommendation:** Have the plan state the labelling contract: per-row = that reviewer's
weighted score; the submission-level number is the mean over non-abstained **human**
reviews; agent reviews are shown but do not feed it.

---

**[MINOR] Item 3 — the success notice must land in the reserved slot without moving the page**

`SubmissionsPage.tsx:735` renders
`<div class="export-message {exportError ? "visible" : ""}">{exportError || "Export status space reserved"}</div>`
— the space is already reserved specifically so the toolbar does not jump. A success
message must drive the same `visible` toggle (renaming the state to something like
`exportNotice` with a tone), not introduce a second element. `EvaluationPage` has its own
`notice` slot at `:591` with a dismiss button — a different pattern. Which slot each export
writes to should be named.

**Recommendation:** One line in the plan: "Export A writes the existing
`.export-message` slot on Submissions (rename `exportError` → `exportStatus` with a tone
flag); Export B writes `setNotice` on Evaluation."

---

**[MINOR] The VERIFY block has an unstated precondition and no automation**

VERIFY opens with *"As demo reviewer (chip reads 'Reviewing as …')"*. I could not find a
`"Reviewing as"` string anywhere in `github/main`'s `src/`, and the demo-reviewer seat path
is not named in the plan. If that chip is aspirational, or lives behind a demo-role switch
on the landing page (`src/routes/landing.route.tsx` has `data-demo-role` handlers), the
verifier will burn time discovering it. The four verification steps are otherwise concrete
and testable, but nothing says whether they are automated (Playwright/`npm run e2e`) or
driven by hand.

**Recommendation:** Name the exact route/mechanism for taking the demo reviewer seat, and
state whether VERIFY runs as an e2e spec or a manual browser pass. Given the ticket's
"whole loop" framing, at minimum drive it once in a real browser against `npx vite dev`.

---

## 4. Positive Observations

- **The task description is unusually good** — four items, each with the human problem, the
  eval item it closes, and a verification step. The plan's failing is that it added nothing
  to this, not that the source material was thin.
- **The anti-pattern note in item 4 is exemplary.** Explicitly telling the next agent that
  the 4.00-vs-2.00 "data-integrity bug" dissolved on investigation, naming *why*
  (`per_reviewer-dario-quill`), and instructing them not to go hunting — that saves a real
  hour and prevents a speculative "fix" to a correct aggregate. More tickets should carry
  a paragraph like it.
- **Item 1's replacement sentence is verifiably true**, which is the hard part of a copy
  ticket. I traced it to `reviewer-scope.ts:76-104` and the three conjuncts are exactly as
  the new wording describes. The current sentence really is wrong.
- **Scope is genuinely small and well-isolated.** Four independent items, no migrations, no
  API contract breaks, no overlap with the in-flight tickets (MRQ-148 touched
  `AgendaPage.tsx`; the branch base `a8b97e0a` is one commit behind `github/main` and
  already carries `review-aggregate.ts`). A partial landing is safe, which is the right
  shape for a 60-minute ticket.
- **Every fix has an in-repo precedent to copy** — `OrganizersCard` for the readable link,
  `exportMatching` for the blob download, `scoreBasisLabel`/`ReviewerName` for the
  labelling. This ticket can be done almost entirely by reuse, and a revised plan that says
  so will be shorter than one that invents.
