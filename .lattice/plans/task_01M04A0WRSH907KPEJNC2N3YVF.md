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

## Plan-Review Cycle 1 Resolutions (AUTHORITATIVE)

Source review: art_01M04TDSS6QSCDCM2GH76K92GQ, reviewed at plan-only head a942f5e7d6af15bbc46f1de7af0b4100f5e94aa9, verdict FAIL (plan-level). These resolutions are binding for implementation and supersede earlier plan text wherever they conflict. This is a plan amendment only; it does not authorize feature code or a Lattice status transition.

### A. Security-safe draft resume binding

The earlier proposal to add a target-submission column to magic_links, rebuild a CHECK-constrained table, or otherwise change the magic_links schema is withdrawn. Use the existing server-minted magic_links.redirect_to precedent; no new column, table, or migration/rebuild is needed for the binding.

At reminder creation, mint a draft_resume magic link whose server-owned redirect_to encodes the canonical public-form target and the target submission ID. The public email URL carries the returned token as the resume capability. The redirect target is never accepted from the caller and is never used as an authorization decision until the token has been read and authenticated.

The public-form resolver must call readMagicLink without consuming the row and require all of the following:

- purpose is exactly draft_resume;
- the magic-link row is unexpired and otherwise live;
- the server-minted redirect_to parses as the expected canonical public-form route and yields one submission ID;
- the target submission still exists, belongs to the target form/event, has status draft, and has submitter_person_id equal to the magic-link person_id;
- the form/event identity agrees with the magic-link event_id, the requested public-form slug agrees with the encoded target, and the form is open/actionable at the time of the request.

Only the public-form draft routes may use this resolver for load, autosave, upload, and submit. The token must not enter a portal/session path. Remove draft_resume from the session-producing purpose tuple in src/routes/auth.routes.ts and add a direct test proving a draft_resume token cannot exchange into a session. Keep the original submissions.resume_token_hash capability valid and independent.

No linkless fallback is permitted. The reusable behavior is implemented by read-only resolution through readMagicLink; do not consume the row on GET, autosave, upload, or submit. The existing long TTL is only a TTL; reusability is a new resolver behavior, not an existing draft_resume property.

### B. Recipient and idempotency grain

The specific selector joins the draft submission directly to exactly submissions.submitter_person_id and that person's email/name. It must not join participations to determine recipients. The original resume capability and the reminder credential belong to the submitter who created the draft.

Add a regression fixture with one draft and a second speaker participation. The scan must produce exactly one draft-close outbox row addressed to submissions.submitter_person_id. The idempotency registry remains submission-grain, and no participation fan-out is allowed.

The exact qualifying rule is: submission status draft; form status open; form closes_at non-null; form reminder_offset_hours non-null; current time inside the existing offset-to-close window and before close. Missing-field count does not gate the mail. It is rendered as condition-aware metadata, including an empty list when no applicable fields are missing; the Drafts queue may continue to filter its own attention rows to missing_fields.length > 0.

For each candidate, check the final outbox idempotency key with SELECT before minting a credential. If no row exists, mint the bound redirect_to draft_resume token, then insert the fully rendered outbox row through the existing insert-and-catch uniqueness path. Do not add a claim placeholder, outbox UPDATE completion step, or mid-flight queue state. If two scans race, accept only the expiring, never-mailed orphan magic link from the losing insert as the bounded consequence; the outbox still has exactly one durable mail row.

A disabled template is checked before minting. A disabled trigger therefore creates neither an outbox row nor a magic link.

### C. Editable trigger merge field and shared trigger authority

The editable trigger template uses draft.resume_link, not auth.link. Add draft.resume_link to both MERGE_FIELDS and COMMUNICATION_MERGE_FIELDS, with a test that proves it is a known editable field and that the generated value is populated only for draft_close_reminder. It must contain only the server-minted, submission-bound public-form URL for that candidate; it must never expose the original raw token through unrelated communication data.

Non-trigger communication contexts must retain safe unpopulated behavior for this known field and must not synthesize a link for another recipient or template. Add the communication-template save/edit/preview round-trip assertion so an organizer can keep the link-bearing token in the editable trigger without receiving a 400 or being pushed toward a linkless body.

Update src/ui/comms/CommsScreen.tsx so trigger classification, automated-section placement, and the enabled denominator use the shared TRIGGER_TEMPLATE_KEYS authority. Prefer importing the shared authority. If module layering prevents a direct import from the mail job module, move the key list to one neutral shared module consumed by both sides; do not create a second literal trigger-key list. The new key must be classified as the eighth automated trigger.

### D. Prospective exclusivity

Exclusivity is evaluated prospectively at each scan. When a person currently has both a submitted participation and a live draft on the same form, the generic selector excludes that person and the specific selector produces only the draft-close reminder. A generic message already sent is never retractable.

Document and test both ordering transitions:

- generic sent at an earlier scan, then a draft is created: the later scan may send the specific reminder; the earlier generic row remains;
- specific sent at an earlier scan, then the draft is submitted or withdrawn: a later scan may send the generic reminder if its own current candidate predicate and idempotency permit it; the earlier specific row remains.

These are intentional prospective semantics, not a failure of “one mail per draft.” The transition tests must state the observed outbox rows and template keys rather than asserting historical retraction.

### E. Absolute-date conflict and existing assertions

The ticket description's organizer-queue phrase “Closes in N days” conflicts with the standing absolute-date ruling. The standing ruling wins for both mail and the organizer Drafts queue. Record this as an explicit resolved conflict in the implementation and render absolute conference-timezone-aware labels, including explicit no-date and closed states. No relative day-count copy is permitted.

Name the existing assertions that change when the trigger is added: update the mail template-manifest count from 9 to 10, update the automated-trigger assertion from seven to eight, and add the CommsScreen classification/count coverage. Keep the deferred SPEC trigger enumeration named as known contract drift for consolidation; do not edit SPEC.md in this ticket.

### F. Concrete implementation and validation surface

The implementation plan's file surface now explicitly includes:

- src/jobs/mail/schedule.ts, src/jobs/mail/triggers.ts, src/jobs/mail/consumer.ts, src/jobs/mail/outbox.ts, src/jobs/mail/idempotency.ts, and src/jobs/mail/templates.ts;
- src/lib/mail-merge-fields.ts and the shared trigger-key authority used by src/ui/comms/CommsScreen.tsx;
- src/routes/public-form.shared.ts and src/routes/auth.routes.ts;
- the existing public-form creation/copy module and Drafts queue query/API/UI modules;
- focused mail, public-form/auth, communication-editor, and Drafts queue tests.

No magic_links schema/type migration is part of the binding design. The direct non-session auth test, submitter-only recipient test, second-speaker one-row test, known editable draft.resume_link round-trip, SELECT/mint/insert race behavior, prospective exclusivity transitions, absolute-date conflict, and 9-to-10/7-to-8 assertion updates are required before implementation can claim the plan's corresponding invariants.

MRQ-247 remains a plan-only hold after this amendment: keep Lattice backlog, do not write feature code, do not launch or auto-fire Cycle 2 review from this turn, and wait for the queued sole-slot review to consume this pushed amendment.

## Plan-Review Cycle 2 Resolutions (AUTHORITATIVE)

Source review: art_01M04V384Z5BH89Z66MJ7E3PHB, reviewed at plan-only head c58b059e8f093e8a57d0397c9c0662552d0c47bf, verdict FAIL (plan-level). These resolutions are binding for implementation and supersede earlier plan text wherever they conflict. This is a plan amendment only; it does not authorize feature code, a status transition, or a reviewer launch.

### A. Unconditional identity binding on reads; state gates only on writes

The redirect-bound credential keeps the existing server-minted identity checks on every read: purpose exactly draft_resume, an unexpired/live magic-link row, a canonical server-owned redirect_to yielding one submission ID, and agreement among the redirect target, requested public-form form/event, magic-link event_id, magic-link person_id, and submissions.submitter_person_id. The identity binding is unconditional regardless of the submission's current lifecycle state.

A valid bound reminder token must continue to resolve its target submission for the draft, submitted, outcome, and closed-form states. Read resolution must not require status = draft or form open/actionable. This preserves the existing public-form behavior in which the same capability renders submitted/outcome/receipt state and can be followed after a call closes. A closed-form read through the reminder token renders the honest closed state and retained answers, not resumeMissed.

Status and form-open/actionable checks are write gates only:

- autosave requires the target submission to remain draft and the form to be open/actionable;
- public upload authorization requires the target submission to remain draft and the form to be open/actionable;
- submit requires the target submission to remain draft and the form to be open/actionable.

After a successful submit through the reminder token, the same token must resolve the submitted state, the post-submit success screen, and the confirmation email's follow-up link. Add an integration test that submits through the reminder URL and follows that confirmation link to a live submitted/receipt page. Add a closed-form-after-reminder test that reads the token and sees the honest closed state while write attempts are rejected.

Add src/routes/uploads.routes.ts to the binding surface. Route public upload authorization through the same shared resume resolver used by the public form, while retaining support for the original raw submissions.resume_token_hash token. Add an upload-through-reminder-token test covering the presign/sign authorization path. Uploads must not compare the reminder magic token directly to resume_token_hash.

Keep draft_resume removed from the session-producing auth exchange tuple and retain the direct non-session test. The reminder token is a public-form capability only; it never creates a portal/session credential.

### B. Explicitly superseded design text and the valid idempotency sequence

The following earlier proposals are struck and must not be implemented:

- ~~Add a nullable target-submission column to magic_links, rebuild the CHECK-constrained table, or add any schema binding migration.~~ SUPERSEDED. The binding is encoded only in the existing server-minted redirect_to; no new column, table, migration, or rebuild.
- ~~Reserve a placeholder outbox row, mint later, then UPDATE/complete the rendered row.~~ SUPERSEDED. There is no claim/mint/complete outbox mutation or mid-flight placeholder state.

The only valid reminder admission sequence is: check the fully-derived stable outbox idempotency key with SELECT; if absent, mint the bound redirect_to draft_resume token; insert the fully rendered outbox row and catch the unique-key race. A true losing race may leave one expiring, never-mailed orphan token, but it must never create a second durable mail row or require an outbox UPDATE.

### C. Draft queue persistence and intentional complete-draft divergence

Add src/lib/saved-views.ts to the implementation surface. Append the stable close/deadline column ID to the built-in Drafts needing attention view; never rename existing persisted column IDs. Round-trip an existing saved view created before the new column was introduced and prove that its stored columns remain valid while the built-in view gains the new stable ID.

The reminder and queue intentionally have different populations: the mail selector qualifies every status=draft row meeting the open-form, close-date, offset, and time-window rule, even when its applicable missing-field list is empty; the Drafts needing attention queue continues to show only rows with missing_fields.length > 0. A complete-but-unsubmitted draft therefore receives one specific reminder and contributes zero rows to the attention queue. Record and test this as intentional behavior, not a query mismatch.

### D. Editable validator field, palette exclusion, and manual-send refusal

draft.resume_link remains a known communication validator field in MERGE_FIELDS and COMMUNICATION_MERGE_FIELDS so an organizer can edit and save the draft_close_reminder trigger template. The generated value is populated only for the scheduler's draft_close_reminder context and is the server-minted, submission-bound public-form URL.

Exclude draft.resume_link from the general CommsScreen composer palette. It is a context-bound field, not a token an organizer should insert into arbitrary messages. The trigger editor still accepts and round-trips it because the validator set includes it.

Reject ad-hoc and bulk/manual sends whose template_key is draft_close_reminder before rendering or enqueueing: those paths have no draft-bound submission context and must never send literal {{draft.resume_link}} text or a link belonging to another recipient. Add tests for trigger editor save/round-trip, palette exclusion, and manual/bulk rejection. The trigger scheduler remains the only path that can populate and send this link-bearing template.

### E. Access revocation and idempotency inventory

Access revocation intentionally consumes the reminder magic-link row by setting used_at when the person loses event access. That invalidates the reminder capability, and the result is correct. The original raw resume_token_hash capability remains stored and is not rewritten by this feature; assert both the revoked reminder failure and the preserved original-token behavior in tests.

Add IDEMPOTENCY_REGISTRY.draftCloseReminder(submissionId) to tests/unit/mail-idempotency-registry.test.ts's hand-maintained inventory. Document that its entity value may equal draftResume or formConfirmation entity values; buildIdempotencyKey separates them by templateKey, so the distinct template keys preserve the intended grain without inventing another entity ID.

### F. Creation-time copy and named assertion updates

The creation-time close-date copy is composed by the inline text/html strings in src/routes/public-form.routes.ts, not solely by src/lib/auth/draft-resume-copy.ts. Update those inline strings using the conference timezone already returned by the public-form load path; retain the subject constant module only for the subject.

The implementation must name and update the existing mail manifest count 9 to 10, automated-trigger assertion seven to eight, CommsScreen trigger classification/count, and the idempotency inventory. The SPEC.md shipped-trigger enumeration remains deferred contract drift for consolidation; do not edit SPEC.md in this ticket.

The focused validation set now also includes: submit-through-reminder then confirmation-follow; closed-form read versus write rejection; upload-through-reminder; old saved-view round-trip; complete-draft mail with zero queue row; trigger editor round-trip; palette exclusion; manual/bulk trigger refusal; reminder access revocation with original-token survival; and the idempotency template-key separation assertion.

MRQ-247 remains a plan-only hold after this amendment: keep Lattice backlog, do not write feature code, do not launch Cycle 3 review from this turn, and wait for the queued sole-slot review to consume this pushed amendment.
