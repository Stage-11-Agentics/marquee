# MRQ-233 authoritative and branch plan

## Head, scope, and lifecycle boundary

- Ticket: MRQ-233, actor `agent:delegator-mrq-233`.
- Worktree: `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-233-calendar-strip`.
- Branch: `mrq-233-calendar-strip`.
- Planning head and base verified after `git fetch github`: `52bb485f105e0392fe475332b87cbb48dbcee832`; `HEAD == github/main` and the worktree is clean.
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

## Implementation sequence

### 1. Reconfirm the branch and migration slot

Before source edits, verify the worktree root, branch, clean owned state, `HEAD`, `github/main`, and `git merge-base --is-ancestor github/main HEAD` after a successful fetch. Re-read the migration directory and any new upstream migration; never reserve or reuse a stale number. Preserve unrelated `.lattice` state and stage only owned paths.

### 2. Make calendar truth one reusable projection

Create one calendar-debt projection used by agenda API/UI, dashboard attention, record action, and delivery-health copy. Its source is a single bounded event query over scheduled non-break sessions, calendar-role participations, people, rooms/buildings, and `calendar_invites`; it must not issue a query per session, recipient, or speaker.

For every scheduled session/person row, derive current material from the same `CalendarRequestSnapshot` builder used by ICS. Compare the canonical serialized/hashable current material with the stamped `request_snapshot`. Classify rows as current, unsent update, or never invited using the existing invite status/method and durable snapshot semantics. Keep the complete row-level evidence available to the batch planner so the preview and the send use the same answer. Invalid/missing recipient addresses remain visible as named blocked rows, but are excluded from sendable speaker counts.

The projection must distinguish these truth-table cases: no invite; first invite; same slot after a no-op edit; material time change; material room change; title/description-only change; multiple moved sessions for one speaker; cancelled/removed invite state; invalid address; and an already-admitted identical revision. The exact materiality policy must be encoded once and covered by tests, not reimplemented in route/UI code.

### 3. Extend the calendar producer to one batched email per speaker

Refactor the calendar job around a batch planner/producer while preserving the existing one-submission route as a per-session entry point:

- Load all eligible rows and all relevant sequence-ledger floors in bulk. Do not retain the existing per-recipient SELECT/ledger N+1 in the MRQ-233 path.
- Group sendable material by person. One person gets one outbox message for the action, containing one VEVENT per affected session; each event retains its own UID and independently claimed sequence. First invites use sequence 0; material updates use the next sequence after both the invite row and the ledger floor. A speaker moved several sessions receives one email, not one message per row.
- Extend the ICS/mail builder without changing the existing REQUEST/CANCEL lifecycle: current REQUEST snapshots remain immutable delivered material, updated REQUESTs retain the UID and increase SEQUENCE, and a multi-event message keeps RFC method, timezone, organizer, attendee, URL, and cancellation compatibility exact. The human-facing mail and preview state was→now time/room from the prior stamped snapshot, with event timezone and Marquee voice. Keep no-op edits from producing a new outbox row.
- Add a batch-grain idempotency-registry builder whose key includes the revision discriminator(s) (`uid:sequence`) and is documented beside the existing calendar keys. Retries of an already-admitted identical batch re-admit the same queued outbox when needed and do not claim another sequence or report a second send.
- Use the MRQ-228 batch-fence pattern for sequence claims and invite/ledger persistence. Sequence ownership comes only from `calendar_sequence_ledger`; it must remain monotone under concurrent batch requests, and the durable invite snapshots/ledger updates must not expose a newer sequence with older material. Chunk D1 statements within its statement limit without turning them into per-row reads.
- Return an honest result shape: sent/admitted speakers, first invites, updates, blocked names/reasons, no-op, and retry/admission state. If the candidate set has only blocked recipients, return a user-visible error with named reasons and do not claim that zero messages were sent. If there is no debt, return an explicit no-op.

### 4. Give the batch and per-session actions real homes

Add the authenticated event-scoped batch endpoint behind the existing `program:write` boundary and keep the existing submission invite endpoint as the record-page per-session action. Both call the same producer and projection; neither gets a private sequence or materiality rule. Add API registry/OpenAPI parity for every new route and test authorization, event/submission ownership, no-op, blocked-only, and retry behavior.

Wire the agenda builder’s `Send N calendar update(s)` action to the batch endpoint and reload the agenda snapshot after success/no-op/error. Add the signed strip beside the existing publication panel with the exact gauge order, copy, zero rendering, fixed button geometry, tabular counts, and batch modal structure from v1.17. Use the production event timezone and named recipients; do not hard-code prototype mock state or silently change wording. Add the fifth dashboard attention item, its agenda link, and the corresponding five-column/responsive geometry from the design system. Give the record page’s schedule/calendar area the per-session send action and truthful result state.

### 5. Close the lifecycle and history seams

- `PATCH /agenda/items/:itemId` and the record-page schedule path must write audit before/after slot material for a move/resize, including the no-op/CAS behavior already owned by those routes. Do not emit calendar work from an audit read; debt must derive from current agenda versus stamped snapshot.
- Record calendar batch/per-session sends with `entity_type = 'submission'` and the real submission id, not the composite outbox entity id. Update the shared history/activity projection and copy so calendar sends appear on the submission timeline with speaker/session/sequence facts while preserving existing cancel mappings.
- Correct delivery-health copy so it no longer claims that publication automatically sends an invite. Its calendar facts should use the same honest debt definition and continue to distinguish queued/failed delivery from agenda staleness.

### 6. Targeted proof before the gate

Add or extend non-browser tests with unnumbered names/descriptions only. Proof must include:

- pure materiality/staleness truth-table coverage, including no-op and title/description policy;
- one event with multiple sessions and one speaker proving one batch message, multiple VEVENTs, per-UID sequence behavior, old→new mail material, event timezone, and exact idempotency key revisions;
- first invite, material update, repeated identical retry, blocked invalid recipients, blocked-only error, and mixed sendable/blocked result counts;
- concurrent/claim-under-contention coverage proving no duplicate sequence authority and no per-row query N+1 path (instrument or assert query shapes/counts at the batch seam);
- schedule → initial send → material move → debt count → batch send → same UID with sequence +1 in outbox → current count, plus a no-op move that creates no new revision;
- PATCH agenda audit before/after and submission record timeline entity-id mapping;
- route authorization, API registry parity, agenda/dashboard/record data contracts, and delivery-health copy.

Run focused tests first, then the relevant node/static checks. Browser/computer-use/live writes are not approved in this scope; attach browser validation as `N/A — no operator approval recorded` unless the operator explicitly approves the named local surface and flow. Do not call the full `pr-gate` until Merge Captain grants a gate slot through `merge-captain`.

## Draft unnumbered criteria (stable IDs deliberately withheld)

- The agenda builder always renders the signed calendar strip with `current`, `unsent updates`, and `never invited` gauges, zero-safe tabular counts, and fixed-width action geometry.
- The dashboard always renders the signed fifth calendar-debt row and routes it to the builder; zero is an honest no-debt state.
- Calendar debt is derived from the current agenda and each delivered/stamped request snapshot, with one canonical materiality rule and no per-row N+1 reads.
- One batch produces at most one email per sendable speaker, with all affected sessions represented as their own UID/VEVENT revisions; blocked recipients are named and excluded from send counts.
- First invites, material updates, no-op edits, retries, concurrent claims, and blocked-only batches have honest, durable outcomes; retries never create a new revision for an already-admitted identical batch.
- Sequence claims use the MRQ-228 durable ledger and remain monotone; outbox identity preserves the relevant UID/sequence discriminator.
- Calendar email/preview copy states was→now time/room in the event timezone and preserves existing ICS REQUEST/UID/SEQUENCE lifecycle semantics.
- Agenda moves/resizes and record scheduling audit before/after slots; calendar sends appear in the submission timeline under the submission entity id.
- Delivery health no longer promises automatic publication sends and reflects actual calendar debt/failure facts.
- Focused non-browser proof demonstrates the full schedule→send→move→batch-send lifecycle and all authorization/error/no-op paths.

## Handoffs and status gates

1. Commit and push this plan as the first branch commit, verify local HEAD equals `github/mrq-233-calendar-strip`, then transition MRQ-233 to `planned` only after the plan is present on the branch.
2. Send the sole plan-review request to Adoption Orchestrator at c11 `workspace:10` / `surface:513`, mailbox `adoption-orchestrator`, including the absolute plan path, exact HEAD/base, scope fences, and the request for review disposition before implementation proceeds. Record the response in Lattice.
3. After plan review disposition, transition to `in_progress`, implement in small commits, recheck upstream/base and migration slot at the phase boundary, and push each durable unit.
4. After targeted proof, request an exact-head full-gate slot from Merge Captain at c11 `workspace:10` / `surface:512`, mailbox `merge-captain`. Run `npm run pr-gate -- --ticket MRQ-233` only after that slot is granted; attach the exact SHA and status semantics (`pass` or `pass-over-budget` are passing; `timeout`/`fail` are not).
5. Hand the exact pushed head to a non-author reviewer. Require a post-review Lattice artifact with exact head/base, changed paths, findings, and explicit PASS/FAIL. Resolve all findings before PR creation.
6. Open the PR against `github`/`main`, attach gate and review evidence, transition MRQ-233 to `pr_open`, and report completion to Adoption Orchestrator at surface:513/mailbox `adoption-orchestrator`. Stop there: Merge Captain owns merge; deployment/publication are out of scope.
