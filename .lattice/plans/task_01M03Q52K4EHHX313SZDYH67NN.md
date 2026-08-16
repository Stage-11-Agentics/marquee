# MRQ-233 authoritative and branch plan

## Head, scope, and lifecycle boundary

- Ticket: MRQ-233, actor `agent:delegator-mrq-233`.
- Worktree: `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-233-calendar-strip`.
- Branch: `mrq-233-calendar-strip`.
- Cycle 1 plan head reviewed by artifact `art_01M051M9NCBV1RPNE59M73DC77`: `77fa3a12`; its verified base was `github/main@52bb485f105e0392fe475332b87cbb48dbcee832`. This amendment is plan-only and will be the next branch head.
- This plan is the authoritative branch plan. The first commit is this plan, pushed to `github`; implementation commits follow. No merge or deploy is in scope. Stop at `pr_open` for Merge Captain.
- No contract-document edits, claims manifest, stable US numbers, or stable AC numbers are permitted here. Contract fold and claims remain behind the shared order MRQ-242, then MRQ-241, then MRQ-234, then MRQ-244, followed by explicit `CONSOLIDATION RESUME`.

## Ground truth inspected before planning

The signed design source is prototype `prototypes/pipeline-v1.1/index.html` at commit `390d52dc` (v1.17). The signed Lattice comment says the build must reproduce the calendar strip, batch modal, dashboard fifth debt row, named blocked recipients, snapshot-based staleness, event timezone preview, and timeline/record lineage one-to-one. The prototype’s binding details are:

- Agenda publication area always renders two gauges. Calendar copy is `N current · M unsent updates · K never invited`; counts use tabular numerals; the action has fixed width `190px`; the zero state remains rendered and disabled.
- The modal is headed `Calendar · one batch` / `Make every speaker’s calendar match the agenda?`; it explains that several moves fold to one email per speaker; it shows one row per speaker with `same UID, SEQUENCE+1` or `SEQUENCE 0`, a named blocked-recipient explanation, and a brand-voice preview with old→new time/room and event timezone. The action is `Send to N speakers` and a no-op says calendars already match rather than pretending a send occurred.
- The dashboard attention strip has an always-present fifth row, `N unsent schedule updates`, linking to the agenda builder and holding at zero when there is no debt.
- The production seams are `migrations/0026_calendar_truth.sql`, `src/jobs/calendar/{invites,ics,limits}.ts`, `src/jobs/mail/{idempotency,outbox,consumer}.ts`, `src/routes/{calendar-invites,agenda,submission-record,submission-reversal,submission-cascade}.routes.ts`, `src/routes/agenda.queries.ts`, `src/api/agenda.ts`, `src/ui/{agenda, dashboard, submissions, health}`, `src/lib/{audit,history,activity-copy,delivery-health}.ts`, and their existing calendar/agenda/delivery tests.
- MRQ-228 is landed and supplies `calendar_invites.request_snapshot`, `calendar_sequence_ledger`, and durable cancellation material. The existing `sendCalendarInvites` path currently reads invite and ledger state once per recipient, always emits a new REQUEST on explicit POST, has no staleness comparison, and has no batch UI caller. The current `calendar_invites`/ledger schema and outbox registry are therefore treated as the hard seam, not replaced with a parallel calendar authority.
- The current migration maximum at planning time is `0028_participant_fanout.sql`. This is an observation only: recheck the migration directory at implementation start and again after rebase; choose the next free slot then, or avoid a migration if the final design needs none.

Cycle 1 review found three load-bearing design gaps and one prototype mismatch. This amendment closes them as binding decisions rather than leaving implementation options open. No source code is being changed in this cycle.

## Why this is one ticket

This is one vertical lifecycle seam: agenda slot truth → calendar-debt projection → one batched provider send → durable per-UID ICS parts/sequence → submission history and operator surfaces. The migration, consumer, API, UI, audit, health, and proof work are coupled by that one producer and by the signed one-batch-per-speaker interaction. Splitting the pieces would leave a signed surface claiming a send with no durable transport or leave transport without a truthful debt count. The scope remains limited to schedule-update/first-invite calendar reconciliation and its existing per-session action; it does not add new speaker workflow, publication semantics, or contract minting.

## Cycle 1 amendment decisions

### Transport and durable schema

- A batch is one provider email per sendable speaker with N separate one-VEVENT `METHOD:REQUEST` `.ics` attachments. It never emits one multi-UID `METHOD:REQUEST` object. Every attachment preserves its own UID, sequence, attendee, organizer, timezone, location/GEO, and stable links.
- Recheck the migration directory only at implementation start and after rebase. Then add the next free migration with an `outbox_calendar_parts` child table for batch messages, ordered by `part_index`, carrying `outbox_id`, `submission_id`, `ics_uid`, filename, ICS body, content type, and created/updated timestamps. The child mapping is durable and is the explicit outbox-to-N-submissions audit map. Existing per-session messages remain on legacy singular `outbox.ics_uid`/`outbox.ics_body` for compatibility; a batch row uses the child parts as its canonical attachments.
- Update the schema mirror/types and any schema-delta checks for the child table; add migration coverage. Update event deletion and demo reset cleanup so child parts cannot outlive their batch outbox row. `GET /i/:uid.ics` resolves the newest matching child part first, with legacy singular outbox fallback. Batch text/HTML renders one stable `/i/:uid.ics` link per covered session.
- The mail consumer bulk-loads all child parts for the claimed outbox rows and makes exactly one provider call for each speaker batch. It sends N attachments in that call, retains the existing singular path for legacy/per-session rows, and requeues the same outbox identity on a recoverable retry rather than creating another provider send.

### Materiality and route policy

- The batch debt projection is slot-only. Its explicit allowlist is `starts_at`, `duration_min`, room/location, and timezone. It excludes title, abstract/description, attendee name, URL/origin, organizer, geo, and every other snapshot field. Origin and organizer inputs are pinned to the existing canonical values so they cannot manufacture debt.
- The existing per-session record action keeps the current explicit-resend contract and always claims a new sequence, even when material is unchanged. This is deliberate and must remain compatible with the shipped AC-319 wording and test: **“Explicit re-POSTs intentionally bump sequence; no materiality comparison is asserted.”** The batch action is debt-gated and is the only no-op/materiality gate. They share snapshot rendering, CAS claiming, outbox admission, and retry mechanics, but not trigger policy.
- Preserve the existing `smoke:ics` repeated-POST axis and its AC-319 sequence assertions. Add a separate smoke axis that moves an agenda item, reads the resulting batch debt, and sends the batch; do not silently convert the existing repeated-POST scenario into a no-op test.

### Sequence, blocked recipients, geometry, and audit

- Sequence claiming is a real compare-and-swap: conditionally update the expected prior `last_sequence`, require `meta.changes === 1`, reread/retry on loss, and initialize an absent ledger row with an insert-or-ignore plus retry. A losing claim cannot double-claim a sequence.
- Stamp `request_snapshot` only after the exact outbox batch and all child parts are durably admitted, or after resuming a legitimate identical admission. A losing claim, failed admission, or duplicate identity must never advance the stamped snapshot. Conditional invite updates must not let an older concurrent claim overwrite a newer admitted sequence/material.
- The debt query selects participations before any `validEmail` filtering and classifies invalid/missing addresses as named blocked output. `recipientsFor` remains a sendable-recipient helper, never the truth source for blocked-row counts.
- Keep the signed dashboard `.attention-strip` three-column grid. The calendar row always renders, including zero, and the fifth row wraps in the prototype’s 3+2 layout; it does not become five columns. At the breakpoint it collapses to one column. This remains true when conditional `next_wave` or `unreviewed_track` items are absent.
- A successful provider send writes one audit/timeline row per covered submission, with shared batch/outbox identity and that part’s UID/sequence. The child `submission_id` is the mapping; a batch covering three sessions produces three timeline rows that make the one-email/shared-batch fact legible.

## Implementation sequence

### 1. Reconfirm the branch and migration slot

Before source edits, verify the worktree root, branch, clean owned state, `HEAD`, `github/main`, and `git merge-base --is-ancestor github/main HEAD` after a successful fetch. Re-read the migration directory and any new upstream migration; never reserve or reuse a stale number. Preserve unrelated `.lattice` state and stage only owned paths.

### 2. Make calendar truth one reusable projection

Create one calendar-debt projection used by agenda API/UI, dashboard attention, record action, and delivery-health copy. Its source is a single bounded event query over scheduled non-break sessions, all calendar-role participations, people, rooms/buildings, and `calendar_invites`; it must select participations before email validation and must not issue a query per session, recipient, or speaker.

For every scheduled session/person row, derive a slot material from the same snapshot builder used by ICS, restricted to the binding allowlist `starts_at`, `duration_min`, room/location, and timezone. Pin canonical origin and organizer inputs; never compare URL/origin, organizer, attendee name, title, abstract/description, geo, or other non-slot fields. Compare the slot material with the stamped delivered/admitted REQUEST snapshot. Classify rows as current, unsent update, or never invited using the existing invite status/method and durable snapshot semantics. Keep complete row-level evidence for the batch planner so the preview and send use the same answer. Invalid/missing addresses are named blocked output, excluded from sendable counts, and never silently dropped by `recipientsFor`.

The projection must distinguish no invite; first invite; same slot after a no-op edit; material time change; material room/location change; title/description-only change (not batch debt); origin/organizer/attendee/geo-only change (not batch debt); multiple moved sessions for one speaker; cancelled/removed invite state; invalid address; and an already-admitted identical batch retry. The batch materiality rule is centralized and tested; the explicit per-session route deliberately bypasses that trigger gate per AC-319.

### 3. Extend the calendar producer to one batched email per speaker

Refactor the calendar job around a batch planner/producer while preserving the existing one-submission route as a per-session entry point:

- Load all eligible rows and all relevant sequence-ledger floors in bulk. Do not retain the existing per-recipient SELECT/ledger N+1 in the MRQ-233 batch path.
- Group sendable material by person. One person gets one outbox message and one provider call, containing one separate one-VEVENT `METHOD:REQUEST` attachment per affected session. A speaker moved several sessions receives one email, not one message per row and never one multi-UID REQUEST. First invites use sequence 0; material updates use the next sequence after the invite row and ledger floor.
- Add the migration-backed `outbox_calendar_parts` rows in stable `part_index` order. Each row carries `outbox_id`, `submission_id`, `ics_uid`, filename, ICS body, content type, and timestamps. Existing per-session outbox rows keep singular `ics_uid`/`ics_body`; batch outbox rows use the child parts. Render one stable `/i/:uid.ics` link per covered session, and make the resolver child-first with legacy fallback.
- Extend the ICS/mail builder without changing the existing REQUEST/CANCEL lifecycle: each part has its own UID/SEQUENCE, timezone, organizer, attendee, URL, and exact one-VEVENT body. The batch human-facing mail and preview state was→now time/room from the prior stamped snapshot, with event timezone and Marquee voice.
- Add a batch-grain idempotency-registry builder whose identity is the speaker plus sorted `uid:sequence` set. Retries of an already-admitted identical batch re-admit the same queued outbox/parts when needed and do not claim another sequence, create another provider call, or report a second send.
- Implement a real CAS sequence claim: conditional update against the expected prior `last_sequence`, require `meta.changes === 1`, reread/retry on loss, and insert-or-ignore absent ledger rows followed by retry. Keep sequence ownership in `calendar_sequence_ledger`; do not use MRQ-228’s `MAX` merge as if it were exclusive. Stamp invite snapshots only after exact outbox/part admission, and conditionally prevent an older concurrent admission from overwriting newer material. Chunk D1 writes within its statement limit without per-row reads.
- Return an honest result shape: sent/admitted speakers, first invites, updates, blocked names/reasons, no-op, and retry/admission state. If candidates are only blocked, return a named-reasons error and never say `0 sent`. If there is no batch debt, return an explicit no-op; the record action remains an explicit resend and is not converted to this no-op path.

### 4. Give the batch and per-session actions real homes

Add the authenticated event-scoped batch endpoint behind the existing `program:write` boundary and keep the existing submission invite endpoint as the record-page per-session explicit resend. They share snapshot rendering, CAS claiming, outbox admission, and retry mechanics, but the batch endpoint is slot-debt gated while the existing route preserves AC-319’s always-new explicit re-POST semantics. Add API registry/OpenAPI parity for every new route and test authorization, event/submission ownership, no-op, blocked-only, safe retry, and the unchanged AC-319 repeated-POST axis.

Wire the agenda builder’s `Send N calendar update(s)` action to the batch endpoint and reload the agenda snapshot after success/no-op/error. Add the signed strip beside the existing publication panel with the exact gauge order, copy, zero rendering, fixed button geometry, tabular counts, and batch modal structure from v1.17. Use the production event timezone and named recipients; do not hard-code prototype mock state or silently change wording. Add the fifth dashboard attention item, its agenda link, and retain the signed three-column `.attention-strip` so it wraps 3+2 and collapses to one column at the breakpoint, even when conditional rows are absent. Give the record page’s schedule/calendar area the per-session explicit resend action and truthful result state.

### 5. Close the lifecycle and history seams

- `PATCH /agenda/items/:itemId` and the record-page schedule path must write audit before/after slot material for a move/resize, including the no-op/CAS behavior already owned by those routes. Do not emit calendar work from an audit read; debt must derive from current agenda versus stamped snapshot.
- Record calendar batch/per-session sends with `entity_type = 'submission'` and the real submission id, not the composite outbox entity id. The `outbox_calendar_parts.submission_id` mapping fans one provider send out to one audit/timeline row per covered submission; each row carries shared batch/outbox identity plus that part’s UID/sequence. Update the shared history/activity projection and copy while preserving existing cancel mappings.
- Correct delivery-health copy so it no longer claims that publication automatically sends an invite. Its calendar facts should use the same honest debt definition and continue to distinguish queued/failed delivery from agenda staleness.

### 6. Targeted proof before the gate

Add or extend non-browser tests with unnumbered names/descriptions only. Also author a named Playwright spec for the browser checkpoint, but do not run browser/computer-use validation until explicit operator approval is recorded for the named local surface and flow. Approval is a pending validation checkpoint, not an `N/A` result; all non-browser proof continues meanwhile. Proof must include:

- pure materiality/staleness truth-table coverage, including no-op and title/description policy;
- one event with multiple sessions and one speaker proving one batch message, multiple VEVENTs, per-UID sequence behavior, old→new mail material, event timezone, and exact idempotency key revisions;
- one provider-call assertion proving one speaker batch has N one-VEVENT attachments, ordered child parts, one shared outbox identity, one stable ICS link per session, and no multi-UID REQUEST;
- first invite, material update, repeated identical retry, blocked invalid recipients, blocked-only error, and mixed sendable/blocked result counts;
- concurrent/claim-under-contention and targeted mutation coverage proving CAS loss retries, absent-ledger initialization, losing-claim non-stamping, duplicate-admission non-stamping, no duplicate sequence authority, and no per-row query N+1 path (instrument or assert query shapes/counts at the batch seam);
- schedule → initial send → material move → debt count → batch send → same UID with sequence +1 in child part/outbox → current count, plus a no-op move that creates no new batch revision;
- the unchanged `smoke:ics` repeated-POST path, plus an explicitly named separate move → batch-send reschedule axis; do not claim the live smoke oracle without its required operator/browser approval;
- PATCH agenda audit before/after and submission record timeline entity-id mapping;
- route authorization, API registry/OpenAPI parity, agenda/dashboard/record data contracts, delivery-health copy, migration/schema mirror, reset-demo, event-delete cleanup, and child-part cleanup;
- Playwright assertions for agenda zero/fixed geometry, the blocked-recipient modal rows, dashboard 3-column wrap, and record-page explicit action. The spec is authored now; execution waits for operator approval.

Run focused tests first, then the relevant node/static checks. Do not run browser/computer-use/live writes until the approval checkpoint is satisfied. Do not call the full `pr-gate` until Merge Captain grants a gate slot through `merge-captain`.

## Draft unnumbered criteria (stable IDs deliberately withheld)

- The agenda builder always renders the signed calendar strip with `current`, `unsent updates`, and `never invited` gauges, zero-safe tabular counts, and fixed-width action geometry.
- The dashboard always renders the signed fifth calendar-debt row and routes it to the builder; zero is an honest no-debt state.
- Calendar debt is derived from the current agenda and each delivered/stamped request snapshot using only the explicit slot allowlist, with pinned origin/organizer, no per-row N+1 reads, and no title/content false debt.
- One batch produces exactly one provider email per sendable speaker with ordered child parts and one one-VEVENT REQUEST attachment per affected session; blocked recipients are named and excluded from send counts.
- First invites, material updates, batch no-ops, explicit per-session resends, retries, concurrent claims, and blocked-only batches have honest, durable outcomes; an identical admitted batch never creates another revision or provider call.
- Sequence claims use real CAS on the MRQ-228 durable ledger and remain monotone; a lost claim or duplicate admission never stamps a newer snapshot, and outbox identity preserves the sorted UID/sequence set.
- Calendar email/preview copy states was→now time/room in the event timezone and preserves existing ICS REQUEST/UID/SEQUENCE lifecycle semantics.
- Agenda moves/resizes and record scheduling audit before/after slots; calendar sends appear in the submission timeline under the submission entity id.
- Delivery health no longer promises automatic publication sends and reflects actual calendar debt/failure facts.
- Focused non-browser proof demonstrates the full schedule→send→move→batch-send lifecycle, unchanged AC-319/smoke repeated-POST semantics, all authorization/error/no-op paths, and one-provider-call/N child-part transport.
- The named Playwright spec covers the zero/fixed agenda strip, blocked modal, signed dashboard wrapping, and record action; its run remains blocked only on explicit operator approval.

## Handoffs and status gates

1. This Cycle 1 amendment is plan-only: verify the two authoritative/branch plan copies are byte-identical, stage only the plan path, commit, push, and verify the exact amended branch head against `github/mrq-233-calendar-strip`. Do not implement source code.
2. Hold MRQ-233 in `in_planning` after the amendment. Do not transition back to `planned` or auto-fire Cycle 2 while the sole reviewer slot is occupied by MRQ-237. Report the exact amended head/hash and ask Adoption Orchestrator at c11 `workspace:10` / `surface:513`, mailbox `adoption-orchestrator`, to request fresh Cycle 2 only after MRQ-237 releases that slot.
3. Once `lattice review-status MRQ-233` can run in the released sole slot, transition to `planned` through the orchestrator’s handoff so fresh Cycle 2 reviews this amended plan. Record the new review artifact before any implementation transition.
4. Only after Cycle 2 PASS, transition to `in_progress`; recheck upstream/base and the next migration number at implementation start and after rebase, then implement in small commits and push each durable unit. The post-CONSOLIDATION RESUME step, not this cycle, owns the MRQ-233 SPEC §3.8/§5.11 fold and stable US/AC allocation from the then-current mint (the current observed EVALUATION band is AC-337, but no ID is minted here).
5. After targeted non-browser proof and the approved browser checkpoint if granted, request an exact-head full-gate slot from Merge Captain at c11 `workspace:10` / `surface:512`, mailbox `merge-captain`. Run `npm run pr-gate -- --ticket MRQ-233` only after that slot is granted; attach the exact SHA and status semantics (`pass` or `pass-over-budget` are passing; `timeout`/`fail` are not).
6. Hand the exact pushed head to a non-author reviewer. Require a post-review Lattice artifact with exact head/base, changed paths, findings, and explicit PASS/FAIL. Resolve all findings before PR creation.
7. Open the PR against `github`/`main`, attach gate and review evidence, transition MRQ-233 to `pr_open`, and report completion to Adoption Orchestrator at surface:513/mailbox `adoption-orchestrator`. Stop there: Merge Captain owns merge; deployment/publication are out of scope.

## Reset 2026-08-16 by agent:delegator-mrq-233
