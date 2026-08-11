# MRQ-32: Automated triggers, filtered group email, and rejection at scale

BUILDPLAN: M-34 (rank 15, US-46) + M-35 (rank 16, US-45) + M-31 (rank 12, US-34) — Wave 2 (§5) · MERGED at mint (3 + 4 + 2 = 9 h; one comms cluster on one module — every constituent is a templated-send surface riding M-11's outbox, and splitting them puts merge-field rendering across three PRs)

**M-34 — Automated triggers** (3 h, ACs AC-125 – AC-127, dep M-11)
Scope (verbatim): seven toggleable templates; configurable pre-close cron.

**M-35 — Filtered group email** (4 h, ACs AC-128 – AC-131, AC-250, dep M-11)
Scope (verbatim): counted selector, real-recipient preview, per-recipient record logging; **owns the single send route `POST /events/:id/comms/send` `{selector, template_key?, subject?, body?}` — exactly-one-of enforced server-side, merge fields render in both, ad-hoc sends log identically** (there is no `/messages/send`; one operation, one path).
AC-250 (Amendment 9): an external LLM/agent may compose the nudge text; Marquee provides the rails and builds no LLM features itself. The CLI half of AC-250 is M-38's.

**M-31 — Rejection at scale** (2 h, ACs AC-114 – AC-117, dep M-18)
Scope (verbatim): merge fields, real rendered preview, portal outcome, double-send impossible.

ACs (union): AC-114 – AC-117, AC-125 – AC-131, **AC-250** (send-surface half)
Hours: 9 (3 + 4 + 2)
Workflow: sub-agent-full (≥7 h combined)
Shared files: none — module-local under `src/routes/comms.routes.ts` / `src/ui/comms/*` (M-11's module; add files, do not rewrite). **No module here imports Resend** — everything enqueues to M-11's outbox and the queue consumer sends (G3, audited by A-3).
Deps: M-11, M-18
Route discipline: exactly **one** send route. `/messages/send` must not appear anywhere — `check:api`'s registry parity is built to catch that alias at gate time.
## Plan status and baseline

- Working tree: `/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-32-comms` on `mrq-32-comms`.
- Refreshed base: `forgejo/master @ 62b874873655b34d5f6aa24dfa20874c0c79551a`; the branch was fast-forwarded from the requested `8a39b4b` cut before planning, and `npm ci` was run after that refresh.
- Baseline: `npm test` passed (39 Vitest files / 204 tests and 40 Node checks) in 16.629s; the only output was the existing warning for absent local secrets.
- No contract document will be edited and no AC IDs will be minted.

## Implementation shape

MRQ-12 already owns the outbox, renderer, template defaults, demo-safe consumer, and the generated `comms.routes.ts` module. MRQ-32 will complete that seam rather than create another mail path. The shared renderer will remain the only merge-field implementation for previews, queued bodies, and all seven trigger families.

### 1. Complete the automated trigger path

Extend the existing mail trigger helpers in `src/jobs/mail/triggers.ts` and the scheduler in `src/jobs/mail/consumer.ts`:

- Keep the seven canonical trigger keys (`submission_confirmation`, `form_closing_reminder`, `added_to_submission`, `acceptance`, `rejection`, `task_assigned`, `task_overdue`) and their stored-template `enabled` gate in one place.
- Keep form `reminder_offset_hours` as the configurable pre-close setting. The hourly scheduled handler will run the pre-close scan and an overdue-task scan; both scans will enqueue through `enqueueTrigger`, use the business entity as `entity_id`, and rely on the outbox UNIQUE constraint for repeat cron invocations.
- Exclude cancelled tasks from both the task-state selector and the overdue scan. A task is overdue only while it is `open`, not cancelled, and `due_at < now`.
- Wire `added_to_submission` at the actual participant-creation paths (admin submission creation and public-form participant finalization where applicable), using the same event/person/submission merge data and queueing only newly inserted outbox rows.
- Wire `task_assigned` from the existing `reconcileTaskSet` task writer. Newly created task rows use the task ID as their idempotency entity; restoring an existing cancelled task does not manufacture a second assignment notification.
- Preserve `enqueueMailMessage` as the only queue handoff. No trigger or comms module may import Resend or call a provider.

The two existing `always_live` writers in `src/jobs/mail/outbox.ts` remain the complete set: `enqueuePublicFormConfirmation` and `enqueueSmokeHarnessMail`. Every MRQ-32-created outbox row uses the schema-default `send_policy = 'demo_safe'`; the PR body will enumerate the new trigger, bulk, and route send sites and state that policy explicitly.

### 2. Make the comms API a real, bounded surface

Update `src/routes/comms.routes.ts` in place; keep it as the sole JSON route module for this feature and do not add `/messages/send`.

- Return the seven trigger templates (plus the existing non-trigger bulk templates where appropriate) with stored event-scoped overrides merged over the shipped defaults, so a fresh event has seven visible/toggleable rows and a toggle/edit round-trips to `email_templates`.
- Centralize the send/preview input validation so template sends and ad-hoc `{subject, body}` sends enforce exactly one form server-side. Only the sendable trigger/support keys are selectable; auth-only templates stay internal.
- Make `POST /api/v1/events/{eventId}/comms/preview` resolve the selector against the requested conference, report the selected count, and render the first real selected recipient through the shared renderer. If a caller asks for a particular recipient, require that recipient to belong to the selected event-scoped set. A cross-event/person miss must return the documented error and must not disclose an email, name, submission ID, title, or rendered row; a positive control proves the preview is not vacuously empty.
- Keep the single `POST /api/v1/events/{eventId}/comms/send` route as the only send operation. Resolve status/track/format/task-state selectors server-side, preserve one `(submission, person)` recipient identity, enqueue each row through the existing bulk helper, and return selected/queued/duplicate counts. Do not add a pre-check for idempotency; the `sha256(template_key, entity_id, person_id)` key and UNIQUE constraint decide races.
- Ensure template and ad-hoc sends both pass the same merge data to subject, text, and HTML. Unknown merge fields remain visible. The recipient and person-message reads remain event-scoped and expose the rendered body/status for the log.
- Keep all modules named `*.routes.ts` and verify the manifest/OpenAPI contains the route set with `check:api`.

### 3. Replace the honest UI stub with the v1.9 comms surface

Complete `src/ui/comms/CommsScreen.tsx` and `src/ui/comms/comms.css` without changing the shared shell contract:

- Render the prototype-shaped Communications page with stable Templates, Triggers, and Outbox sections; show all seven toggles, editable subject/body, merge-field chips, and a configurable pre-close offset/status where the existing form settings provide it.
- Load the event-scoped templates and outbox, use the API preview for the counted selector and one real recipient, and render the same returned subject/body that will be queued. Provide status/track/format/task-state filters and an honest zero-recipient state.
- Enable the Queue action only when the server preview is valid; on submit call the one `/comms/send` route, show selected/queued/duplicate results, refresh the log, and keep the demo-safe banner visible. Ad-hoc compose remains available through subject/body with the same exactly-one-of rule.
- Keep controls in reserved boxes so loading, validation, recipient changes, and delivery-state changes do not make elements jump. Use “conference” in organizer-facing copy and keep `/api/v1/events/...` only on the wire.
- Show a rendered-body preview/detail in the outbox log and per-recipient history rather than only a status count.

### 4. AC-tagged proof

Add a lean route/integration test file under `tests/` (prefer one fixture and direct Worker requests) and extend only the existing mail fixture when a helper proof is cheaper. Add `tests/node/comms-ui.AC-128-131-250.test.mjs` only for static UI invariants that do not need a Worker. Add `tests/ac-claims/MRQ-32.json` with the ticket’s AC union and any shared criteria exercised.

The tests will include:

- AC-114 / AC-128: seeded speaker, submission title, room, and scheduled time render into subject/text/HTML, with positive values asserted.
- AC-115 / AC-130: a filtered request returns a count and a real recipient preview; a cross-event recipient returns its status and asserts no recipient email, name, ID, title, or outbox row is present, with a positive control.
- AC-116: a rejected submitter’s authenticated portal outcome is visible and its rendered rejection mail is in the outbox.
- AC-117: invoke the same rejection/bulk or comms action twice, assert one outbox row and one provider delivery, and assert the provider request carries that row’s idempotency key. The test will exercise the UNIQUE path rather than a racing pre-check.
- AC-125 / AC-126: all seven actual trigger paths produce rows, every trigger can be disabled without a row, and edited templates round-trip through rendering.
- AC-127: a time-controlled scheduled invocation is empty before the configured offset, emits at the offset, and is idempotent on a repeat invocation.
- AC-129 / AC-131: status/track/format/task-state filtering returns the counted set, cancelled tasks are absent, and each selected recipient has a rendered inspectable outbox/person-history row.
- AC-250: the single route accepts either a stored template or caller-supplied subject/body, rejects both/neither, keeps the ad-hoc row shape identical, and proves `/messages/send` is absent from the route/OpenAPI registry.

Every guardrail case will assert both status and absence of leaked data/rows, and each absence assertion will have a positive control. Tests stay hermetic and must not invoke a real provider or write `always_live` rows.

## Verification and handoff

1. After the plan commit, transition `planned`, run the required single plan review, append an authoritative resolution block for every finding, and commit/push any plan amendment before entering `in_progress`.
2. At implementation phase boundaries, fetch `forgejo` and record the exact base SHA. Commit meaningful units and push each commit from the guarded worktree.
3. Run focused comms tests, then `npm test`, `npm run check:api`, `npm run trace:ac -- --ticket MRQ-32`, `npm run check:design`, and `npm run pr-gate -- --ticket MRQ-32`. If a rebase occurs, run `npm ci` before trusting tests.
4. For validation, run the Worker/API flow against an isolated local fixture with curl or direct requests, then validate the UI route in the approved local c11 surface if browser approval is granted. Record the actual count, preview, queue, duplicate, portal, and outbox evidence with `--role validation`; no real-address mail or external LLM is used.
5. Create one Forgejo PR against `master` with MRQ-32, M-34/M-35/M-31, the AC IDs, exact send-site/policy enumeration, test and `pr-gate` output, attach its URL, and stop at `pr_open` for the Orchestrator.

## Plan-Review Cycle 1 Resolutions (AUTHORITATIVE)

Review artifact: `art_01KZQPRM3X2FAKYHFQ3AQ3TED2` (single-agent plan review, 2026-08-11). The review verdict was PASS; these resolutions close every finding and incorporate the Orchestrator's MRQ-24 seam ruling received before implementation.

1. **MAJOR — `submission_confirmation` enablement:** The existing public-form thank-you path will read the stored `submission_confirmation` template's `enabled` gate before calling `enqueuePublicFormConfirmation`. Its existing row remains the one `always_live` policy path and is not counted as an MRQ-32-created row; MRQ-32 adds no new `always_live` writer. The seven-trigger proof will explicitly distinguish this pre-existing policy-preserving path from the six new demo-safe trigger/bulk paths.
2. **MINOR — portal outcome:** The rejected submitter's authenticated portal outcome is already served by `portal.routes.ts`'s `status`/`status_label` payload and the portal UI. MRQ-32 adds the AC-116 proof and rejection outbox assertion; it does not widen portal behavior.
3. **MINOR — AC-117 provider mechanism:** The repeat-action delivery proof uses a `demo_safe_allowlist` fixture address, the existing mocked provider fetch in the mail fixture, and the persisted row's `Idempotency-Key`. It never invokes a real provider or writes a new `always_live` row.
4. **MINOR — cross-ticket file contention:** Files outside the comms module are now explicitly in scope: `src/routes/public-form.routes.ts` for the existing confirmation gate and `src/jobs/cascade/decisions.ts` for `task_assigned`. MRQ-28 is the known decisions-module contention partner; implementation will re-fetch/rebase at the boundary and inspect its merged shape before editing.
5. **ORCHESTRATOR RULING — MRQ-24 comms seam:** MRQ-24 lands first and is the compatibility source for `src/routes/comms.routes.ts`. Before implementation, MRQ-32 will rebase onto the commit containing MRQ-24, read its PR body, and use the named additive reminder-send helpers, shared merge renderer, selector/preview contract, and per-recipient outbox-row contract as-is. MRQ-32 will extend that one send route and one renderer with seven triggers, filtered group email, and rejection-at-scale behavior; it will not rewrite, rename, or create a parallel templated-send path. If the merged MRQ-24 shape cannot express an MRQ-32 constituent, implementation stops and the Orchestrator is asked to rule on the exact incompatibility rather than using a silent workaround. Every MRQ-32-added send site remains `demo_safe`; the two existing `always_live` write sites remain unchanged in count and are enumerated explicitly in the PR body.

All findings are triaged and resolved; implementation proceeds only after the MRQ-24-first rebase and PR-body seam read.
