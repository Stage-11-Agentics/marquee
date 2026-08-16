# MRQ-237 — authoritative branch plan

**Task:** MRQ-237  
**Actor:** `agent:delegator-mrq-237`  
**Worktree:** `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-237-publication-truth`  
**Branch:** `mrq-237-publication-truth`  
**Plan status:** `in_planning`; Cycle 4 plan amendment is authoritative after Cycle 3 plan-review FAIL artifact `art_01M055Q3ND00BCZ0P3RB7W9RKP`; implementation remains held.
**Base/head at planning start:** `github/main` = `52bb485f105e0392fe475332b87cbb48dbcee832`; local `HEAD` matches exactly.  
**Terminal boundary:** stop at `pr_open`; Merge Captain owns merge. No deploy or publication.

## Scope and non-goals

Ship the signed v1.17 publication-truth behavior through the real production seams:

- one shared, server-authoritative publication-readiness helper consumed by the agenda publication projection, batch publisher, record projection/action flags, dashboard gauges, and public projection guard;
- a complete, named blocked-reason vocabulary rather than one generic `blocked_reason` plus silent SQL omissions;
- review-before-publish copy and data for `N will go live · M withheld`, with per-row reasons, a named all-or-nothing conflict, and the live-but-no-longer-accepted warning;
- the signed six-gauge Work-in-motion row: retain the existing four including `Unscheduled`, and add the publication pair `Not yet public` and `Live on site`, with exact server-side submission filters and zero-state boxes preserved;
- unchanged all-or-nothing batch publication, now returning record-level reasons when the selection is no longer publishable;
- honest zero-effect behavior for direct republish, bulk decisions, communications, and notification retry;
- published-column retention plus `Withdrawn after publish` / `Rejected after publish` chips and record-page divergence copy;
- targeted non-browser tests for the truth table, clickthrough filters, every zero-row surface, no-op responses, and the anomaly path.

Do not edit `SPEC.md`, `DESIGN.md`, `PHILOSOPHY.md`, `sequence/PRODUCT-DEFINITION.md`, or consolidation artifacts in this ticket. Contract fold and claims remain held behind the shared order MRQ-242 → MRQ-241 → MRQ-234 → MRQ-244. New acceptance criteria and user stories remain unnumbered in this plan/tests; no stable US/AC numbers are minted before an explicit `CONSOLIDATION RESUME`.

No browser, computer-use, live write, deploy, or publication validation is in scope. Browser/live evidence is explicitly `N/A — approval not granted`; targeted API, SQL, render, type, and test proof is the validation path.

## Binding design and seam audit

The signed comment on MRQ-237 approves `prototypes/pipeline-v1.1` v1.17 at commit `390d52dc`. Its load-bearing details are:

- the seven-stage strip remains seven;
- Work in motion has `Unscheduled`, `Not yet public`, and `Live on site` alongside the existing gauges, all six boxes remaining visible at zero and linking to the exact work set;
- the review step says `N will go live · M withheld — reasons named per row` before confirmation;
- an already-live no-op says `Already live — nothing changed`;
- a live-but-no-longer-accepted session gets a warning that publishing more will not touch it;
- the published board column retains a reversed row and stamps the warning chip.

The exact production seams inspected before planning are `src/routes/agenda.queries.ts`, `src/routes/agenda.routes.ts`, `src/routes/submission-record.routes.ts`, `src/routes/submissions.queries.ts`, `src/routes/dashboard.routes.ts`, `src/api/agenda.ts`, `src/api/dashboard.ts`, `src/lib/public-site.ts`, `src/api/board.ts`, `src/ui/agenda/AgendaPage.tsx`, `src/ui/dashboard/DashboardPage.tsx`, `src/ui/dashboard/register-variants.tsx`, `src/ui/board/ProgramBoardPage.tsx`, `src/ui/submissions/SubmissionRecordPage.tsx`, `src/ui/submissions/SubmissionsPage.tsx`, `src/routes/comms.routes.ts`, `src/routes/org-comms.routes.ts`, `src/routes/submissions-bulk.routes.ts`, and `src/jobs/cascade/decisions.ts`.

### Multiline-aware publication predicate re-derivation

The audit did not trust the ticket's count. The current SQL and projection code exposes these independent gates and omissions:

1. the submission must be scoped to the requested event;
2. the submission must be `kind = 'session'` (the agenda candidate query has this; the public session query does not state it explicitly);
3. the workflow status must be `accepted` to publish (the record action and batch write enforce this; the public query currently permits every status except `rejected`/`withdrawn`);
4. a session must have an agenda item for the same event, submission, and `kind = 'session'`;
5. the item must be unpublished for the candidate/review set;
6. an existing published item must exclude the submission from the candidate set even if the legacy `submissions.is_published` mirror is stale;
7. a publishable item needs a complete slot: start time, positive duration, and a room;
8. the room and its building must resolve inside the same event; otherwise the public join/projection cannot truthfully describe the slot;
9. the public projection additionally requires the event's public/live boundary, a matching submission/item pair, a published item, a session item, and the privacy exclusion for rejected/withdrawn records.

These are represented as fact-based reasons, not nine guessed strings. The implementation will keep distinct reasons where the facts distinguish them and use the honest combined copy only where the underlying data cannot distinguish them (for example, a wholly absent agenda item has no separate room-versus-time fact). The draft vocabulary is:

- `needs a room and time before it can go public`;
- `needs a date and time before it can go public`;
- `needs a duration before it can go public`;
- `needs a room before it can go public`;
- `the room is not part of this conference`;
- `only Sessions can go public`;
- `no longer accepted — the decision was reversed after scheduling`;
- `already live — nothing changed`;
- `the agenda record is already published`.

The helper will expose stable machine reasons plus organizer-facing strings so tests can exercise the full truth table without coupling every consumer to prose. A missing/foreign/malformed row never becomes an unlabelled `WHERE` omission.

One deliberate contract marker is required at the existing public privacy seam:

`SPEC-MRQ-237-PUBLIC-PRIVACY: [beyond v1.17 prototype — acknowledged divergence]` — v1.17's seeded public mock filters only the scheduled item's `Published` state, while the production privacy contract from MRQ-83 excludes rejected/withdrawn submissions from the attendee agenda. MRQ-237 keeps that exclusion; the signed design's anomaly visibility is implemented in organizer/admin surfaces, never by leaking a reversed session publicly. The marker will live beside the shared public predicate and in the targeted regression test. No silent judgment.

`SPEC-MRQ-237-PUBLICATION-GAUGES: [beyond v1.17 prototype — acknowledged divergence]` — the signed v1.17 mock counts every scheduled-unpublished row as `Not yet public` and every published row as `Live on site`. MRQ-237 deliberately chooses the truthful production sets `ReadyToPublish_e` and `PublicLive_e`: malformed, withheld, non-public-boundary, privacy-excluded, and other non-ready rows are not counted as ready, and `BoardAnomaly_e` remains visible as the signed warning/sub-line but is not counted as public-live. This is the only gauge-membership divergence; v1.17 geometry, labels, six zero-state boxes, warning treatment, and exact clickthrough behavior remain literal. The dashboard URLs and list filters below are the binding implementation of this choice. The Adoption Orchestrator folds this marker and its exact set semantics into `SPEC.md` (publication section), `EVALUATION.md` (gauge/list parity), `sequence/USER_STORIES.md`, and the claims destination after `MRQ-244` under explicit `CONSOLIDATION RESUME`. No silent judgment.

### Multiline-aware zero-effect inventory

The current no-effect paths are:

- `setPublication()` returns silently when both publication flags already equal the target, so direct republish is a 200 with no audit or explanation;
- agenda batch accepts a non-empty request but returns a generic 409 when one or more rows are not in its candidate map, without naming the rows/reasons;
- bulk decisions resolve a filter/ID set to zero and return a success-shaped `0 accepted.` / `0 rejected.` / `0 waitlisted.` response;
- notification retry resolves no `not_notified` decisions and returns a 202 with zero counts;
- conference communications can resolve an empty selector and return a 202 with zero selected/queued, while its UI reports only numeric accounting; every syntactically valid keyed request, including a zero-row or duplicate-only operation, needs a durable request record before resolution so replay and key-conflict behavior cannot depend on outbox rows;
- a non-empty communications selection can produce no new outbox row because every result is duplicate or skipped; the result must distinguish that from a fresh queue;
- org communications already has the reference behavior: refuse an entirely empty organization selection with `that selection resolves to nobody in this organization`, or succeed while naming exclusions. This is the pattern to carry into the conference-scoped surfaces.

The onboarding reminder drawer uses the conference communications seam and is covered through that shared path; controls are already disabled for an empty local selection. Ordinary zero-valued gauges and list empty states are not actions: they remain rendered and explain what zero means rather than being hidden.

## Implementation phases

### Phase 0 — plan, review, and lifecycle

1. Commit and push this plan as the first branch commit, staging only this plan file. Verify local branch HEAD equals `github/mrq-237-publication-truth` after push.
2. Do **not** request plan review or transition `planned` while the MRQ-233 sole review is running. After the Adoption Orchestrator explicitly releases the slot, request the sole MRQ-237 plan-review slot at c11 `workspace:10` / `surface:513`, mailbox `adoption-orchestrator`; only then move `in_planning → planned`.
3. At every later phase boundary fetch `github`, record the exact base/head, and recheck migration numbering. The current tree has `0028_participant_fanout.sql`. Cycle 4 now requires a draft migration for durable request operations and their operation-to-outbox links; use an unnumbered planning label such as `NNNN_request_operations.sql` here, re-derive the next real slot at implementation and after every rebase, and never assume `0029`. The migration/schema/reset/delete/audit contract is binding in §3c below.

### Phase 1 — canonical publication truth

Add a focused `src/lib/publication-truth.ts` seam containing the publication facts, machine reasons, organizer copy, shared readiness function, and reusable SQL fragments for the public guard. The helper must distinguish candidate, publishable, already-live, malformed, and post-publish-anomaly states without reading UI state or the legacy submission mirror as authority.

Refactor `readAgendaPublication()` and the batch route to use the same helper. The agenda projection will return the full review set: accepted unscheduled rows and scheduled-but-unpublished rows whose current status may now be rejected/withdrawn, with `can_publish` and a named reason per row. `not_yet_public` will describe exactly `ReadyToPublish_e`; the withheld scheduled diagnostics remain in the review collection but are not counted by the dashboard filter. The batch route will validate every selected row against that projection, return record IDs/titles/reasons in the 409 details, and preserve the existing two-write count guards and audit all-or-nothing behavior.

Refactor `loadRecord()` / `setPublication()` to call the same helper. Add record-facing publication truth/anomaly data, make the direct publish no-op return an explicit effect/notice, and keep audit/cache behavior unchanged for true transitions. A rejected/withdrawn published row must be non-publishable while still exposing the divergence and an available deliberate unpublish/reversal path consistent with existing guards.

Use the shared public SQL fragment in `src/lib/public-site.ts` and retain the SPEC privacy marker above. The public attendee/embedded projection must continue to exclude rejected/withdrawn rows while the organizer surfaces show the anomaly.

### Phase 2 — dashboard, publication panel, and board

Extend `src/api/dashboard.ts` and `src/routes/dashboard.routes.ts` with the two publication gauges and the shared publication counts/anomaly warning. Keep the seven pipeline stages unchanged. Bind the exact list contract: add `not_yet_public` and `live_on_site` to `SUBMISSION_STATUS_FILTERS` and `submissionFilterSchema`; make `submissionStatusPredicate("not_yet_public")` and `submissionStatusPredicate("live_on_site")` delegate to the shared publication-classification SQL for `ReadyToPublish_e` and `PublicLive_e`; and make both the dashboard count query and `listSubmissions()` use that same event-scoped classification fact. The exact URLs are `/submissions?kind=session&status=not_yet_public` and `/submissions?kind=session&status=live_on_site`; neither URL may use the old `scheduled`/`published` predicates or `placement=unplaced`. The list query must return exactly the rows counted by its corresponding gauge, including zero rows, with `BoardAnomaly_e` exposed as the live warning/sub-line but excluded from the `live_on_site` count. Ensure the metrics array always contains all six boxes, including zero values, and that the default and register renderers remain wired to the same array.

Update `src/ui/agenda/AgendaPage.tsx` and `src/ui/agenda/agenda.css` so the review step enumerates the complete selected publishable set plus withheld rows/reasons, renders the signed warning when a live anomaly exists, and uses truthful empty/no-selection copy. Preserve the signed checkbox/readability geometry and six-gauge Flight Deck treatment; any copy or layout change beyond v1.17 receives a SPEC marker.

Extend `src/api/board.ts` / `src/ui/board/ProgramBoardPage.tsx` / board styles with an explicit post-publish anomaly field. Published stage precedence remains status-blind so the card cannot vanish; the card adds the signed warning chip (`Withdrawn after publish` or `Rejected after publish`). Add record-page divergence copy and preserve exact clickthrough behavior from the dashboard gauges.

### Phase 3 — zero-effect actions

- Return a structured no-op effect from direct publication and render `Already live — nothing changed` (and the corresponding already-unpublished explanation where applicable) without creating an audit row.
- Refuse conference bulk decision selectors that resolve to nobody with the org-comms-style not-found explanation. For every syntactically valid, non-empty selection whose unique IDs all fail, return the exact `409` all-failed operation contract in §3b: closed `ALL_FAILED` reason, first failure plus total counts, no decision/cache/mail/outbox effect, request-level audit, and keyed byte-identical replay/key-conflict handling.
- Refuse notification retry when no decisions remain; if rows exist but have no valid address, succeed with the explicit address exclusion rather than pretending a send occurred.
- Refuse conference communications when the selector resolves to nobody; when all selected rows are duplicate/skipped, render why nothing new was queued. Preserve explicit-empty-selector semantics so clearing a selection cannot become an all-recipient send.

No unrelated bulk/export/import semantics are changed. No stable criterion is minted for these behaviors.

### Phase 4 — targeted proof, review, gate, and handoff

Add/update tests with `CONTRACT · MRQ-237 ...` titles only:

- unit truth-table coverage for every named reason and the shared helper's identity/precedence;
- durable keyed conference/org communication-operation coverage for claim-before-send, zero-row records, byte-identical replay, changed-fingerprint `409 key-conflict`, fresh/in-flight/stale-lease recovery, exact response/outbox IDs, reset/delete behavior, and request-audit versus recipient-audit accounting;
- agenda API coverage for accepted unscheduled, accepted scheduled, rejected/withdrawn after publish, malformed/foreign slot facts, already-live exclusion, per-row review reasons, and all-or-nothing batch conflict details;
- record API coverage proving `actions.can_publish`, no-op effect/notice, audit absence on no-op, and post-publish anomaly data;
- dashboard API/UI coverage proving six always-rendered gauges, zero values, the exact `kind=session`/`not_yet_public` and `kind=session`/`live_on_site` URLs, shared-classification count/list parity, and each clickthrough's returned set;
- agenda review render coverage for `N will go live · M withheld`, every row reason, the live anomaly banner, and every publication-panel zero-row state;
- board API/render coverage for retained published rows and both warning-chip variants;
- zero-effect coverage for bulk decisions, including the exact non-empty all-failed unknown/illegal/live-refused contract and keyed replay, communications, notification retry, duplicates/skips, and the existing org-comms reference pattern.

Run focused Vitest/node tests, `npx tsc --noEmit`, and relevant static/design checks first. Record browser/computer validation as N/A. Before any full `pr-gate`, send the exact HEAD and requested command to mailbox `merge-captain` and wait for a serialized gate slot. Run the full gate only in that slot, interpret `pass-over-budget` as pass and timeout as unknown, then attach exact-head evidence.

Request one non-author review from the Adoption Orchestrator, address any review findings, re-run targeted proof, push every meaningful commit, and open the PR with `gh` only after the exact-head gate and review handoff are complete. Set `in_validation`, attach validation evidence, then `review → pr_open`; stop immediately at `pr_open` and report the PR/head/gate/review state to surface 513. Do not merge or deploy.

## Branch and evidence ledger

- Cycle 1 plan commit: `7bf8fa266e1bf330e83b2ab1254c2f9bcf5c54b7` (plan-only, pushed).
- Cycle 2 amendment commit: `a76264aacc0cbb8d96682b49c39b91da86477012` (plan-only, pushed).
- Cycle 3 amendment commit: `2352d134fe20441744a7ef148edf75f0be97b366` (plan-only, pushed).
- Cycle 4 amendment commit: pending; must remain plan-only and be pushed before any code.
- Implementation commits: one logical concern per commit, pushed immediately.
- Migration: draft `NNNN_request_operations.sql` plus operation-to-outbox link schema is required for request replay and zero-row durability; re-derive the real number at implementation and after any rebase.
- Browser/live approval: not requested; validation N/A and no live side effects.
- Stable US/AC claims: held for consolidation; only `CONTRACT · MRQ-237 ...` test titles.
- Final required report: exact cwd, branch, local HEAD, remote branch HEAD, PR number/head, gate status, non-author review result, targeted test commands/results, and explicit no-merge/no-deploy boundary.

## Plan-Review Cycle 1 Resolutions (AUTHORITATIVE)

**Review artifact:** `art_01M052WPMCQCNN4S1WQV65VG3W` at exact head `7bf8fa266e1bf330e83b2ab1254c2f9bcf5c54b7`.

This section is the binding Cycle 2 amendment. It resolves the three plan blockers without reopening the cleared geometry, privacy, board, trace, browser, or migration decisions. It supersedes any less-specific wording elsewhere in this plan. No feature code, contract file, stable US/AC number, migration, browser proof, gate, or live side effect is authorized by this amendment.

### 1. Canonical publication facts, machine reason codes, and set algebra

The implementation must export one closed machine enum named `PublicationReasonCode`. These values are wire-stable within this ticket; organizer copy is a separate mapping and must never replace a code:

```text
READY_TO_PUBLISH
ALREADY_PUBLISHED
POST_PUBLISH_REVERSED
WRONG_KIND
FOREIGN_EVENT
UNKNOWN_ID
STALE_SELECTION
MALFORMED_SLOT
MISSING_AGENDA_ITEM
MISSING_DATE_TIME
MISSING_DURATION
MISSING_ROOM
FOREIGN_ROOM
NOT_ACCEPTED
PUBLIC_BOUNDARY_CLOSED
PRIVACY_EXCLUDED
```

`reason_codes` is a set of every true fact for the row, serialized in the fixed precedence below; `primary_reason_code` is the first code. A consumer may display the primary copy, but it must retain and test the complete set. No consumer may infer a reason from a missing SQL row or from a prose string.

The required precedence, from most specific/security-relevant to least specific, is:

```text
FOREIGN_EVENT > UNKNOWN_ID > WRONG_KIND > POST_PUBLISH_REVERSED
> ALREADY_PUBLISHED > STALE_SELECTION > MALFORMED_SLOT
> NOT_ACCEPTED > MISSING_AGENDA_ITEM > MISSING_DATE_TIME
> MISSING_DURATION > MISSING_ROOM > FOREIGN_ROOM
> PUBLIC_BOUNDARY_CLOSED > PRIVACY_EXCLUDED > READY_TO_PUBLISH
```

`POST_PUBLISH_REVERSED` is emitted alongside `ALREADY_PUBLISHED` for a published row whose current decision is rejected or withdrawn, and wins as the primary anomaly explanation. A normal already-live accepted row emits `ALREADY_PUBLISHED` as primary. `MALFORMED_SLOT` is emitted with structured detail flags for invalid timestamps, non-positive duration, missing room, or an event-foreign room; the specific missing/foreign codes are also emitted where their facts are known. `UNKNOWN_ID` is reserved for an ID that cannot be found in any accessible conference row; a row found under another event emits `FOREIGN_EVENT` and never leaks that event's data.

The organizer-copy mapping is binding for the current surfaces:

```text
READY_TO_PUBLISH       -> null
ALREADY_PUBLISHED      -> "already live — nothing changed" (direct action)
                          or "the agenda record is already published" (selection explainer)
POST_PUBLISH_REVERSED  -> "no longer accepted — the decision was reversed after scheduling"
WRONG_KIND             -> "only Sessions can go public"
FOREIGN_EVENT/UNKNOWN_ID -> "this record is not part of this conference"
STALE_SELECTION        -> "the selection is stale — refresh before publishing"
MALFORMED_SLOT         -> "the scheduled slot is malformed before it can go public"
MISSING_AGENDA_ITEM    -> "needs a room and time before it can go public"
MISSING_DATE_TIME      -> "needs a date and time before it can go public"
MISSING_DURATION       -> "needs a duration before it can go public"
MISSING_ROOM           -> "needs a room before it can go public"
FOREIGN_ROOM           -> "the room is not part of this conference"
NOT_ACCEPTED           -> "no longer accepted — the decision was reversed after scheduling"
PUBLIC_BOUNDARY_CLOSED -> "the public agenda is not open yet"
PRIVACY_EXCLUDED       -> "withheld from the public agenda by privacy rules"
```

For event `e`, define these named fact sets over submission IDs. The submission-side Session fact is deliberately independent of an optional agenda item: `AgendaItem` is a separate relation, never part of the definition of a Session. `ValidSlot` means exactly one matching item with a non-null valid start, positive duration, room, and room/building belonging to `e`; `PublicBoundary` and `PrivacyAllowed` are the existing event/public-projection facts, not UI state:

```text
S_e = { s | s.event_id = e ∧ s.kind = 'session' }
I_e(s) = { a | a.event_id = e ∧ a.submission_id = s.id ∧ a.kind = 'session' }
n_e(s) = |I_e(s)|
NoItem_e = { s ∈ S_e | n_e(s) = 0 }
OneItem_e = { s ∈ S_e | n_e(s) = 1 }
MultiItem_e = { s ∈ S_e | n_e(s) > 1 }
A_e = { s ∈ S_e | s.status = accepted }
Published_e = { s ∈ OneItem_e | the item in I_e(s) has is_published = 1 }
Unpublished_e = { s ∈ OneItem_e | the item in I_e(s) has is_published = 0 }

AcceptedUnscheduled_e = { s ∈ NoItem_e | s.status = accepted }
UnscheduledWithheld_e = { s ∈ NoItem_e | s.status ≠ accepted }
ExistingItemMalformed_e = MultiItem_e ∪
  { s ∈ Unpublished_e | ¬ValidSlot(s) }
ExistingItemWithheld_e = { s ∈ Unpublished_e | ValidSlot(s) ∧
  (s.status ≠ accepted ∨ ¬PublicBoundary_e) }
ReadyToPublish_e = { s ∈ Unpublished_e | ValidSlot(s) ∧
  s.status = accepted ∧ PublicBoundary_e }

ScheduledUnpublishedDiagnostics_e =
  { (s, 'withheld') | s ∈ ExistingItemWithheld_e } ⊔
  { (s, 'ready') | s ∈ ReadyToPublish_e }

BoardAnomaly_e = { s ∈ Published_e |
  s.status ∈ {rejected, withdrawn} }
PublicLive_e = { s ∈ Published_e |
  s.status = accepted ∧ ValidSlot(s) ∧ PublicBoundary_e ∧ PrivacyAllowed_e }
PublishedNotPublic_e = Published_e \ (BoardAnomaly_e ∪ PublicLive_e)
PublishedIncludingAnomalies_e =
  BoardAnomaly_e ⊔ PublicLive_e ⊔ PublishedNotPublic_e

S_e = AcceptedUnscheduled_e ⊔ UnscheduledWithheld_e ⊔
  ExistingItemMalformed_e ⊔ ExistingItemWithheld_e ⊔ ReadyToPublish_e ⊔
  BoardAnomaly_e ⊔ PublicLive_e ⊔ PublishedNotPublic_e
```

The displayed `Unscheduled` gauge reads exactly `AcceptedUnscheduled_e`; an accepted Session with no matching agenda item can never disappear into a join omission. The signed `Not yet public` gauge reads exactly the `ready` arm of `ScheduledUnpublishedDiagnostics_e`, which is `ReadyToPublish_e`; the `withheld` arm is diagnostic only and is never counted as ready. The signed `Live on site` gauge reads `PublicLive_e` and carries the warning/sub-line from the disjoint `BoardAnomaly_e`. `PublishedIncludingAnomalies_e` is an aggregate label whose three tagged children are the non-overlapping published states; it is never counted alongside its children. `ExistingItemMalformed_e` is separate from `ExistingItemWithheld_e`; malformed scheduled rows never enter either publishable or scheduled-unpublished-ready counts. The displayed state partition is exhaustive and pairwise disjoint, and every projection uses this same fact object rather than a consumer-specific WHERE predicate.

### 2. Selected-ID explainer and all-or-nothing publication

The shared helper must expose `explainPublicationSelection(event_id, selected_ids, expected_revisions?)` before any publication write and again on a compare-and-swap conflict. Its result is a bounded, deterministic object:

```text
{
  operation_id: ULID,
  requested_ids: string[],
  duplicate_ids: string[],
  rows: [{
    submission_id: string,
    title: string | null,
    classification: "UNKNOWN_ID" | "FOREIGN_EVENT" | "WRONG_KIND" |
      "STALE_SELECTION" | "ACCEPTED_UNSCHEDULED" | "UNSCHEDULED_WITHHELD" |
      "EXISTING_ITEM_MALFORMED" | "EXISTING_ITEM_WITHHELD" |
      "READY_TO_PUBLISH" | "BOARD_ANOMALY" | "PUBLIC_LIVE" | "PUBLISHED_NOT_PUBLIC",
    observed_state: string | null,
    primary_reason_code: PublicationReasonCode,
    reason_codes: PublicationReasonCode[],
    reason_details: object,
    observed_revision: { submission_updated_at, agenda_updated_at } | null,
    expected_revision: { submission_updated_at, agenda_updated_at } | null
  }],
  counts: {
    unknown_id, foreign_event, wrong_kind, stale_selection,
    accepted_unscheduled, unscheduled_withheld, existing_item_malformed,
    existing_item_withheld, ready_to_publish, board_anomaly,
    public_live, published_not_public
  },
  all_or_nothing: true
}
```

The review response carries each row's revisions; the batch request echoes them in `expected_revisions`. A changed revision, changed status/slot, or a failed write CAS emits `STALE_SELECTION` for that ID with the observed revision and one `observed_state` from the partition below. The explainer must explicitly emit, rather than collapse into a generic 409, the following selected-ID cases:

- already-published: `Published_e` is true, including a stale submission mirror;
- wrong-kind: the submission exists in the requested lookup but `submission.kind ≠ 'session'`;
- foreign-event: the row exists but its event differs from the requested event;
- stale: the expected revision no longer equals the authoritative revision;
- malformed: `ExistingItemMalformed_e`, with `reason_details` naming missing/invalid time, duration, room, foreign room, or multiple matching items;
- missing/foreign rows: `UNKNOWN_ID`, `MISSING_AGENDA_ITEM`, or `FOREIGN_ROOM` as appropriate.

Each selected ID receives exactly one top-level `classification`: `UNKNOWN_ID`, `FOREIGN_EVENT`, `WRONG_KIND`, `STALE_SELECTION`, or exactly one of the eight state-bucket names in the set partition (`ACCEPTED_UNSCHEDULED`, `UNSCHEDULED_WITHHELD`, `EXISTING_ITEM_MALFORMED`, `EXISTING_ITEM_WITHHELD`, `READY_TO_PUBLISH`, `BOARD_ANOMALY`, `PUBLIC_LIVE`, `PUBLISHED_NOT_PUBLIC`). A stale result carries the observed bucket separately and does not also claim a second top-level classification. `reason_codes` may carry the true detail facts (for example `ALREADY_PUBLISHED` plus `POST_PUBLISH_REVERSED`), but the bucket and its primary explanation are exhaustive and non-overlapping. No selected ID may be silently absent from `rows`.

The agenda batch endpoint must return the full explainer rows for every selected ID that is not `READY_TO_PUBLISH`. Any such row causes one structured conflict and zero writes, zero cache purge, and zero audit rows. The selected-ID set is never narrowed to the publishable subset. Duplicate IDs are a request error for the agenda publish endpoint, not a silent skip. This preserves all-or-nothing semantics while making every withheld reason inspectable.

### 3. Exact no-op and idempotency matrix

All admitted mutation envelopes carry an `operation` object. Its exact shape is:

```text
operation: {
  operation_id: ULID,
  effect: "changed" | "no_op",
  reason_code: PublicationReasonCode | NoOpReasonCode | null,
  notice: string | null,
  duplicate_skipped: integer
}
```

No-op responses must carry a non-null reason code and notice. Pre-admission schema errors, malformed explicit selectors, authentication errors, omitted selectors, `{}`, and present empty selector arrays are rejected before admission with the existing error envelope and no `operation`/`operation_id`; they never fall back to all recipients. A syntactically valid selector or audience is admitted before recipient resolution when the request reaches a mutation route, including a zero-row result, so a keyed request has a durable operation record and a replayable operation envelope even when `outbox_ids` is empty. An admitted all-or-nothing conflict may carry `operation.effect = "no_op"` and its operation ID so the caller can correlate the refusal. Define the closed `NoOpReasonCode` set as `EMPTY_SELECTION`, `ALREADY_IN_STATE`, `ALREADY_PUBLISHED`, `NO_DECISIONS_REMAIN`, `NO_VALID_RECIPIENT`, `DUPLICATE_SKIPPED`, and `ALL_FAILED`.

| Endpoint and no-op case | Exact status/envelope | Effect and notice | Cache | Audit | Operation ID | Duplicate skip | Idempotency / empty semantics |
|---|---|---|---|---|---|---|---|
| `POST /api/v1/events/{eventId}/submissions/{submissionId}/publish`; agenda row already published | `200`; existing record payload plus `operation` | `no_op`, `ALREADY_PUBLISHED`, `Already live — nothing changed` | No public-cache purge | No row | Fresh ULID per admitted request | `0` | No request idempotency key; repeat is state-aware and remains a no-op, with a new operation ID. Ineligible/malformed rows use the selected-ID explainer conflict. |
| `POST /api/v1/events/{eventId}/agenda/publish`; any selected ID is already published, foreign, wrong-kind, stale, or malformed | `409`; existing conflict envelope plus `operation` and complete explainer `rows`; explicit duplicate IDs are `422` with no operation | `no_op`; all-or-nothing notice names the first/aggregate reason, e.g. `all N scheduled sessions are already live` | No purge on conflict | No rows | Fresh ULID for the admitted conflict; no ID for 422 | Never silently skipped | No request idempotency key; repeat re-explains current facts. `submission_ids` is required and non-empty; empty never means all. |
| `POST /api/v1/events/{eventId}/submissions/bulk`; filter resolves to zero, every unique ID is already in the requested decision state, or the non-empty selection is all-failed | Filter-empty: `404` standard error `empty_selection`; all-already-state: `200` existing `bulkResult` plus `operation`; all-failed: exact `409` envelope in §3b | Empty is refused with `that selection resolves to nobody in this conference`; all-already-state is `no_op`, `ALREADY_IN_STATE`, `nothing changed — every selected record is already {state}`; all-failed is `no_op`, `ALL_FAILED`, with first failure/counts | No purge | No decision rows for no-op; one request-operation audit row | No ID for pre-admission 404; fresh or replayed ULID for admitted results | First-seen ID de-duplication is reported in `duplicate_skipped`; no duplicate is applied twice | No implicit all. `selector.ids: []` is `400` and filter-zero is `404`; an optional `Idempotency-Key` uses the durable request-operation registry for admitted zero/all-failed outcomes: identical replay is byte-identical, changed fingerprint is `409 key-conflict`, and an unkeyed repeat is fresh. |
| `POST /api/v1/events/{eventId}/submissions/not-notified/notify`; no eligible decision remains, or all candidates lack valid addresses | `409` admitted no-candidate response, or `202` existing summary when candidates are all address-excluded; both include `operation` | `no_op`, `NO_DECISIONS_REMAIN` / `NO_VALID_RECIPIENT`, with an explicit notice; never `0` as success-only prose | No cache | No rows | Fresh ULID for each admitted no-op | Server-side ID set is de-duplicated; report `duplicate_skipped: 0` because callers do not supply a selector | No request idempotency key; `cursor` is pagination only. Empty server result means no matching decisions, never all decisions. |
| `POST /api/v1/events/{eventId}/comms/send`; actual conference selector dimensions and all duplicate/skipped cases | Exact statuses, envelopes, operation IDs, notices, queue/audit effects, and duplicate accounting are bound in §3a below; no generic `ids` selector is valid | See §3a | See §3a | See §3a | See §3a | See §3a | Omitted selector, `{}`, every present empty array, and implicit-all behavior are all explicitly refused in §3a. |
| `POST /api/v1/org/comms/send`; actual org audience dimensions and all duplicate/skipped cases | Exact statuses, envelopes, operation IDs, notices, queue/audit effects, and duplicate accounting are bound in §3a below | See §3a | See §3a | See §3a | See §3a | See §3a | Omitted audience, `{}`, and implicit-all behavior are all explicitly refused in §3a. |
| `POST /api/v1/events/{eventId}/submissions/{submissionId}/decision/resend`; no current accepted/rejected decision or no valid speaker address | No decision: `409` existing conflict error; invalid address: `422` existing validation error; no `operation`/`operation_id` | Refusal names the exact reason; never a successful zero-count envelope | No cache | No rows | None because the request is rejected before admission | Always `0` | This route is deliberately non-idempotent: valid resend is `202` with a fresh operation ID and fresh outbox ID every time; no duplicate skip and no `Idempotency-Key` replay. An empty decision set is a refusal, never a broadcast. |

For every row above, a true effect uses the existing write/audit/cache/queue semantics and an `operation.effect = "changed"`; only the no-op branches are prohibited from creating a hidden write or cache churn. Tests must assert status, complete envelope, operation ID presence/absence, effect, notice, cache calls, audit count, outbox count, duplicate count, and repeat-request behavior—not just a numeric `0`.

### 3a. Actual conference and organization communication selector contract

The conference send route uses the real `reminderSelectorSchema`; it does not use a generic `ids` field and it must remove the current default `{}`. The accepted selector dimensions are:

```text
selector = {
  status?: string,
  track_id?: string,
  format_id?: string,
  task_state?: "open" | "done",
  role?: "speaker" | "co_speaker" | "moderator" | "chairperson" | "submitter" | "sponsor_contact",
  submission_ids?: string[1..500],
  person_ids?: string[1..500],
  recipient_pairs?: { person_id: string, submission_id: string | null }[1..500]
}
```

At least one dimension must be present and valid. `submission_ids`, `person_ids`, and `recipient_pairs` are the exact-set dimensions; the other five are the server-side filter dimensions. The parser rejects an omitted `selector`, `selector: {}`, every present empty array (including an empty array alongside another dimension), and empty dimension values. None of these requests gets an `operation_id`, queues mail, writes audit, or resolves to all conference recipients. A selector containing only a filter dimension is explicit and may resolve to a non-empty conference audience; filter-zero is not an implicit all.

The organization send route uses the real `audienceSchema` and has no `selector` wrapper:

```text
audience = {
  person_ids?: string[1..500],
  list_id?: string
}
```

Exactly one dimension is required: `person_ids` or `list_id`. Omitted audience fields, `{}`, `person_ids: []`, and an empty `list_id` are `400` validation errors with no operation, queue, audit, or implicit-all fallback. Organization filters are not silently invented; `list_id` is the only saved-filter dimension on this endpoint.

The two routes use the following exact outcome rules. Every response uses the existing route payload plus the binding `operation` object and adds `duplicate_skipped` for input de-duplication; `duplicate` remains the count of resolved recipient rows rejected by the outbox idempotency registry. `selected` counts unique resolved recipients, `queued` counts newly inserted outbox rows, and `outbox_ids` contains only newly inserted rows.

| Selector case | Conference `/events/{eventId}/comms/send` | Organization `/org/comms/send` | Operation/notice/side effects |
|---|---|---|---|
| Omitted selector/audience or `{}` | `400` error code `selector_required` / `selector_dimension_required` | `400` error `audience_dimension_required` | No operation ID; queue `0`; audit `0`; no duplicate count; never implicit all. |
| Any present empty array | `400` `empty_selector_dimension` for empty `submission_ids`, `person_ids`, or `recipient_pairs` | `400` schema error for empty `person_ids` | No operation ID; queue `0`; audit `0`; no implicit all. |
| Duplicate input values | Dedupe `submission_ids` and `person_ids` by first appearance; dedupe `recipient_pairs` by `(person_id, submission_id)` including `null` | Dedupe `person_ids` by first appearance | `duplicate_skipped` reports only input duplicates; `selected` uses the unique resolved audience; no duplicate input is queued twice or audited twice. |
| Unknown/foreign IDs or pairs | Unknown submission/person/pair is a skipped row with its selector dimension and reason; if no valid recipient remains, `404` `empty_selection` | Unknown or out-of-org person is a skipped row; if no valid person remains, `404` `empty_selection` | A syntactically valid request with an `Idempotency-Key` is admitted before resolution: the `404` includes its `operation` (`NO_VALID_RECIPIENT`, `queued: 0`, `outbox_ids: []`) and is replayed byte-for-byte; the request-operation audit row is the only audit. Without a key, preserve the fresh `404` with no replay claim. Mixed known/unknown sends only known rows and names every skipped row; no ID is treated as an implicit filter. |
| Filter-zero | A valid `status`, `track_id`, `format_id`, `task_state`, or `role` filter resolving zero is `404` `filter_zero` | A `list_id` resolving to no in-org people is `404` `filter_zero` | With a key, the valid zero-row request is admitted before resolution and returns/stores an operation with `NO_VALID_RECIPIENT`, queue `0`, audit `1` request-operation row, and no recipient/outbox rows; without a key, no replay claim is made. Notice states that the explicit selection resolves to nobody. |
| Duplicate-only after resolution | `202` existing `sendResponse` plus `operation = { effect: no_op, reason_code: DUPLICATE_SKIPPED, notice: "all selected messages were already queued", duplicate_skipped, duplicate: selected, queued: 0, outbox_ids: [] }` | `202` existing org envelope plus the same operation semantics; `excluded_people` remains the do-not-contact list | Fresh operation ID on first admitted request; queue `0`; audit `0`; duplicate accounting is exact and not reported as a send. |
| Non-empty mixed result | `202`; queue/audit only newly inserted rows; skipped rows and both duplicate counters are returned | `202`; queue only newly inserted rows; `excluded_people`, skipped people, and both duplicate counters are returned | `operation.effect = changed` when `queued > 0`; no-op only when `queued = 0`. |
| Repeated request with the same `Idempotency-Key` and byte-identical compose/selector | Replay of the original status and envelope, operation ID, and outbox IDs, including a stored zero-row response | Same | Queue `0`; no new recipient audit or duplicate rows. A reused key with a different subject/body/template or canonical selector is `409` `key-conflict`; no new operation/queue/recipient-audit row. The durable claim/recovery algorithm is §3c. |
| Repeated request without an `Idempotency-Key` | Each ad-hoc compose is a new nudge with a new operation ID; registry outcomes still populate `duplicate` where its business key says duplicate | Same | No claim of idempotency; duplicate-only remains a reasoned `202`, never silent success. |

The canonical selector must be included in the idempotency fingerprint after first-seen de-duplication and stable sorting. `recipient_pairs` must never be expanded into independent person or submission filters: the pair relationship is the selected unit. For all send forms, omitted and `{}` are invalid, every present empty array is invalid, and no code path may interpret them as “all recipients.”

### 3b. Exact non-empty all-failed bulk-decision contract

`POST /api/v1/events/{eventId}/submissions/bulk` must distinguish a non-empty admitted selection whose every unique selected ID is refused from a filter that was empty before admission. The selector is still the exclusive `ids`/`filter` union; `selector.ids` must be non-empty, and a filter selection that resolves to a non-empty ID set is admitted. Input duplicates are first-seen de-duplicated and counted in `duplicate_skipped`; unknown IDs are not silently dropped. A non-empty selection is **all-failed** when `succeeded = 0` and `failed = selected_unique > 0`.

The closed per-record failure-code set for this result is:

```text
UNKNOWN_ID       -- no row in the requested event
FOREIGN_EVENT    -- the ID exists outside the requested event
ILLEGAL_DECISION -- the requested action is not legal for the current row
LIVE_REFUSED     -- a published/live row refuses the decision without confirmation
ALREADY_IN_STATE -- the target state is already authoritative
STALE_SELECTION  -- the row revision changed after selection
NO_VALID_ADDRESS -- the requested decision cannot notify this row
```

For every all-failed non-empty selection the exact HTTP and envelope contract is `409` with this top-level shape (the existing `bulkResult` fields are retained and the new `operation` object is mandatory):

```text
{
  operation_id: ULID,
  selected: N,
  succeeded: 0,
  failed: N,
  state: "completed_with_failures",
  outbox_enqueued: 0,
  published_count: P,
  first_failure: { id: string, code: BulkDecisionFailureCode, message: string },
  failures: [{ id: string, code: BulkDecisionFailureCode, message: string }],
  results: [{ id, outcome: "failed", resulting_status: null, error }],
  operation: {
    operation_id: same ULID,
    effect: "no_op",
    reason_code: "ALL_FAILED",
    notice: "Nothing changed — all N selected records were refused",
    duplicate_skipped: D
  }
}
```

`first_failure` is always present and is the first failure in stable first-seen selection order. `failures` contains the bounded recorded failure list, while `failed` counts every failed unique selection; explicit-ID requests include every bounded `results` row and filter-wide requests retain the existing bounded-result rule but still expose the first failure and exact counts. `P` is the count of live/published rows refused, not a mutation count. Unknown, foreign-event, illegal-decision, already-in-state, stale, no-address, and live-refused cases all use their specific codes above; none is collapsed into a generic success or silently removed from the attempted set.

The all-failed side-effect ledger is binding: `public_cache_purges = 0`, `decision_audit_rows = 0`, `mail_queued = 0`, `outbox_enqueued = 0`, and no decision transition is written. Exactly one request-operation audit row is retained with the canonical request, `operation_id`, `ALL_FAILED`, `selected/succeeded/failed/duplicate_skipped` counts, the first/recorded failures, and the exact response; replaying it does not create another audit row. Input duplicates are counted only in `duplicate_skipped`; no duplicate is applied or queued. A mixed selection remains the existing `200 completed_with_failures` changed-effect path and reports its successes and failures separately.

The bulk route accepts `Idempotency-Key` under the same request-operation registry as communications. A byte-identical repeat of an all-failed request replays the original `409` status, complete envelope, operation ID, failure list, counts, and empty outbox list with zero writes. A changed action, feedback, wave, confirmation flag, or canonical selector under the same scoped key is `409` `key-conflict` with no mutation. A repeat without a key is a fresh evaluation with a fresh operation ID; if state is unchanged it produces the same `ALL_FAILED` effect but is not claimed as byte-identical replay. A crash or stale in-flight claim follows §3c and cannot queue a second copy.

### 3c. Durable request-operation storage, claim algorithm, and lifecycle impact

Cycle 4 replaces the prior no-migration wording with one draft schema seam. The implementation must add an unnumbered planning migration, re-numbered only after a fresh `github/main` recheck, such as `NNNN_request_operations.sql`, containing:

```text
request_operations(
  operation_id TEXT PRIMARY KEY,              -- ULID
  organization_id TEXT NOT NULL,
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('org', 'event')),
  scope_id TEXT NOT NULL,                     -- org id for org routes, event id for event routes
  route TEXT NOT NULL,                        -- e.g. org.comms.send, events.comms.send, submissions.bulk
  idempotency_key TEXT NULL,
  canonical_fingerprint TEXT NOT NULL,       -- SHA-256 of canonical selector/compose/request data
  canonical_request_json TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('in_flight', 'completed', 'failed')),
  response_status INTEGER NULL,
  response_headers_json TEXT NULL,
  response_json TEXT NULL,                    -- exact serialized response envelope
  outbox_ids_json TEXT NOT NULL DEFAULT '[]',
  claim_token TEXT NULL,
  lease_expires_at INTEGER NULL,
  attempt_count INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER NULL
)

UNIQUE INDEX request_operations_scoped_key
  ON request_operations(organization_id, scope_kind, scope_id, route, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

request_operation_outbox(
  operation_id TEXT NOT NULL REFERENCES request_operations(operation_id) ON DELETE CASCADE,
  outbox_id TEXT NOT NULL,                     -- retained as audit text even if outbox cleanup removes the row
  ordinal INTEGER NOT NULL,
  PRIMARY KEY (operation_id, outbox_id),
  UNIQUE (operation_id, ordinal)
)
```

The unique key is therefore exactly organization + org/event scope + route + `Idempotency-Key`; an event key cannot collide with an org key or with the same key on a different route. The registry row is created for every admitted mutation, keyed or unkeyed, so zero-row operations have a durable `operation_id`; only keyed rows participate in replay. The canonical request includes the route/scope, action or template, every compose field that changes the message (subject, body, template, attachments/options), and the normalized selector/audience. Selector arrays are first-seen de-duplicated, then sorted by their semantic keys; `recipient_pairs` sort and fingerprint as pairs and are never expanded. The stored canonical JSON and SHA-256 fingerprint are the comparison authority.

The request algorithm is binding and claim-before-send:

1. Validate authentication and syntax. Invalid/omitted/empty selectors fail before admission and create no row. For a valid mutation, compute the canonical JSON/fingerprint and insert an `in_flight` row with a new ULID before resolving recipients or touching the outbox. A uniqueness race selects the existing scoped row instead.
2. On an existing keyed row, compare fingerprints before any effect. A mismatch returns `409` `key-conflict` and creates no new operation, audit, queue, or cache effect. A `completed`/`failed` row with the same fingerprint replays its stored status, headers/envelope, operation ID, and exact `outbox_ids_json` byte-for-byte, including `[]` for zero-row/no-op responses.
3. A fresh or atomically reclaimed claim resolves the selector, writes the request-operation audit state, and inserts/link outbox rows in one transaction. The link table records exact IDs and ordinals; only newly inserted outbox rows enter `outbox_ids_json`. Duplicate/skipped rows are counted in the stored response, never inferred from a later outbox query.
4. Before any queue dispatch, persist the final response status, headers, envelope, outbox IDs, counts, and `state = completed` under the claim token. Replays after this point do not send, audit, or purge again. A deterministic admitted refusal, including a zero-row response or all-failed bulk decision, is stored the same way with `outbox_ids_json = []`.
5. If the worker crashes while `in_flight`, a caller seeing a live lease receives `409` `operation_in_flight` with the original operation ID and retry guidance, with no new effect. After `lease_expires_at`, a compare-and-swap claim changes the token/lease and increments `attempt_count`; recovery first reads linked outbox rows, finalizes a response if the work already completed, and otherwise inserts only missing recipient rows before persisting completion. A stale worker's token cannot finalize or dispatch after losing its claim. This covers crashes before resolution, after partial outbox insertion, and before response persistence without double-send.

Schema/lifecycle impact is explicit. The migration adds the two tables, the scoped-key and operation-created indexes, and the foreign keys needed for event/org scope validation; no stable migration number is written in this plan. `reset:demo` deletes request-operation and link rows for the reset organization/event in the same reset transaction as the existing demo outbox/communication/audit cleanup, so a reset intentionally permits a fresh key. Event or organization deletion cascades the request-operation and link rows; there is no per-request delete API and no automatic TTL deletion in this ticket. Outbox cleanup is independent: the request audit retains the exact historical outbox IDs even if an old outbox row is later purged. The request-operation row is the one durable audit record for a keyed or unkeyed admitted zero-row/no-op; existing per-recipient communication/decision audit rows are written only for actual newly applied/queued effects. Replays and key conflicts add none. The migration, reset, delete, and audit behavior must be covered in targeted non-browser proof and folded by the Adoption Orchestrator into `SPEC.md`, `EVALUATION.md`, `sequence/USER_STORIES.md`, and claims only after `MRQ-244` and explicit `CONSOLIDATION RESUME`.

## Plan-Review Cycle 3 Resolutions (AUTHORITATIVE)

**Review artifact:** `art_01M055Q3ND00BCZ0P3RB7W9RKP` at exact head `2352d134fe20441744a7ef148edf75f0be97b366`.

This Cycle 4 amendment closes all three Cycle 3 blockers without opening implementation. It binds the durable `request_operations`/`request_operation_outbox` seam and claim/replay/recovery algorithm in §3c, including zero-row responses, schema migration impact, reset/delete behavior, and request-versus-recipient audit accounting. It binds `not_yet_public` and `live_on_site` as first-class `submissionFilterSchema`/`submissionStatusPredicate` values with exact `kind=session` URLs and shared classification SQL, and records the deliberate truthful-set divergence as `SPEC-MRQ-237-PUBLICATION-GAUGES` beside `SPEC-MRQ-237-PUBLIC-PRIVACY`. It binds the non-empty all-failed bulk-decision `409` envelope, `ALL_FAILED` reason, failure codes/counts, zero-effect ledger, and keyed replay in §3b. The signed v1.17 geometry, six zero-state gauges, warning-chip treatment, privacy boundary, exhaustive Cycle 3 set algebra, actual conference/org selector matrix, trace prefix, browser N/A, no stable IDs, and post-MRQ-244 Adoption Orchestrator fold destination remain in force. The prior Cycle 2 no-migration posture is superseded only for this explicit durable request-operation schema; the real migration number remains unminted and must be re-derived at implementation and rebase.

## Plan-Review Cycle 2 Resolutions (AUTHORITATIVE)

**Review artifact:** `art_01M054BTBP96CHT4TPAANVZQPN` at exact head `a76264aacc0cbb8d96682b49c39b91da86477012`.

This Cycle 3 amendment resolved the algebra and communication-selector blockers. The event-scoped submission partition above remains the only source for readiness, diagnostics, gauges, anomaly/public projections, and selected-ID explanations; the actual conference/org schemas and every empty/duplicate/idempotent send case remain bound in §3a. Cycle 4 adds only the durable request-operation, exact gauge-filter, and all-failed bulk-decision resolutions in §§3b–3c. No feature code, contract-file edit, stable US/AC number, browser proof, gate, or live side effect is authorized.

The cleared Cycle 2 decisions remain unchanged and binding: v1.17 six-gauge/seven-stage geometry and exact clickthroughs; public privacy exclusion with the explicit `SPEC-MRQ-237-PUBLIC-PRIVACY` marker; retained published-column anomalies and warning chips; `CONTRACT · MRQ-237 ...` trace names; browser/computer validation `N/A — approval not granted`; and no stable migration number until implementation/rebase re-derives the slot. Cycle 4's explicit request-operation schema is the sole exception to the prior no-migration posture. The Adoption Orchestrator still owns the post-MRQ-244 consolidation fold, and stable claims remain held until explicit `CONSOLIDATION RESUME`.

### 4. Post-resume contract fold owner and destination

The **Adoption Orchestrator** (`agent:adoption-orchestrator`) owns the one post-resume contract fold. It happens only after the established shared queue has completed `MRQ-242 → MRQ-241 → MRQ-234 → MRQ-244` and the operator has explicitly issued `CONSOLIDATION RESUME`; MRQ-244 is the release point. The delegator owns no contract-file edits in that fold.

The orchestrator's single fold must land the resolved publication truth, reason-code algebra, no-op matrix, cleared design decisions, and validation obligations into exactly these destinations:

- `SPEC.md`, including the publication predicate, reason-code/zero-effect craft rule, all-or-nothing and anomaly-retention behavior;
- `EVALUATION.md`, including the six-gauge, exact-filter, selected-ID explainer, no-op, and anomaly proof obligations;
- `sequence/USER_STORIES.md`, with the consolidated organizer stories and only then-minted stable US/AC lineage;
- `tests/ac-claims/MRQ-237.json` (or the established claims destination selected by the orchestrator's next-mint check), with stable claims minted only during that consolidation pass.

The orchestrator records the fold owner, destination paths, next-mint decision, and resulting claim IDs in the MRQ-237 Lattice comment/artifact. Until that explicit resume, this plan and `CONTRACT · MRQ-237 ...` tests may use draft labels only; no stable number is reserved or minted by this ticket.

### 5. Cleared decisions carried forward unchanged

- **Geometry:** reproduce v1.17's seven-stage strip, six always-rendered gauges, zero-state boxes, exact filtered-set clickthroughs, and warning-chip geometry one-to-one; no layout reinterpretation.
- **Privacy:** rejected/withdrawn rows remain excluded from attendee/public projection; organizer/admin surfaces retain the published anomaly. Keep `SPEC-MRQ-237-PUBLIC-PRIVACY` as the explicit marker.
- **Board:** a published row never vanishes after reversal; retain the published column and render `Withdrawn after publish` / `Rejected after publish` warning chips.
- **Trace:** targeted test names keep the `CONTRACT · MRQ-237 ...` prefix; claims remain held for consolidation.
- **Browser:** browser/computer-use validation remains `N/A — approval not granted`; no approval is inferred from the plan review.
- **Migration:** Cycle 4 authorizes only the unnumbered draft `NNNN_request_operations.sql` and its operation-to-outbox link schema for durable request replay; recheck the current migration number at implementation and after rebase, and never assume `0029`.

## Reset 2026-08-16 by agent:delegator-mrq-237

## Reset 2026-08-16 by agent:delegator-mrq-237

## Reset 2026-08-16 by agent:delegator-mrq-237
