# Code Review: MRQ-139 — A submission's participants are editable after intake

Reviewer: independent review agent (Claude), cold context.
Verified against worktree `mrq-139-participants-editable` at `c07adb8c`.

## 1. Verdict

**PASS** — Implementation is correct and meets acceptance criteria.

Verified independently, not just by reading the diff:

- `npx vitest run tests/integration/api/participants-editable.MRQ-139.test.ts` → **8/8 passed** (test bodies 6.9s; the 63s wall time is transform/import under machine contention, per the project's contention rule).
- `npx tsc --noEmit` → clean.
- Cross-checked the diff's claims against the real codebase: the search route really does return `{ data: [...] }` with `type: "Speaker"` (`src/routes/search.routes.ts:132`), `Button` supports `small`/`ghost`/`class` (`src/ui/shell/components.tsx:4`), `statusLabel` renders every attachable role sensibly (`src/ui/submissions/record-copy.ts:14`), and the role enum in `participantInput` exactly matches the DB CHECK constraint (`migrations/0001_init.sql:413-418`).

## 2. Summary

The change adds two properly authenticated API routes (`POST`/`DELETE` participants under `program:write`), a full add/remove UI on the record's Participants card with an existing-person picker and a new-person path, and closes the `max_speakers: 4` vs two-slot contradiction by clamping the advertised maximum to what the form's fields can actually collect. Quality is high: org-scoping is enforced on `person_id`, email matches dedupe against existing people, the submitter is protected from removal at both the server and the UI, every write is audited, and the tests exercise behavior through fresh reads rather than trusting the write's echo. All findings below are minor; none block merge.

## 3. Issues

**[MINOR] src/routes/submission-record.routes.ts:1300 — Idempotent add returns 201 when nothing was created**
When the person+role pair already exists, the route short-circuits and still responds `201 Created`, though no resource was created. Harmless for the UI (it reloads either way), but an API reader — and this project is agent-native by design — will take 201 as "a new participation now exists."
**Fix:** Return `200` on the already-exists path, keeping `201` for genuine inserts.

**[MINOR] src/routes/submission-record.routes.ts:1289-1310 — Dedupe check races; the backstop turns a double-click into a 500**
The exists-check and the INSERT are separate round trips with `concurrency: "none"`. Two simultaneous identical adds both pass the check; the unique index `uq_participations_person_submission_role` (migrations/0001_init.sql:842) correctly prevents the duplicate row, but the loser surfaces as a constraint failure (5xx) instead of the graceful no-op the comment promises. Data stays correct; only the error shape is wrong.
**Fix:** Use `INSERT ... ON CONFLICT (person_id, submission_id, role) DO NOTHING` (or catch the constraint error and fall through to the existing-row response), making the idempotency atomic rather than read-then-write.

**[MINOR] src/routes/submission-record.routes.ts:177-179 — `participantInput` still accepts client-supplied `position`, contradicting the append-only doc**
`participantInput` inherits `position` from `personInput`, and the handler honors it (`body.position ?? nextParticipantPosition(...)`). The `nextParticipantPosition` doc says "Appended, not inserted: an addition never reorders the people already listed" — but an API caller passing `position: 0` ties with the submitter's position and reorders the list (ORDER BY position, id). The UI never sends it, so this is API-surface only.
**Fix:** `.omit({ role: true, position: true })` in `participantInput` so the server always appends — or, if caller-controlled ordering is intended, say so in the route description instead of the append-only comment.

**[MINOR] src/ui/public/form/PublicForm.tsx:409-414 — The slot sentence can still overstate on a form with no participant fields**
`advertisedMaxSpeakers` deliberately passes the configured number through when a form has no `speaker_*` fields (`collectableParticipantSlots` → null). For such a form with `max_speakers: 4`, the new copy renders "3 optional co-speaker slots" beside zero participant fields — the old hardcoded copy was equally wrong ("one optional co-speaker slot"), but the dynamic number can now be *more* wrong. Edge case; only reachable by a form built without participant fields.
**Fix:** Gate the participant-limit sentence on the form actually having participant fields (the client can detect `speaker_name`/`speaker_email` in `state.fields`), or have `toPublicFormState` expose the slot count directly.

Two observations, not defects:

- `min_speakers` is not clamped the way `max_speakers` now is: a form configured `min_speakers: 3` with two collectable slots remains unsatisfiable. Pre-existing, outside this ticket's named contradiction, but it is the same class of bug — worth its own small ticket.
- The record's person picker searches the event's speaker-roster + submitter pool (`SPEAKER_ROSTER_PERSON_SOURCE` union in `search.routes.ts`), not all org people. An org person with no event footprint won't appear in search — but the "Add new person" path dedupes by email (`resolvePerson`), so they attach without a duplicate row. Behavior is correct; the picker's coverage is just narrower than "everyone in the organization."

## 4. Positive Observations

- **The data model rules were respected exactly.** Human properties stay on `people`, participation on `participations`; the email-match path attaches the existing org-level `person_id` rather than minting a duplicate (tested at `participants-editable.MRQ-139.test.ts` — "matched, not duplicated" asserts `COUNT(*)` on `people` is unchanged). No parallel speakers table, no workflow state on `people`.
- **Cross-org attachment is refused with a test proving it** — the `person_id` path verifies `org_id` before use, and the test builds a second org to confirm the 422. This is the boundary check reviews most often find missing.
- **Both organizer doors mint people through one statement.** Extracting `newPersonStatement` and rewiring `createSubmission` through it means a person's shape can no longer depend on which screen created them — a genuine simplification bundled with the feature rather than left as drift.
- **The submitter guard is enforced at both layers and explained at both layers**: the server 422s, the UI never renders a Remove button on the submitter row, and the reserved `min-height: 25px` on `.record-person-foot` keeps that row the same height as removable ones — a direct application of the project's "elements never jump" rule.
- **`can_edit_participants` is server-computed from the same grant the routes enforce**, so the UI cannot show a control that would 403 — consistent with the existing `can_edit_content` pattern, with the status-independence decision (participants editable on accepted records, which is exactly when co-presenters materialize) argued in place.
- **Error handling on the record is deliberately not `act`**: `participantWrite` reports inline instead of replacing the record with an error screen, with the reasoning documented. Small decision, correctly made.
- **Tests verify behavior, not implementation**: every assertion reads back through a fresh request; the max_speakers test asserts both the clamped public value (2) *and* that the stored configuration remains 4, pinning that this is presentation-layer honesty rather than silent data rewriting.
- The idempotent-add, remove-again, submitter-protection, and cross-org cases give the two routes edge coverage most first-pass features skip.
