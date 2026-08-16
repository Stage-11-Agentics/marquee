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
   is persisted and no migration is expected. A plan is bounded to the existing
   bulk ceiling of 1,000 records: a selector resolving above that ceiling is a
   422 asking the operator to narrow the selection, rather than an unbounded
   per-record response. Within the ceiling, the four counts and all returned
   rows are exact. The loader performs set-based event/allowlist and
   outbox-state reads; it never calls the demo-suppression query once per
   recipient.

3. Make apply conditional. Bulk and single decision writes accept the plan
   fingerprint through the existing strong `If-Match` concurrency idiom and
   recompute the plan immediately before mutation. A mismatch returns 409 with
   authored copy: “The selection or the email changed after you previewed it.”
   The fingerprint covers verb, normalized feedback, template content/enabled
   state, selected records, and per-record dispositions, while excluding fields
   whose normal churn must not invalidate a legitimate preview. The response
   encodes its lowercase-hex fingerprint as `strongEtag(fingerprint, 0)`;
   `plan_fingerprint` in the apply body identifies the resource passed to
   `requireIfMatch`, so malformed/missing headers are 400 and a valid older
   fingerprint is the authored 409. This is a preflight refusal, not a claim
   that a read-then-write is a database CAS: the existing status-conditional
   writes still guard each record, and any residual transition drift returns a
   per-record failure. Single-record decision apply is also
   `concurrency: "if-match"` and requires the same pair; direct job functions
   remain internal seams without HTTP headers. A plan with no effective change
   is refused with a reason, never reported as a successful zero.

4. Close Notify's queued-row race without a schema change. Summary/plan reads
   return a deterministic event-scoped `queue_revision`, the decimal
   `events.updated_at` value used by the atomic guard. Notify conditionally
   advances that existing row from the supplied revision before enqueueing, so
   two requests with one revision cannot both drain. The revision changes on a
   Notify enqueue and does not churn from unrelated outbox rows in the event;
   unrelated event edits may conservatively make a caller re-preview. The
   notification-gap aggregate (candidate count, latest decision identity,
   associated outbox-row count, latest outbox update time, and latest outbox
   identity) remains the set-based diagnostic/fingerprint input, not a second
   unguarded revision encoding.
   Notify keeps the signed copy truthful by retaining the salted
   `IDEMPOTENCY_REGISTRY.decisionRetry()` key; it does not silently turn a
   repeat click into the permanent stable-key no-op used by the initial
   decision. Each 202 returns the post-page `queue_revision`, and the cursor
   continuation sends that returned revision on the next page. The first page
   uses the summary/plan revision; a competing external click using that old
   revision receives a stale/race 409. Deliberate single-record resend remains
   separate and keeps its existing fresh-retry semantics.

5. Establish one email-validity helper and make all decision planning and
   notification candidate classification use it. Export the TS predicate from
   one shared email module and replace the SQL LIKE twin with its documented
   SQL equivalent: non-empty local/domain characters, one `@`, a dot followed
   by a character, and rejection of ASCII whitespace. Keep the summary and
   built-in Decided · not notified membership set-based; do not materialize an
   unbounded event into the Worker. A divergence fixture covers `a b@c.d`,
   `@x.`, `a@x.`, and valid controls, and moves AC-268's counts with the
   predicate change. Preserve the distinction between
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
   move as details change. The truth table is verb-aware: accept/reject expose
   the rendered mail preview; waitlist and withdraw keep the four rows and
   fixed geometry but show an explicit no-mail detail instead of a fabricated
   recipient preview. `withdraw` is supported by the bulk plan; the record
   plan remains the existing approve/maybe/deny decision vocabulary. Published
   rows land in `cannot_move` with the existing published-live reason unless
   `confirm_published` is explicitly supplied; the current published count
   remains visible and the panel owns the explicit confirmation affordance.
   Wire the same plan contract into the single-record decision. Keep bulk
   wording (“will not be sent twice”) distinct from Notify wording (“still
   queued — sending again would deliver twice”). Feedback re-plans on a short
   debounce/blur through the canonical renderer, and the panel stays in a
   reserved stale state while that request is in flight; no client renderer is
   introduced.

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
- `src/jobs/mail/consumer.ts` for the existing demo-suppression truth seam and
  its set-based allowlist helper.
- `tests/e2e/mrq-234-decision-plan.spec.ts` for the owned automated Playwright
  proof of AC-115 and the wave panel. This is distinct from the held
  computer-use/browser-approval artifact.

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
  drain claims the rows and the other receives a race/stale refusal, followed
  by a positive multi-page continuation using the returned revision;
- API route/OpenAPI/manifest parity and CLI plan/apply round trip;
- automated Playwright proof of the rendered wave-accept panel, one real
  recipient preview, feedback echo, and the skipped-result modal;
- plan latency and bounded-refusal measurements at 150, 1,000, and a
  few-thousand-record selector;
- migration of the existing AC-268/269 and MRQ-80 Notify callers to the
  required `queue_revision` contract.

Browser proof of the rendered wave-accept panel remains a held validation
artifact until the scoped approval arrives. After it does, drive the local
seeded Worker through the wave accept path, Notify path, stale-plan refusal,
and the clean-send/skipped-result states, then record only observed evidence.
The Playwright spec is authored as part of this ticket but is not run until
the Adoption Orchestrator grants the scoped browser approval. `check:api` does
not parse `SPEC.md`; route/OpenAPI/CLI parity can be validated now, while the
§5.9/§4.2 contract-document debt remains owned by consolidation.

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

### Plan-review triage (authoritative amendments)

The attached plan-review artifact art_01M04FG1MA263MMJGGNK4HMRBH was a
plan-level FAIL. Every finding is resolved here before implementation:

- Notify's revision is a page continuation token. The first POST requires the
  summary/plan's decimal queue_revision; every 202 returns the revision after
  its page, and the cursor loop sends that value on the next page. A second
  external click still carries the old value and gets 409. The existing
  events.updated_at conditional advance is the atomic no-migration guard.
- Notify retains salted decisionRetry keys so the signed “still queued —
  sending again would deliver twice” copy remains true. The initial decision's
  stable key and deliberate resend path are not repurposed. The plan and tests
  explicitly cover the one-drain race and the positive multi-page continuation.
- Email validity stays set-based in the built-in view. A shared TS helper and a
  documented SQL predicate replace the LIKE twin; the divergence table and
  AC-268 summary/membership assertions move with that change. The SQL shape is
  bounded to the address expression and never loads an unbounded event into JS.
- The plan is capped at 1,000 records, with exact four counts and returned rows
  inside the cap and a 422 bounded refusal above it. The loader uses one event
  demo/allowlist read and set-based outbox joins. Focused latency checks cover
  150, 1,000, and a few-thousand selector that must refuse promptly.
- Fingerprint application has an exact encoding: lowercase-hex fingerprint,
  strongEtag(fingerprint, 0), and body plan_fingerprint passed to
  requireIfMatch. Malformed/missing preconditions are 400; a valid old plan
  is the authored 409. This is named honestly as a preflight, not a D1 CAS;
  existing status-conditional writes remain the residual per-record guard.
  Single decision HTTP apply is concurrency: "if-match"; internal jobs remain
  header-free seams. Normalized feedback is in the fingerprint, and the UI
  re-plans on debounce/blur through the canonical renderer while holding the
  fixed panel in a stale state.
- AC-115 owns an automated tests/e2e/mrq-234-decision-plan.spec.ts covering
  the wave panel, one real-recipient rendered preview, feedback echo, and the
  skipped-result modal. This authored Playwright proof is distinct from the
  still-held operator computer-use/browser approval and is not run during the
  hold.
- Published-live records stay in cannot_move with their existing reason
  unless confirm_published is explicitly part of the plan/apply request. The
  current published count and confirmation affordance survive inside the fixed
  panel; no fifth row is introduced.
- The four rows have a verb axis. Accept/reject have mail preview and
  suppression truth; waitlist/withdraw retain all four fixed rows but show
  explicit no-mail detail and no fabricated recipient. Bulk supports withdraw;
  single decisions retain approve/maybe/deny vocabulary.
- Existing AC-268/269 and MRQ-80 Notify callers/tests are migrated to the
  required revision. Zero-effect boundaries are explicit: selector resolves to
  nobody -> 404 with the established selection-not-found envelope; nonempty
  selection with no effective change/queue -> 409 zero_effect with a reason;
  at least one effective record -> the normal per-record result, with skips
  shown rather than silently collapsed.
- check:api does not parse SPEC.md; API/OpenAPI/CLI parity can land in this
  branch. The §5.9/§4.2 contract-document debt remains held for consolidation
  after PR #303 and CONSOLIDATION RESUME. src/jobs/mail/consumer.ts is an
  explicit seam because it owns demo suppression.

### Ordered implementation checkpoints

1. Add the pure planner, shared email predicate/SQL fixture, bounded selection
   guard, and truth-table/unit tests. Commit and push this isolated seam.
2. Add plan schemas/routes, canonical rendered preview, demo/template truth,
   fingerprint serialization, and focused API/render tests. Commit and push.
3. Add strong If-Match preflight, zero-effect envelopes, published confirmation
   handling, per-record failures, and migrate existing decision callers/tests.
   Commit and push.
4. Add the event revision CAS and cursor continuation to Notify, preserve salted
   retry keys, and prove the two-request/one-drain plus multi-page cases.
   Commit and push.
5. Replace the bulk/Notify and record confirmation surfaces with the fixed
   prototype panel and result states; author the held Playwright spec. Commit
   and push.
6. Add CLI plan/apply flags and route/OpenAPI/registry parity, then run focused
   non-browser validation. Request the serialized merge-captain slot before
   full npm test or npm run pr-gate; request scoped browser approval before
   running the e2e or computer-use proof.

Each checkpoint stages only owned paths, asserts this linked worktree's Git
root before committing, and leaves the contract fold/claims manifest untouched.
