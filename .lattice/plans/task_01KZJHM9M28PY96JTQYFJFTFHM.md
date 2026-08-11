# MRQ-24: Chase board and slide upload

## Contract and proof boundary

BUILDPLAN M-23 + M-40, AC-91–AC-94 and AC-146–AC-148, AC-232. The organizer's noun in UI copy is **conference**; the API retains `/api/v1/events/...`. Prototype `prototypes/pipeline-v1.1/index.html` v1.9, `DESIGN.md`, `PHILOSOPHY.md`, `SPEC.md`, `EVALUATION.md`, `BUILDPLAN.md`, and `sequence/USER_STORIES.md` are binding. I will not edit contract documents or mint AC IDs.

The board is a read projection of the merged M-15 portal task state. A task is owed only when `status = 'open' AND cancelled_at IS NULL`; completed and cancelled rows remain represented by glyphs rather than disappearing. Uploads use M-13's existing authenticated presign/PUT/complete/verify path. Reminders use the existing M-35 comms send route and M-11's `enqueueOutbox`/queue consumer; this ticket will not import Resend or create a live-policy write site.

Baseline after rebasing to `forgejo/master @ 62b8748`: `npm test` passed, 38 files / 201 tests, 24.881s wall, within the 30s budget. The chase speed target (p95 ≤1000ms at ~150 speakers) is an objective reported by `check:speed`, not a local gate.

## Plan

### 1. Organizer onboarding projection and routes

Add module-local `src/routes/onboarding.queries.ts` and `src/routes/onboarding.routes.ts` (the latter follows the `*.routes.ts` manifest convention and the query module stays beside its route):

- `GET /api/v1/events/{eventId}/onboarding` returns accepted speaker rows, all assigned task-template columns, session/track metadata, state cells, last-contact timestamps, counts for the four metric buttons and filter chips, and task/track facets. Query filters cover `all|overdue|incomplete|risk`, task type, track, and search. Server-side assembly keeps the matrix bounded to accepted speakers and preserves rows with `—` for an unassigned template.
- State derivation is centralized and tested: `done` → `✓`, overdue open → `!`, open due within the risk window → `×`, future open → `·`, cancelled → `–`, unassigned → `—`; severity sorts by maximum days overdue then risk then name. Every count uses the same owed predicate, including task-type counts and overdue totals.
- Row membership follows SPEC §5.10 and AC-265: a row is present when an accepted speaker has at least one owed task (`status = 'open' AND cancelled_at IS NULL`). A speaker whose only work is cancelled leaves the board; a speaker with another accepted session that still has owed work keeps the row. Thus accepted-speaker count and matrix-row count may differ when there is nothing outstanding, and the honest empty state covers that case.
- `GET /api/v1/events/{eventId}/onboarding/speakers/{personId}` returns the authorized speaker context: profile/bio/email, task rows, accepted Sessions with tracks and agenda IDs, and outbox message history. It verifies the person is an accepted speaker in that conference.
- Both routes use the existing `program:read` authorization policy. The projection reads the merged `cancelled_at` schema and does not create a parallel task state. It refreshes as a whole snapshot so an upload completion is visible on the next live read.

### 2. Demo-safe reminder path and idempotency

Extend the existing `src/routes/comms.routes.ts` selector/preview contract only as needed for the board: add optional JSON-backed exact submission/person selection and a speaker-role constraint without reshaping or removing existing selector fields, avoiding one SQL placeholder per selected row. Per the Orchestrator ruling, MRQ-24 defines and lands this additive reminder seam before MRQ-32: the named route helpers and their contracts will be documented in the PR body for MRQ-32 to extend, never replace. Merge-field rendering is defined once in a shared module consumed by preview and enqueue; the three MRQ-32 constituents add consumers to that renderer rather than creating inline variants. Queueing remains `POST .../comms/send` → `enqueueBulkReminder` → `enqueueOutbox` (default `demo_safe`) → `enqueueMailMessage`; no reminder path calls Resend or writes `always_live`.

The UI sends the selected board rows' stable submission IDs when present, plus exact person IDs for the selected speakers; the reminder seam also addresses accepted-speaker memberships whose local task has no submission ID. It sends the template key and `task_state: open`, so the existing `sha256(template_key, entity_id, person_id)` UNIQUE key governs retries. The AC-117 proof will invoke the same bulk action twice and process both returned IDs with a fake provider, asserting one outbox row, one provider delivery, `demo_safe`, and the idempotency key. No pre-check will be added.

### 3. Chase-board UI

Add `src/ui/onboarding/OnboardingPage.tsx` and `src/ui/onboarding/onboarding.css`, wire `/onboarding` into `AppShell`, and keep `route-table.ts`'s existing entry. Reproduce v1.9's Flight Deck structure:

- fixed-width header `Send reminder (N)` (`flex-basis` and `width` reserved in CSS); four metric buttons; count-bearing All/Overdue/Incomplete/At risk chips; task-type and track selects; search; tabular counts;
- a horizontally scrollable accepted-speaker × task-type table with checkboxes, speaker button, track color, state glyph and accessible state text, last contact, and per-row `Nudge`; select-all acts on the currently shown set and never removes a row to change layout;
- honest loading/error/empty states, including “Nothing outstanding — every accepted speaker is clear.”; no fabricated data;
- a speaker drawer with chase summary, task details/due dates, Sessions with agenda handoff, message timeline, biography, and email;
- a compose drawer for one or many selected speakers with stored-template selection, subject/body, merge-field preview for a real first recipient, recipient/outbox summary, demo-safe banner, and fixed-width `Queue reminder (N)`. Queue results report queued versus duplicate and refresh the board/context log.

Poll the onboarding endpoint every 5 seconds (the binding F-8 live-ness mechanism), abort stale requests, preserve filters and selected IDs, and update the matrix when portal work changes. The drawer lifecycle restores focus and closes on Escape/backdrop.

### 4. Slide upload UX on the existing speaker portal

Keep the portal's existing M-13 transport and M-15 task completion writer. In `src/ui/portal/PortalPage.tsx` and `src/ui/portal/portal.css`, add the file task's stated byte limit and accepted types before picker interaction, client-side size rejection, XHR progress (`putFileToR2` already exposes progress), an honest percentage/bytes status, and a retry action that reuses the still-selected file after an aborted/network PUT without reopening the form. Preserve the completion-token and server verification path; no client-only completion is trusted. The resulting `speaker_tasks.status = done` is what the live board reads.

### 5. AC-tagged evidence

Add a lean AC-named test under `tests/` (prefer node/unit coverage for pure state/filter/idempotency helpers; use one focused Worker integration probe only where route/D1 behavior is required) covering AC-91–AC-94 and AC-146–AC-148/AC-232. The test will assert matrix shape/state/count/filter/sort semantics, exact selection/reminder idempotency and demo-safe policy, upload limit/progress/retry contract, and that a completed portal task is visible to the organizer projection. The portal payload is consumed as the source of the configured accepted extensions; the route now normalizes the effective task-upload byte limit through the shared MRQ-14 policy before exposing it, so the picker can state the real enforced limit even when a task omits `maxBytes`. Add `tests/ac-claims/MRQ-24.json` with `owns` set to the seven registry-unclaimed ACs AC-91–AC-94 and AC-146–AC-148, and list AC-232 under `exercises`; MRQ-14 remains the sole owner of AC-232. Keep the default suite lean and under 30s, and flag that ticket/registry discrepancy to the Orchestrator in the completion comment.

Validation will run `npm run pr-gate -- --ticket MRQ-24`, capture its complete result in the Lattice completion comment, then use the allowed running-system path for `/onboarding` and the speaker upload flow (or record an explicit N/A if the local environment cannot exercise R2). A proposed speed measurement will be reported, not promoted to a gate.

## Non-goals and deviations

- No edits to `SPEC.md`, `EVALUATION.md`, `BUILDPLAN.md`, `DESIGN.md`, `PHILOSOPHY.md`, or `sequence/USER_STORIES.md`; no new schema or alternate upload pipeline.
- No Resend calls, no additional `always_live` writer, no preflight idempotency query, no destructive deletion of completed/cancelled task history, no board drag or record-owned lifecycle action.
- If the merged route/schema differs from the contract (notably task cancellation columns or the comms selector shape), use the merged implementation as the compatibility source and flag the exact deviation and reason to the Orchestrator in the completion comment. The Orchestrator has ruled that MRQ-24 lands first on `src/routes/comms.routes.ts`; the additive functions owned by this ticket and the shared merge-renderer contract must be named in the PR body so MRQ-32 can extend them without a second path.

## Verification sequence

1. Plan commit and push before source edits; run plan review and append every resolution to this file.
2. Re-fetch `forgejo/master` at phase boundaries; after any rebase run `npm ci`.
3. Implement projection/routes/tests and UI/upload improvements in small commits; run focused tests, `npm test`, type checks, `check:api`, and `trace:ac`.
4. Move through `review` and `in_validation`, attach a PASS review artifact and real validation evidence, then run the mandatory PR gate.
5. Create the Forgejo PR against `master`, attach its URL, bump MRQ-24 to `pr_open`, push, and notify the Orchestrator at workspace:9/surface:60.

## Plan-Review Cycle 1 Resolutions (AUTHORITATIVE)

Review artifact: `art_01KZQPGZJ8CGH900GVD0D5096E` (single-agent plan review, 2026-08-11).

1. **CRITICAL — AC-232 duplicate owner:** Resolved by changing MRQ-24's claims contract to `owns` AC-91–AC-94 and AC-146–AC-148 only, with AC-232 in `exercises`. `tests/ac-claims/MRQ-14.json` remains the sole owner because `trace:ac-core.mjs` rejects duplicate owners. The implementation test still names and exercises AC-232, and the ticket/registry mismatch will be called out to the Orchestrator in the completion comment.
2. **MAJOR — MRQ-32 comms collision:** Resolved by the Orchestrator ruling: MRQ-24 defines and lands first. The change remains additive-only, with no route restructuring or renames; MRQ-24-owned route helpers and their contracts will be named in the PR body. Merge-field rendering is centralized in one shared module, and MRQ-32's seven triggers, filtered group email, and rejection-at-scale surfaces extend that seam rather than creating a second renderer or send path.
3. **MINOR — row membership:** Resolved explicitly per SPEC §5.10/AC-265: only accepted speakers with at least one owed task appear; cancelled-only speakers leave; a speaker with another accepted session that still has owed work remains. A clear accepted-speaker set therefore has an honest empty board rather than fabricated rows.
4. **MINOR — upload payload:** Resolved by source verification: M-15's portal task payload already returns parsed `accept` and `max_bytes` for file tasks. MRQ-24 consumes those fields in the client and does not widen `portal.routes.ts`.
5. **MINOR — query module placement:** Resolved by moving the planned projection module to `src/routes/onboarding.queries.ts`, beside `onboarding.routes.ts`, matching the repository's existing route-query convention.

All findings are triaged and resolved; implementation may proceed against this amended plan.

## Plan-Review Cycle 2 Resolutions (AUTHORITATIVE)

Review artifact: `art_01KZQVH38SQ6DBQ2TC71TBETN2` (single-agent implementation review, 2026-08-11).

1. **MAJOR — severity ordering:** Resolved by defining row severity as the maximum whole days overdue among owed tasks only (`open AND cancelled_at IS NULL`), with risk-task count as the next comparator and name/id as the stable tie-break. Done, upcoming, cancelled, and unassigned cells contribute zero. Add an AC-92 ordering test covering overdue magnitude, risk tie-breaks, and non-owed work.
2. **MAJOR — exact selected recipients:** Resolved additively with optional `recipient_pairs: [{ person_id, submission_id }]` on `ReminderSelector`, where `submission_id` may be null for a roster-only speaker. The board sends these pairs instead of independent person/submission unions; `recipientsFor` preserves all existing selector fields and returns only exact pairs. Add an AC-93 co-speaker test asserting one outbox row per selected pair.
3. **MINOR — filtered empty state:** Resolved by distinguishing an active filter/search/task/track no-match from a genuinely clear board; only the latter says “Nothing outstanding”.
4. **MINOR — demo-safe banner:** Resolved by adding the binding “Demo-safe outbox · no email will be delivered” banner to the compose drawer.
5. **MINOR — effective upload accepts:** Resolved by deriving the portal's client-facing accepted extensions from the shared `policyFor` rules, so the picker and authenticated sign path cannot advertise divergent formats.
6. **MINOR — prototype fidelity:** Resolved by making the four metric tiles actionable, restoring the exact head copy, `N shown · M selected`, wave/session metadata, and the colored Track column. These remain presentation-only; no new lifecycle writer is introduced.

All Cycle-2 findings are triaged above; implementation may proceed against this amended plan.
