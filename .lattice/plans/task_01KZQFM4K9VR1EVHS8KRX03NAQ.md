# MRQ-68: Decided · not notified — the built-in view and the attention row

## Objective

Deliver M-63 for AC-268 and AC-269 on the merged M-52 decision-row and M-11
outbox seams. The feature remains zero-schema: notification state is derived
from the latest `submission_decisions` row and its outbox history. The
implementation must never add or maintain a `notified` flag and must not edit
the binding contract documents or prototype.

## Decisions and boundaries

- Keep the immutable saved-view pattern from MRQ-34. Add the built-in
  `Decided · not notified` view and a fixed `Notified` column in the shared
  column registry; do not create a second screen or a user-editable built-in.
- Derive the latest decision deterministically (`decided_at DESC, id DESC`)
  and treat a decision as delivered when an outbox row associated with that
  decision is `sent`. The original decision outbox row is associated through
  `submission_decisions.outbox_id`; retry rows use the decision id as
  `outbox.entity_id`, with a fresh idempotency key per explicit retry.
- Render exactly the three contractual gap reasons: `Changed in Airtable`,
  `Not delivered`, and `No valid address`. Since SPEC Amendment 17 cut the
  Airtable mirror, retain the contract-compatible legacy reason for derived
  data and tests but state plainly in its detail copy that the mirror path is
  currently cut/theoretical. The PR body will name this choice.
- `Notify N speakers` is a dedicated authenticated program-write action over
  the built-in view. It reuses the acceptance/rejection decision template and
  merge data from the existing decision row, inserts new outbox rows, queues
  those rows, and never updates `submission_decisions` or the submission's
  decision attribution. Records without a valid address are excluded from the
  action and its count. Waitlisted rows remain on the existing M-52 semantics
  because M-52 has no waitlist notification template; the AC fixtures cover
  actual decision-mail paths (accepted/rejected).
- Keep the existing list envelope unchanged. A small summary endpoint supplies
  the all-matching sendable/no-address counts needed by the head action; the
  list endpoint accepts a typed `not_notified` status solely to drive the
  built-in view and returns reason data on each row.

## Files and implementation

1. Add `tests/ac-claims/MRQ-68.json` claiming AC-268 and AC-269.
2. Extend `src/lib/saved-views.ts` and `src/lib/submission-columns.ts` with the
   immutable built-in and fixed `notified` column. Extend the list item/API
   contract with escaped, structured notification state and reason detail.
3. In `src/routes/submissions.queries.ts`, add one deterministic derived
   latest-decision/outbox expression shared by the special list, summary, and
   dashboard count. Handle `not_notified` through that joined query only so
   existing minimal list fixtures without decision/outbox tables stay valid.
   Include the outbox status/suppressed reason/error in `Not delivered` detail.
4. Add the summary and notify routes to the existing submissions bulk route
   module (therefore the generated route manifest stays automatic). The
   notify service belongs with the decision/cascade mail seam, calls the
   existing renderer/queue path, uses a unique retry idempotency key, and
   records no audit mutation that could be mistaken for a new decision.
5. Extend the dashboard response with an unconditional fourth attention item:
   it links to `/submissions?status=not_notified`, reports the all-record count,
   and at zero says `Every decision has reached its speaker`. Update
   `DashboardPage`/CSS and `SubmissionsPage` so the built-in is selected from
   the saved-view strip, the `Notified` column names each reason, the Airtable
   copy is explicit about its theoretical status, and the head action says
   how many records need an address first. Reserve layout space at zero.

## Verification

- Add `tests/integration/api/decided-not-notified.AC-268-269.test.ts` using full
  migrations and isolated fixture rows for: an Airtable-origin decision with
  no outbox, queued/suppressed/failed outbox rows with distinct reason detail,
  and a no-address decision. Assert cross-event auth boundaries, exact list
  reasons/counts, dashboard count and zero-state payload, and built-in
  immutability through the existing views API.
- Assert AC-269 by snapshotting the existing decision's `decision`,
  `decided_at`, `decided_by_person_id`, and `feedback_md`, invoking notify,
  proving exactly one new outbox row per sendable record with decision-derived
  rendered content and a fresh idempotency key, proving no-address rows were
  neither counted nor queued, and proving sent records leave the view. Include
  a positive sent control and status/absence assertions.
- Extend/add node UI contract tests for the fixed column, built-in copy,
  unconditional fourth dashboard row, zero-state sentence, and no
  `notified` schema/flag write. Keep test names explicitly tagged AC-268/269.
- Re-run the targeted baseline rate-limit test separately, then `npm test`.
  The baseline before edits was 33/34 integration files green and 188/189
  tests green; the sole failure was the existing public-form rate-limit
  assertion at `tests/integration/api/public-form...test.ts:256`.
- Before PR: run `npm run pr-gate -- --ticket MRQ-68`, paste its result into
  the Lattice completion evidence and PR body, push `mrq-68-not-notified`,
  create the Forgejo PR against `master`, attach its URL, bump `pr_open`, and
  send the Orchestrator the final state through c11.

## Non-goals

No schema/migration, no contract-doc or prototype edits, no Airtable mirror
implementation, no change to the two `always_live` sites, no new decision
writer, and no deployment/merge.
