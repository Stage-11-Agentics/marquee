# MRQ-247: A saved draft gets one honest nudge before the call closes

## Binding context

- Ticket: MRQ-247, standalone implementation delegator.
- Actor: agent:delegator-mrq-247.
- Authoritative board: /Users/atin/Projects/Stage11/deployments/Marquee.
- Implementation worktree: /Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-247-draft-nudge.
- Branch: mrq-247-draft-nudge.
- Launch base: github/main at 52bb485f105e0392fe475332b87cbb48dbcee832.
- Adoption Orchestrator: surface:513, mailbox adoption-orchestrator.
- Merge Captain: surface:512, mailbox merge-captain.
- This plan is being prepared while MRQ-245 Plan Cycle 3 owns the sole reviewer slot. The ticket must remain in Lattice backlog until surface:513 explicitly releases that slot. Do not transition it to a plan-review-firing status and do not launch a reviewer during this hold.

The binding product and project constraints are DESIGN.md, PHILOSOPHY.md, BUILDPLAN.md, EVALUATION.md, sequence/USER_STORIES.md, and sequence/run-state.md. The implementation must preserve the existing AC-125/AC-127 mail-trigger lineage, AC-249 Drafts queue behavior, and the AC-314 idempotency/auth seam. Do not mint new US or AC identifiers and do not edit the contract documents in this ticket.

## Intent and invariants

A speaker who saved an unfinished draft should receive one useful, honest nudge while the call is still open. The message must name the absolute close date, say what is still missing when that information is available, and provide a working private resume link. The existing creation-time resume message must also name the absolute close date.

The following invariants define the implementation:

1. The feature is standalone. MRQ-227's cancelled reminder-ladder/rung-editor machinery is out of scope.
2. The existing hourly runMailSchedule fan-out is the only scheduler. Add a third fan-out entry; do not add a cron or second sweep.
3. Candidate selection is late-bound at scan time. A draft that was submitted, withdrawn, deleted, moved to a non-actionable form state, given no close date, or moved outside the reminder window must not enqueue.
4. The specific reminder is at submission grain: one outbox message per draft/person for the lifetime of that draft. Use the existing outbox uniqueness and the typed idempotency registry, with the submission ID as the business entity.
5. A person with a live draft on a form receives the specific draft reminder in preference to the generic form-closing reminder for that form. A person without a live draft retains the existing generic behavior. Do not otherwise change the adjacent existing behavior in which already-submitted participation rows can receive the generic reminder.
6. Every path is demo-safe and outbox-backed. No Resend call or live delivery is part of local validation.
7. All user-facing close-date copy is absolute and conference-timezone-aware. Do not ship relative “closes in N days” wording.
8. Missing-field computation remains condition-aware and server-side. The queue and mail selector must use the same applicability rules.
9. A disabled template is inert: no outbox row and no resume credential minted for that candidate.
10. The original hashed resume token remains valid. A reminder credential must coexist with it rather than replacing or invalidating it.

## Design checkpoint: draft-resume credential safety

Research found that the existing vocabulary is present: draft_resume is already a MAGIC_LINK_PURPOSE, has a long TTL, and is available to the auth-mail template set. The existing semantics are not safe to use blindly for this feature, however:

- magic_links currently has no explicit submission binding;
- /api/v1/auth/exchange currently accepts draft_resume among the session-producing purposes; and
- the existing public-form resolver understands the original hashed resume token, not a draft_resume magic-link token.

Therefore, do not simply mint a draft_resume row and send its token as a public-form resume URL. That would make the credential ambiguous and could turn a reminder link into a normal person session.

The proposed safe seam, which must be explicitly accepted by surface:513 before implementation, is:

- Add an explicit nullable target submission binding to magic_links for the draft_resume purpose, with the migration/schema/type validation restricted to that purpose. Do not add a new table or a new purpose.
- Mint the reminder credential with event, person, form target, and submission binding. Resolve it through the public-form resume path as a reusable capability, checking purpose, event, person, form, submission, live draft status, and the canonical form target on every request. Keep the original resume_token_hash path unchanged and valid.
- Keep draft_resume out of the session-producing auth exchange. It is a public-form resume capability, not a portal-login credential. A draft_resume token must never create an organizer or speaker session through /auth/exchange.
- Use the existing long-lived/reusable draft_resume semantics only for the specifically bound draft. Do not consume it on the first GET, because the same link must support loading, autosave, and submission until the draft changes state or the form closes.
- Mint only after template enablement and an idempotent outbox claim have admitted the one reminder. Duplicate scans must not mint a new credential. The ordinary enqueueOutbox call is not sufficient if it creates the credential before discovering a duplicate; add a claim/mint/complete helper or an equivalent D1-safe implementation.
- If surface:513 rejects the additive binding or identifies an existing security contract that makes it unsafe, stop at that seam and escalate for a revised design. Do not silently fall back to a linkless reminder.

This checkpoint is intentionally recorded before implementation because it changes the auth/public-form boundary. No implementation should begin until the orchestrator has accepted the seam or supplied a replacement.

## Implementation plan

### 1. Establish shared draft metadata

Files: src/routes/submissions.queries.ts, and the smallest shared helper location already used by the form-condition evaluator.

- Extract or expose the existing condition-aware missing-field calculation used by addDraftMetadata so the Drafts queue and the mail selector cannot diverge.
- Preserve the current queue semantics: only applicable unanswered fields count, hidden conditional fields do not, and the live-count/role-access behavior remains unchanged.
- Define the mail candidate shape around submission_id, form_id, event_id, submitter person/email/name, submission title, absolute close timestamp/label, timezone, and the computed missing fields.
- Use submission.title for the draft title; it is an existing merge field and does not justify a parallel draft.title token.

### 2. Add the specific scheduler selector

Files: src/jobs/mail/schedule.ts and its focused integration tests.

- Add selectDraftCloseReminderCandidates(db, now) beside selectPreCloseReminderCandidates.
- Reuse the form's existing reminder_offset_hours window and the current form/event timezone formatting. Require an open form, non-null closes_at, a still-open window, and s.status = 'draft'.
- Resolve the recipient as the draft submitter/person represented by the draft's speaker/submitter participation, using the same person identity as the outbox recipient. Do not create a new roster or speaker model.
- Join/fetch the answers and form fields needed for the shared condition-aware missing-field calculation. Do not push incomplete-field logic into the browser.
- Keep the query late-bound: no precomputed “will remind later” flag, no persisted rung, and no enqueue if the row changes state before the hourly scan.
- Return an absolute close-date value/label in the conference timezone, the title, and a deterministic missing-field list suitable for the template.

### 3. Register the trigger and merge data

Files: src/jobs/mail/templates.ts, src/lib/mail-merge-fields.ts, src/jobs/mail/idempotency.ts, and mail tests.

- Add draft_close_reminder to TRIGGER_TEMPLATE_KEYS and DEFAULT_TEMPLATES so the existing communication-template toggle and editing round-trip cover it.
- The default copy must be concise and operational: identify the saved draft, name the absolute close date, list applicable missing fields, and provide the private resume link. Do not include relative day counts or a linkless fallback.
- Reuse form.closes_at and auth.link. Add only the smallest new merge field needed for the condition-aware list, such as draft.missing_fields, with stable rendering for an empty list. Do not duplicate submission.title as draft.title.
- Add IDEMPOTENCY_REGISTRY.draftCloseReminder(submissionId), documented as one reminder forever per submission/person. Pass that typed identity through the existing trigger/outbox path; do not hand-assemble a raw idempotency entity string.
- Preserve the outbox's demo-safe default and existing provider choke point.

### 4. Enqueue through the existing hourly fan-out

Files: src/jobs/mail/triggers.ts, src/jobs/mail/consumer.ts, and outbox/auth/public-form modules as required by the approved checkpoint.

- Add enqueueDraftCloseReminderRows(db, now) as the third result array in runMailSchedule. The consumer must send only inserted rows, exactly as it does for the existing trigger families.
- Check the trigger template is enabled before minting a reminder credential. Disabled templates must return no candidate/outbox work and no new magic link.
- Implement the idempotent claim/mint/complete path required by the checkpoint. The stable submission-grain outbox key is the authority for “one mail forever”; a duplicate scan returns the existing result without minting another link.
- Mint the bound reusable draft_resume credential only for the winning claim, render the canonical public-form resume URL, and leave the original hashed resume token untouched.
- Re-run candidates after submission, withdrawal, close-date removal, form closure/disablement, and template disablement in tests to prove the selector does not enqueue stale work.

### 5. Make generic pre-close mail exclusive

Files: src/jobs/mail/schedule.ts and mail integration tests.

- Add a NOT EXISTS predicate to selectPreCloseReminderCandidates that excludes a recipient when the same form has a live draft for that person.
- Keep the existing generic candidate's entity grain, template, timing, and recipient grouping otherwise unchanged.
- Assert the key truth table: submitted-only recipient gets generic pre-close mail; draft-only recipient gets specific mail; recipient with both gets only specific mail; unrelated recipients still get their existing generic mail.

### 6. Name the deadline in creation-time resume mail

Files: src/routes/public-form.routes.ts, src/lib/auth/draft-resume-copy.ts or the existing copy/merge helper, and public-form integration tests.

- When a draft is first created, render the form close date with the event/conference timezone and include it in the existing draft_resume creation message.
- Preserve the current raw resume-token capability and its idempotent outbox behavior. This change only makes the close state honest; it must not replace the original token with the reminder credential.
- For a form with no close date, use explicit no-deadline copy rather than inventing a date or a relative promise.

### 7. Give the Drafts queue close truth

Files: src/routes/submissions.queries.ts, src/api/submissions.ts, src/routes/submissions.routes.ts, src/lib/submission-columns.ts, src/ui/submissions/SubmissionsPage.tsx, and Drafts queue tests.

- Join drafts to forms and expose server-derived close metadata in the list response, including a timezone-correct absolute close label, whether the form is closed, and whether a queue action remains available. Keep null close dates explicit.
- Add a stable deadline/close column to the immutable built-in Drafts needing attention view and render it as an actual cell. Existing saved-view serialization, column validation, and role-gated access must continue to round-trip.
- Render open rows as an absolute “Closes <date>” state, no-date rows as “No close date,” and closed rows as “Closed <date> — no longer actionable.” Do not use “Closes in N days.”
- Keep closed incomplete drafts visible for operator accountability, but do not offer a queue-provided resume/edit action that would imply the public call is still actionable. Do not broaden this ticket into unrelated organizer record-edit policy.
- Preserve the existing queue count and condition-aware missing-field behavior.

### 8. Validate the whole seam after the reviewer hold releases

No reviewer, status transition, full gate, browser run, live-site check, deployment, or Resend delivery is authorized during the current hold.

After surface:513 explicitly releases the serialized plan-review slot:

- Run focused mail tests covering the trigger key/default, absolute merge data, template toggle, selector window, late binding, generic exclusivity, demo-safe outbox, and double-scan idempotency.
- Run public-form tests covering close-date creation copy, original-token continuity, bound reminder-token load/autosave/submit, closed-form rejection, and rejection of draft_resume as a session exchange credential.
- Run Drafts queue tests covering close-date/no-date/closed labels, actionability, saved-column round-trip, conditional missing fields, and role access.
- Run the repository's required gate under the merge-captain serialization rule. A slow pass is not a failure; a fail or timeout is blocking evidence.
- Use browser/runtime validation only with explicit operator approval. No deployment is implied by merge.

## Validation map

| Invariant | Evidence |
| --- | --- |
| One reminder per draft forever | Two scheduler scans and a unique outbox row keyed through draftCloseReminder(submission_id); inserted count is one. |
| Specific beats generic | One form with submitted-only, draft-only, and both-state recipients; inspect outbox template keys and recipient rows. |
| Late-bound state | Mutate draft to submitted/withdrawn, remove close date, close/disable form, or disable template before scan; assert no enqueue. |
| Honest deadline | Assert rendered mail and Drafts queue cell contain the absolute conference-timezone date, with explicit no-date/closed states. |
| Missing fields | Seed hidden and revealed conditional fields; assert only applicable unanswered fields appear in both queue and mail. |
| Resume security | Original hash still works; reminder token is bound/reusable only for the target draft/form/person; auth exchange cannot turn it into a session. |
| Demo safety | Outbox rows are queued under the existing demo-safe mode; no network/provider call is made. |
| Existing contracts | AC-125/127/249/314 regression coverage remains green; no new US/AC IDs or contract-doc edits. |

## Cut line and handoff

The minimum shippable change is the approved, security-safe draft_resume seam plus the specific hourly selector/template/idempotency path, generic pre-close exclusivity, and creation-time close-date copy. The Drafts queue close cell is part of the requested completion, not a substitute for the mail path.

This plan does not authorize implementation while the reviewer slot is held. Keep MRQ-247 in backlog, do not launch a reviewer, and wait for an explicit release from surface:513. At release, the next durable receipts are: accepted plan-review decision, plan commit pushed from this worktree, focused test evidence, serialized full-gate receipt, and only then any status transition required by the orchestrator.
