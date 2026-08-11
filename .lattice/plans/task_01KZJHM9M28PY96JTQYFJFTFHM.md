# MRQ-24: Chase board and slide upload

## Contract and proof boundary

BUILDPLAN M-23 + M-40, AC-91–AC-94 and AC-146–AC-148, AC-232. The organizer's noun in UI copy is **conference**; the API retains `/api/v1/events/...`. Prototype `prototypes/pipeline-v1.1/index.html` v1.9, `DESIGN.md`, `PHILOSOPHY.md`, `SPEC.md`, `EVALUATION.md`, `BUILDPLAN.md`, and `sequence/USER_STORIES.md` are binding. I will not edit contract documents or mint AC IDs.

The board is a read projection of the merged M-15 portal task state. A task is owed only when `status = 'open' AND cancelled_at IS NULL`; completed and cancelled rows remain represented by glyphs rather than disappearing. Uploads use M-13's existing authenticated presign/PUT/complete/verify path. Reminders use the existing M-35 comms send route and M-11's `enqueueOutbox`/queue consumer; this ticket will not import Resend or create a live-policy write site.

Baseline after rebasing to `forgejo/master @ 62b8748`: `npm test` passed, 38 files / 201 tests, 24.881s wall, within the 30s budget. The chase speed target (p95 ≤1000ms at ~150 speakers) is an objective reported by `check:speed`, not a local gate.

## Plan

### 1. Organizer onboarding projection and routes

Add module-local `src/api/onboarding.ts` and `src/routes/onboarding.routes.ts` (the latter follows the `*.routes.ts` manifest convention):

- `GET /api/v1/events/{eventId}/onboarding` returns accepted speaker rows, all assigned task-template columns, session/track metadata, state cells, last-contact timestamps, counts for the four metric buttons and filter chips, and task/track facets. Query filters cover `all|overdue|incomplete|risk`, task type, track, and search. Server-side assembly keeps the matrix bounded to accepted speakers and preserves rows with `—` for an unassigned template.
- State derivation is centralized and tested: `done` → `✓`, overdue open → `!`, open due within the risk window → `×`, future open → `·`, cancelled → `–`, unassigned → `—`; severity sorts by maximum days overdue then risk then name. Every count uses the same owed predicate, including task-type counts and overdue totals.
- `GET /api/v1/events/{eventId}/onboarding/speakers/{personId}` returns the authorized speaker context: profile/bio/email, task rows, accepted Sessions with tracks and agenda IDs, and outbox message history. It verifies the person is an accepted speaker in that conference.
- Both routes use the existing `program:read` authorization policy. The projection reads the merged `cancelled_at` schema and does not create a parallel task state. It refreshes as a whole snapshot so an upload completion is visible on the next live read.

### 2. Demo-safe reminder path and idempotency

Extend the existing `src/routes/comms.routes.ts` selector/preview contract only as needed for the board: support a JSON-backed exact submission/person selection and a speaker-role constraint, avoiding one SQL placeholder per selected row. Preview resolves the same recipient/task merge data used at enqueue. Queueing remains `POST .../comms/send` → `enqueueBulkReminder` → `enqueueOutbox` (default `demo_safe`) → `enqueueMailMessage`; no reminder path calls Resend or writes `always_live`.

The UI sends the selected board rows' stable submission IDs, template key, and `task_state: open`, so the existing `sha256(template_key, entity_id, person_id)` UNIQUE key governs retries. The AC-117 proof will invoke the same bulk action twice and process both returned IDs with a fake provider, asserting one outbox row, one provider delivery, `demo_safe`, and the idempotency key. No pre-check will be added.

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

Add a lean AC-named test under `tests/` (prefer node/unit coverage for pure state/filter/idempotency helpers; use one focused Worker integration probe only where route/D1 behavior is required) covering AC-91–AC-94 and AC-146–AC-148/AC-232. The test will assert matrix shape/state/count/filter/sort semantics, exact selection/reminder idempotency and demo-safe policy, upload limit/progress/retry contract, and that a completed portal task is visible to the organizer projection. Add `tests/ac-claims/MRQ-24.json` with `owns` set to the eight ticket ACs and no unrelated claims. Keep the default suite lean and under 30s.

Validation will run `npm run pr-gate -- --ticket MRQ-24`, capture its complete result in the Lattice completion comment, then use the allowed running-system path for `/onboarding` and the speaker upload flow (or record an explicit N/A if the local environment cannot exercise R2). A proposed speed measurement will be reported, not promoted to a gate.

## Non-goals and deviations

- No edits to `SPEC.md`, `EVALUATION.md`, `BUILDPLAN.md`, `DESIGN.md`, `PHILOSOPHY.md`, or `sequence/USER_STORIES.md`; no new schema or alternate upload pipeline.
- No Resend calls, no additional `always_live` writer, no preflight idempotency query, no destructive deletion of completed/cancelled task history, no board drag or record-owned lifecycle action.
- If the merged route/schema differs from the contract (notably task cancellation columns or the comms selector shape), use the merged implementation as the compatibility source and flag the exact deviation and reason to the Orchestrator in the completion comment.

## Verification sequence

1. Plan commit and push before source edits; run plan review and append every resolution to this file.
2. Re-fetch `forgejo/master` at phase boundaries; after any rebase run `npm ci`.
3. Implement projection/routes/tests and UI/upload improvements in small commits; run focused tests, `npm test`, type checks, `check:api`, and `trace:ac`.
4. Move through `review` and `in_validation`, attach a PASS review artifact and real validation evidence, then run the mandatory PR gate.
5. Create the Forgejo PR against `master`, attach its URL, bump MRQ-24 to `pr_open`, push, and notify the Orchestrator at workspace:9/surface:60.
