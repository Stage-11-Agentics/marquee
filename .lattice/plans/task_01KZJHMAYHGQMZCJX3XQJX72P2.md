# MRQ-38: Role confirm/decline and decision feedback

BUILDPLAN: M-42 (rank 23, US-37) + M-52 (rank 9, US-74) — Wave 2 (§5) · MERGED at mint (3 h + 3 h = 6 h; both are the speaker-response surface written across `src/ui/portal/*` and the submission record — the two tickets the portal ticket (M-15) deliberately did **not** own)

**M-42 — Confirm / decline** (3 h, ACs AC-152 – AC-154, dep M-15)
Scope (verbatim): visible to lead, per role, decline notifies/flags agenda.
AC-153: a person holding two roles on one submission confirms each independently; one response does not settle the other.

**M-52 — Decision feedback + email from record/review** (3 h, ACs AC-235/AC-236, deps M-11/M-15/M-17/M-32)
Scope (verbatim): **sole owner of AC-235/236 end to end** — the `submission_decisions` write, the render-once into the outbox, the portal display from that same row, and the record log. M-15 renders the slot and M-18 calls the write; neither claims the IDs. One-off templated email logged on the record.
AC-235's headline assertion: bulk-accept 3 records → 3 `submission_decisions` rows exist and all 3 portals render from them. **The demo's headline action must not use a second render path.**

ACs (union): AC-152 – AC-154, **AC-235, AC-236**
Hours: 6 (3 + 3)
Workflow: inline-full
Shared files: `src/ui/portal/*` is shared with M-15 — **one file per concern**; M-15 rendered the slots, this ticket fills them. Do not restructure M-15's files.
Deps: M-15, M-11, M-17, M-32+M-53
Plan: filled in by delegator's plan phase

## Boundary and evidence contract

- Actor: `agent:delegator-mrq-38`; branch: `mrq-38-confirm`.
- The worktree was rebased to the fetched `forgejo/master` at `e18a1cc8a270ad57b36587ebe606b299c7c6a486`; `npm ci` was run after the rebase. The first commit from this branch will contain this plan only and will be `MRQ-38 plan`, pushed to Forgejo before any source change.
- The repository contract has been read: `CLAUDE.md`, `sequence/run-state.md`, `PHILOSOPHY.md`, `DESIGN.md`, `SPEC.md`, `EVALUATION.md`, `BUILDPLAN.md`, `sequence/USER_STORIES.md`, and prototype v1.9 in `prototypes/pipeline-v1.1/index.html`. Contract files will not be edited and no AC IDs will be minted.
- The baseline `npm test` was measured before implementation and timed out at 29,249 ms against the 30,000 ms harness budget, with only the known missing-local-secrets warnings. Implementation validation will use targeted suites first and will not spend the budget on repeated identical full-suite retries.

The completion proof must distinguish tests from running-system observation. It must show the HTTP status and the resulting database/API state for every guardrail; a rejection without an unchanged-row assertion is not evidence.

## Implementation slices

### 1. One decision writer, one rendered feedback value

Extend the existing decision path in `src/jobs/cascade/decisions.ts`; do not add a second insert or copy a decision onto `submissions`.

- Add optional `feedback_md` to the bulk decision input and `/submissions/bulk` body, then pass the same value through `writeBulkSubmissionDecisions`, `enqueueDecisionMail`, and the existing private `insertDecisions` writer. Record decisions and bulk decisions must therefore produce the same `submission_decisions` shape, including `outbox_id`.
- Keep `insertDecisions` as the only writer. The existing outbox enqueue remains the sole render-once boundary; it already uses `entity_id = submission_id` and the canonical `sha256(template_key, entity_id, person_id)` idempotency key. Acceptance/rejection templates must expose the existing `{{decision.feedback}}` field through `mergeTemplate`/`renderMail`; no renderer or parallel mail path is allowed.
- Add the record decision feedback interaction in `src/ui/submissions/SubmissionRecordPage.tsx` and send `feedback_md` through the existing decision route. The control row keeps a reserved height/width so `Accept`, `Maybe`, `Reject`, and the feedback state do not move neighboring elements.
- Make the record history projection show the decision and its normalized feedback, and keep the decision row tied to its outbox row. The portal projection in `src/routes/portal.routes.ts` will read the latest `submission_decisions` row directly and return the same normalized feedback value; `src/ui/portal/PortalPage.tsx` will render that value without re-rendering email content.

### 2. Per-participation confirmation and decline

Implement the speaker routes specified by `SPEC.md` in `src/routes/portal.routes.ts`:
`POST /api/v1/me/participations/{participationId}/confirm` and
`POST /api/v1/me/participations/{participationId}/decline`.

- Resolve the participation with `id`, `event_id`, and `person_id = auth.personId`, and require the speaker membership for the conference. The write predicate must include the exact participation ID and authenticated person; it must never update by `person_id` alone. Confirm and decline are idempotent for that one role and return the resulting row.
- Accept an optional trimmed decline note, write `confirmation_status`, `confirmed_at` (only for confirmation), and audit the role-specific before/after state against the submission. A decline enqueues a notification for the program lead through the existing `enqueueBulkReminder`/`enqueueOutbox` and shared template renderer with the default `demo_safe` policy. It must not add an `always_live` write site.
- Add participation-role data to the portal submission projection so two roles on one submission remain two independently actionable rows. The existing deduplication by submission ID must become a grouping that preserves every participation ID, role, status, and response timestamp.
- Fill the existing portal status-hero slot in `src/ui/portal/PortalPage.tsx`. Confirm/decline controls use stable labels and a fixed action-row footprint, and decline uses the prototype's optional-note confirmation copy. UI copy says “conference”; API paths remain the existing `/api/v1/...` wire paths.
- Surface the decline on the lead's record and agenda reads. Reuse the existing participant confirmation fields in `src/routes/submission-record.routes.ts`; add a derived declined-participant/confirmation flag to the agenda projection/query and the existing agenda tile/list in `src/ui/agenda/AgendaPage.tsx`, using a reserved-height flag slot like the existing conflict flag. No schema migration is needed for a derived flag.

### 3. One-off templated mail from the published comms seam

MRQ-24's pushed seam is available at `forgejo/mrq-24-chase` (`b11982c`) and has been read. Build against these exact interfaces, then adopt the branch at the implementation rebase; do not wait for its merge. The seam provides `renderAdHocMail(subject, body, data)`, the shared `mergeTemplate`/`renderMail` types, `mergeDataForRecipient`/`firstName` in `src/jobs/mail/merge-data.ts`, and exported `ReminderSelector`/`recipientsFor` in `src/routes/comms.routes.ts`.

- Extend the single existing `POST /api/v1/events/{eventId}/comms/send` route only as needed for the record's exact `{ submission_ids: [submissionId], person_ids: [personId], role? }` selection and history logging. Use `recipientsFor` and `mergeDataForRecipient`; do not create `/messages/send`, a record-specific send route, a second merge-field renderer, or a second outbox writer.
- Preserve MRQ-24's deliberate empty-selection guard: `submission_ids: []` or `person_ids: []` is a no-op, never an omitted filter that expands to a bulk send. Add a test for this guard alongside the one-recipient positive control.
- Use `renderAdHocMail` for ad-hoc subject/body rendering and `renderMail` for stored templates through `enqueueOutbox`/`enqueueBulkReminder`. The selected submission/person becomes `entity_id`/`person_id`, so duplicate clicks converge on the existing idempotency key. Every inserted message remains `demo_safe`.
- Add the record-context composer/action (review remains blind/read-only unless the existing review surface has an authorized identity) and log each successful one-off send in the submission's existing `audit_log` history with the outbox ID/template key and recipient identity needed by the lead. Do not log the unrendered private body into a second record store; record history and outbox reads must agree on the same row.
- MRQ-32 may extend the same route, so after its changes land rebase and resolve only additive conflicts in the shared seam. If the published interface cannot express the exact record recipient, report that concrete mismatch to the Orchestrator for a ruling; do not fork it.

### 4. Claims, API contract, and ownership hygiene

- Add `tests/ac-claims/MRQ-38.json` with `owns` exactly `AC-152`, `AC-153`, `AC-154`, `AC-235`, and `AC-236`; these are MRQ-38's sole claims. No other ticket's claim file will be edited.
- Update the route/OpenAPI registry through the existing `defineApiRoute` entries and preserve the event-scoped wire naming. Shared portal files will be changed one concern at a time; no M-15 portal restructure.
- Add no production secret, no live mail policy, no contract-document amendment, and no unrelated package/script change.

## Tests and proof cases

Create an AC-tagged integration file under `tests/integration/api/` (using the existing worker fixture) named for AC-152–154/235/236. Keep pure merge/normalization and fixed-layout checks in `tests/node` where a Worker runtime is unnecessary.

The integration tests must include all of the following:

1. AC-152: a speaker confirms one accepted role and the lead's record shows that exact role confirmed; a decline returns the expected success status, emits a lead notification with `send_policy = demo_safe`, and adds the agenda decline flag.
2. AC-153: seed one person with two roles on one submission. Confirm role A and assert 200 plus role A changed; assert role B is still `pending`. Attempt role B as another person and assert the rejection status plus that neither role changed, then perform the authenticated positive control for role B.
3. AC-154: decline with and without a note, assert the notification/audit/agenda state, and assert no unrelated submission or participation is changed.
4. AC-235: decide once with feedback and assert the outbox text/html and portal feedback normalize to byte-equivalent values from the same `submission_decisions` row. Repeat with no feedback and assert the feedback is null/absent in both projections. Bulk-accept three records, assert exactly three decision rows and three outbox rows, then read all three portals and assert each points to its own decision row and feedback. The test must not insert a `submission_decisions` row directly as its positive control.
5. AC-236: from a record/review context use the single comms route, assert one rendered outbox row plus one record-history entry, assert `demo_safe`, and assert a duplicate request converges by idempotency rather than producing a second rendered message.

Every negative authorization test will assert both status and absence/unchanged state, with a positive control proving the fixture was writable. Tests will name their AC IDs in the test title so `trace:ac` can associate the evidence.

## Verification and handoff sequence

1. Commit and push this plan first with the required `MRQ-38 plan` message, then move Lattice to `planned` only after the plan is present at both the absolute parent path and the tracked worktree path. Run the single plan-review actor and append every finding plus its disposition under an authoritative `Plan-Review Cycle 1 Resolutions` section in both copies before moving to `in_progress`.
2. Re-fetch `forgejo/master` and `forgejo/mrq-24-chase` at each phase boundary. After the first plan commit, rebase onto the published MRQ-24 seam and run `npm ci` immediately after the rebase; rebase again onto the latest master/MRQ-32 result before the PR and verify the final diff excludes dependency-only files. Implement in logical commits, push each completed slice, and keep the worktree root guard before each commit.
3. Run targeted TypeScript/unit/integration tests, `npm run trace:ac -- --scope=merged --ticket=MRQ-38`, and the relevant design/API checks. Run a local Worker with an ephemeral port and exercise confirm, decline, single feedback, bulk-three, portal reads, agenda flag, and one-off comms with `curl`/direct fixture probes; record observed status codes, row IDs, outbox policy, and normalized feedback. Browser/computer validation is not assumed without an explicitly approved surface.
4. Move to `review`, run the mandated single code-review actor against `forgejo/master`, and resolve all findings. The review artifact must postdate the review transition and name the exact reviewed commit. If the reviewer is unavailable, attach a substantive self-review with the required role and the same evidence.
5. Move to `in_validation`, run the targeted suite plus the live local probes and `npm run pr-gate -- --ticket MRQ-38`; preserve the exact JSON/text result in the completion comment. Do not call a local pass Forgejo-green.
6. Push the final head, open a Forgejo PR from `mrq-38-confirm` to `master` with the AC proof and exact gate output, attach the PR URL, move Lattice to `pr_open`, and send the Orchestrator at workspace 9 surface 60 the final state and PR URL. The Orchestrator owns merge and terminal CI.

## Plan-Review Cycle 1 Resolutions (AUTHORITATIVE)

- **MRQ-24 ordering:** Implementation proceeds against the published seam as directed. At the PR boundary, if `mrq-24-chase` is still unmerged, do not silently include its WIP/dependency-only commits in the MRQ-38 diff. Report that exact state to the Orchestrator and follow its choice of holding the PR or explicitly opening a stacked PR with the dependency-only files enumerated. The final reviewed MRQ-38 diff will be checked against `master` before `pr_open`.
- **30-second suite budget:** After the new tests land, run the full `npm test` once and record its measured wall time. If it exceeds 30,000 ms, report the exact overage and the targeted-suite results to the Orchestrator as a suite-budget defect; do not hide the regression by repeatedly retrying or by relabeling a partial run.
- **AC-235 comparison:** The test will query the `submission_decisions` row ID and `feedback_md`, assert the portal projection exposes that exact row/value, then assert the outbox body contains the production `mergeTemplate`/`renderMail` output for `{{decision.feedback}}` and the same normalized value. It will not add a test-local renderer or compare the whole email blob byte-for-byte to the portal field.
