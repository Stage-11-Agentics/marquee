# MRQ-234: Decision sends you can read first: plan, preflight, fingerprint

## Signed inputs

The signed design states: eyebrow “Wave decision”; four always-rendered rows;
zero rows muted; fixed-height detail region; one real recipient preview with
live feedback echo and demo-safety truth; clean zero-skip send closes with a
toast; skipped send alone opens a per-record result modal; stale refusal is
amber WARNING; disabled template is advisory and relabels the enabled button;
Notify reuses the plan contract with its own already-queued copy.

## Delivery plan

This is the delegator's implementation plan for MRQ-234. The binding contract
documents remain read-only in this ticket; the eventual SPEC §5.9/§4.2 fold is
an adoption/consolidation action.

### Exact scope

1. Introduce one serializable decision-plan contract and one pure
   `planBulkDecision()` seam. The planner accepts a snapshot of selected
   submissions, the decision verb, template state/content, notification state,
   and demo mode, then returns the four always-present dispositions:
   `will_send`, `already_notified`, `no_valid_address`, and `cannot_move`.
   Every row carries the record identity, title, and an operator-readable
   reason; zero rows remain present and muted in the UI. The same contract is
   usable for bulk accept/reject/waitlist, a single record decision, and Notify.

2. Add read-only plan endpoints beside the existing submission decision routes
   and expose the plan through the API manifest/OpenAPI surface. The plan
   includes the verb, selected records, rendered recipient preview, feedback
   echo, demo-suppression counts, template-enabled advisory, zero-effect
   explanation, a deterministic fingerprint, a strong ETag, and the current
   Notify `queue_revision`. Plan data is derived from current D1 state; no plan
   is persisted and no migration is expected.

3. Make apply conditional. Bulk and single decision writes accept the plan
   fingerprint through the existing strong `If-Match` concurrency idiom and
   recompute the plan immediately before mutation. A mismatch returns 409 with
   authored copy: “The selection or the email changed after you previewed it.”
   The fingerprint covers verb, template content/enabled state, selected
   records, and per-record dispositions, while excluding fields whose normal
   churn must not invalidate a legitimate preview. A plan with no effective
   change is refused with a reason, never reported as a successful zero.

4. Close Notify's queued-row race without a schema change. Summary/plan reads
   return a deterministic queue revision. Notify requires that revision and
   uses the existing D1 write boundary plus a stable MRQ-226 registry key for
   the decision/template pair; if a competing request has already claimed the
   queue window, the later request returns a stale/race refusal rather than
   enqueuing a second delivery. Keep deliberate resend semantics separate from
   this bulk Notify path.

5. Establish one email-validity helper and make all decision planning and
   notification candidate classification use it. Remove the independent SQL
   LIKE interpretation by selecting the candidate address and applying the
   canonical predicate at the shared seam. Preserve the distinction between
   no valid address, disabled template, and demo suppression: disabled template
   is advisory and relabels the enabled button to “Accept N · sends nothing”;
   demo mode truth is rendered as outbox-only suppression, not a fabricated
   delivery.

6. Reuse the canonical comms renderer for the one real-recipient preview,
   including decision fields, stored-template content, and the live feedback
   echo. No second renderer is permitted. Return per-record post-send failures
   to the UI and render them by record. A clean result with zero skips closes
   with a toast; a result modal is rendered only when at least one record was
   skipped and names every skipped record and reason.

7. Replace the existing bulk/Notify confirmation affordances with the signed
   prototype's single plan panel: eyebrow “Wave decision”, four fixed rows,
   fixed-height detail region, amber WARNING stale refusal, advisory template
   warning, demo-safety truth, and a confirm control whose position does not
   move as details change. Wire the same panel contract into the single-record
   decision where the existing record surface exposes a decision action. Keep
   bulk wording (“will not be sent twice”) distinct from Notify wording
   (“still queued — sending again would deliver twice”).

8. Add agent-native CLI plan/apply flags and parity tests. The CLI must be able
   to request a plan, display its fingerprint/ETag and disposition counts, and
   apply with the returned precondition without requiring an undocumented curl
   path. Registry, generated help, route map, OpenAPI, and client dispatch stay
   in the same change fold.

### Non-goals and holds

- No schema migration. If the race closure or revision cannot be implemented
  against existing tables, stop and report the required schema explicitly.
- No US/AC minting, and no edits to `SPEC.md`, `EVALUATION.md`,
  `BUILDPLAN.md`, `USER_STORIES.md`, or `DESIGN.md`. Contract consolidation
  owns that fold.
- No second mail renderer, no local-only decision semantics, and no weakening
  of the existing single-decision or MRQ-226 idempotency behavior.
- No browser/computer-use validation until Adoption Orchestrator grants a
  scoped approval naming the local surface/domain and permitted flow. Static
  source and targeted non-browser tests proceed now.
- No full `npm test` or `npm run pr-gate` until a serialized gate slot is
  granted by `merge-captain`. Targeted and focused tests are allowed before
  that slot.
- Stop at `pr_open`; do not merge or deploy.

### Likely files and seams

- `src/jobs/cascade/decisions.ts` and a reusable decision-plan module under
  `src/lib/` or `src/jobs/cascade/` for planner, apply, notification, and
  fingerprint orchestration.
- `src/routes/submissions-bulk.routes.ts`,
  `src/routes/submission-decisions.routes.ts`,
  `src/routes/submissions.queries.ts`, `src/api/concurrency.ts`,
  `src/api/bulk.ts`, `src/api/openapi.ts`, `src/api/manifest.ts`, and
  `src/routes/_manifest.ts`.
- `src/jobs/mail/render.ts`, `src/jobs/mail/templates.ts`,
  `src/jobs/mail/outbox.ts`, `src/jobs/mail/triggers.ts`, and
  `src/jobs/mail/idempotency.ts` (registry documentation/key registration;
  no duplicate renderer).
- `src/ui/submissions/SubmissionsPage.tsx`,
  `src/ui/submissions/SubmissionRecordPage.tsx`, and
  `src/ui/submissions/submissions.css` for the panel, result states, and
  fixed-height geometry.
- `cli/registry.mjs`, `cli/marquee.mjs`, and the existing client/CLI tests.
- Focused unit/integration/node tests adjacent to the existing decision,
  not-notified, mail, concurrency, and CLI suites. New test names use
  `MRQ-234`; they do not mint contract IDs.

### Validation plan

Before the serialized full gate, run focused tests for:

- pure planner disposition truth table, including four zero rows, unknown or
  illegal transitions, no address, disabled template, already-notified, and
  demo suppression;
- rendered preview byte/content path with a real recipient, feedback echo,
  template-enabled flag, and demo-safety line;
- fingerprint mismatch returning 409 with the authored copy, plus a positive
  If-Match apply;
- zero-effect refusal and per-record post-send failures, with clean-toast vs
  skipped-result behavior;
- two concurrent Notify requests from one queue revision where exactly one
  drain claims the rows and the other receives a race/stale refusal;
- API route/OpenAPI/manifest parity and CLI plan/apply round trip;
- source-level prototype fidelity checks for “Wave decision”, four rows,
  fixed-height detail, amber WARNING, and Notify's distinct queued copy.

Browser proof of the rendered wave-accept panel remains a held validation
artifact until the scoped approval arrives. After it does, drive the local
seeded Worker through the wave accept path, Notify path, stale-plan refusal,
and the clean-send/skipped-result states, then record only observed evidence.

### Contract allocation

The allocation is approved and reserved, but the contract fold remains held
until consolidation:

- **US-98**: one new user story for read-before-send decisions across bulk,
  record, and Notify surfaces;
- **AC-349 through AC-357 inclusive**: exactly nine new acceptance criteria,
  covering the pure four-disposition planner; shared plan route/contract;
  canonical rendered preview and feedback echo; fingerprint/If-Match refusal;
  unified email-validity plus advisory disabled-template/demo truth;
  queue-revision race closure and idempotency; zero-effect and per-record
  result truth; one-to-one panel fidelity across bulk/record/Notify; and
  CLI/API route parity;
- no migration;
- the next shared mint after this reservation is **US-99 / AC-358**.

Do not author the contract-document fold or claims manifest in this ticket.
MRQ-224 is the one fold-bearing PR currently in review. Resume that work only
after the Adoption Orchestrator sends CONSOLIDATION RESUME after PR #303
merges and `github/main` is independently rechecked.

### Cut line

The work is complete for this delegator when the implementation is committed
in durable increments, pushed to `github/mrq-234-decision-plan`, focused
non-browser validation is recorded, the serialized full gate is run when its
slot is granted, an independent review is closed, and a PR is open at
`pr_open`. Merge, deploy, contract minting, and unapproved browser validation
remain outside the cut line.

The wave accept is the product's headline action and its confirm step is a sentence and a textarea. AC-115 (US-34: rendered preview of one real recipient before a bulk send) is a live contract gap — claimed by an integration test against the comms composer, absent from the dialog it describes. Five failure modes are discoverable only after the write: unknown id, illegal transition, no valid address, disabled template (enqueueTrigger returns null silently — the decision commits with outbox_id NULL and reappears in Decided·not-notified unexplained), and demo-mode suppression (demoMailWouldBeSuppressed is exported precisely for this and no decision surface calls it). The API's failures[] is returned and discarded by the UI; a zero-row filter selector reports '0 accepted.' as success. On the Notify surface the double-send is real: retry keys are ULID-salted and the candidate query excludes only sent + demo-suppressed, so two Notify clicks before the consumer drains deliver twice.

UX: the confirm panel grows into a server-built read-only plan, one panel, not a wizard, mounted between the consequence sentence and the feedback textarea; height reserved for the variable warning rows so the confirm button never moves under the cursor. It shows: will-send / already-notified (bulk copy: 'will not be sent twice' — true by key; Notify copy: 'still queued — sending again would deliver twice') / no-valid-address / cannot-move, each expandable to titles+reasons; one real recipient's rendered message; the demo-mode suppression truth ('M of N will be suppressed to the outbox'). Warnings advisory; the only hard block is no-plan-loaded. Post-send, failures[] finally renders per-record. Zero-effect refusal with a reason (the org-comms pattern). Same plan contract serves bulk accept/reject/waitlist, the record decision, and Notify N speakers; plan route + CLI flags make it agent-native.

Build: extract planBulkDecision() from writeBulkSubmissionDecisions (pure); apply requires the plan fingerprint via the src/api/concurrency.ts idiom (strongEtag/If-Match → 409, authored copy: 'the selection or the email changed after you previewed it'); GET not-notified/summary gains queue_revision, POST notify requires it (closes the queued-row window). Fingerprint covers verb + template content + per-record dispositions, excludes fields that legitimately churn. Rendering reuses the comms preview render path (render.ts forbids a second renderer) extended with decision merge fields + templateEnabled; address validity uses the TS isValidEmail predicate (unify the SQL LIKE twin). Optional at build: a hard-bounce warning from delivery_state. Dedupe keys documented in MRQ-226's registry. New routes get SPEC §4.2 lines in the same fold or check:api reds the PR.

Contract fold: SPEC §5.9 + §4.2 amendment; US/AC minted at consolidation (coordinate on the AC-314 band). Validation: fingerprint-mismatch 409, queue_revision race (two Notifies one drain — second refuses), skip-reason truth table incl. disabled template + demo suppression, zero-effect refusal, e2e wave accept through the panel. Traces: AC-66–69, AC-115, AC-117, AC-268/269, R7, PHILOSOPHY 1.
