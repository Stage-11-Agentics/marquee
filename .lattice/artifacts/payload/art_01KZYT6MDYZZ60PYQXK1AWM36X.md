# Code Review: MRQ-175 — Bulk send ships raw template syntax

Reviewed branch `MRQ-175-impl` (commits `98c8facd` + `448f6cc2`) in
`Marquee-worktrees/MRQ-175-impl` against the plan and acceptance criteria.

## 1. Verdict

**PASS**

## 2. Summary

The implementation puts the validation exactly where the ticket demanded — the compose/save
and queue paths, not the renderer — with a single shared vocabulary
(`src/lib/mail-merge-fields.ts`) that feeds the palette, the UI warning, the route guards,
and a last-line assert inside `enqueueBulkReminder`. All four acceptance criteria are met
and verified: the changed test files pass on the branch, the full suite passes
(`pass-over-budget` on elapsed time only, under fleet contention), `tsc --noEmit` is clean,
and I confirmed the regression tests fail on the pre-change base commit (3 of 4 fail;
the 4th is the pin-existing-behavior test, which passes on both sides by design). The one
risk I chased hardest — the allowlist rejecting tokens the product already uses — is a
non-issue: `{{auth.link}}`, `{{reviewer.first_name}}`, `{{review.outstanding}}`, and
`{{round.name}}` exist only in templates outside `COMMUNICATION_TEMPLATE_KEYS`, and their
send paths (`enqueueOutbox` / `enqueueTrigger`) deliberately bypass the new guard. Remaining
findings are minor.

## 3. Issues

**[MINOR] src/routes/comms.routes.ts:398 (updateTemplate) — An `enabled`-only PATCH is blocked by a legacy-bad body**
`rejectUnknownMergeFields(nextSubject, nextBody)` runs on `body.x ?? current.x`, so a PATCH
that only toggles `enabled` on a stored template whose body already contains an unknown
token (possible only for rows saved before this change) returns 400 with "…is not a merge
field" — a disorienting refusal when the operator is trying to *turn off* the bad template,
which is the safest thing they could do. The queue-time guard already protects sends, so
save-time validation doesn't need to hold pre-existing content hostage.
**Fix:** Validate only when content is actually changing:
`if (body.subject !== undefined || body.body_md !== undefined) rejectUnknownMergeFields(nextSubject, nextBody);`

**[MINOR] src/jobs/mail/triggers.ts:50 — `UnknownMergeFieldsError` escapes as a 500 on the portal decline path**
`enqueueBulkReminder` throws a plain `Error` subclass, not an `ApiError`. Both comms routes
pre-validate so the assert is unreachable there, but
`notifyProgramLeadsOfDecline` (`src/routes/portal.routes.ts:460`) passes `templateKey:
"custom"` with no subject/body, so the assert validates the event's *stored* custom
template. A legacy custom template with an unknown token would make a speaker's decline
action 500 instead of declining-with-a-quiet-notification-failure. Edge case (requires a
pre-MRQ-175 bad row), but the failure lands on the wrong actor: the speaker can't fix a
template.
**Fix:** Either map `UnknownMergeFieldsError` to a 4xx in the API error middleware, or
try/catch around the notification in `notifyProgramLeadsOfDecline` so a bad template never
blocks the decline itself.

**[MINOR] src/routes/comms.routes.ts:720-725 — Duplicate `findTemplate` + validation per send**
`sendComms` fetches and validates the template, then `enqueueBulkReminder` immediately
re-fetches and re-validates it (and on the ad-hoc path fetches `reminder_generic` purely to
ignore it). One extra D1 query per send. Keeping the queue-level assert as the last line of
defense is defensible — it's what makes the fourth contract test meaningful — so this is an
efficiency nit, not a design flaw.
**Fix:** Acceptable as-is; if trimmed later, let callers pass the already-fetched template
into `enqueueBulkReminder` rather than removing the assert.

**[MINOR] src/lib/mail-merge-fields.ts:276-296 — The palette now advertises fields the composer path never populates**
`form.closes_at`, `decision.feedback`, `decision.resulting_status`,
`decision.recommendation`, and `message.body` are trigger-path fields;
`mergeDataForRecipient` (the composer/bulk-send data source) never provides them. Because
palette set == validation set (which the ticket explicitly required, so this is a
consequence of following the plan, not a deviation), an operator can now write
`{{decision.feedback}}` into an ad-hoc bulk send and it validates — then renders literally
for all 81 recipients, the original failure mode wearing a known name. The preview still
shows the literal token (the designed warning), so the honest surface catches it, but the
palette actively suggests these fields in a context where they can never resolve.
**Fix:** Nothing required now. A follow-up could tag each field with the contexts it
resolves in and have the palette render only composer-resolvable fields while the validator
accepts the full vocabulary — one list, two views, no drift.

**[NIT] src/lib/mail-merge-fields.ts:301 — Shared stateful `/g` regex**
`MERGE_TOKEN_PATTERN` is a module-level global-flagged regex shared across render and
extraction. `String.replace` resets `lastIndex` so current usage is safe, but any future
`.test()`/`.exec()` against it inherits a classic stateful-regex bug. A comment ("replace
only — /g makes test/exec stateful") or exporting a factory would pin it.

## 4. Positive Observations

- **The layering is exactly right.** `mergeTemplate` is untouched except for importing the
  shared pattern; the deliberate literal-passthrough survives, and the contract test
  ("known missing values remain literal") pins it against future erosion — precisely what
  the ticket asked for.
- **One vocabulary, no drift.** Deleting the hardcoded `MERGE_FIELDS` copy from
  `CommsScreen.tsx` and importing the lib means the palette, the UI warning, the route
  guards, and the queue assert cannot disagree — and the node test asserts
  `doesNotMatch(source, /const MERGE_FIELDS/)` so the private copy can't quietly come back.
- **Defense in depth done properly.** Save-time (create/update template), send-time (both
  comms routes, org route), queue-time (`enqueueBulkReminder`), and UI-time
  (`canQueue`, `saveTemplate`, `queueMessage` guards) all check — while the trigger and
  auth mail paths, whose templates legitimately use fields outside the composer vocabulary,
  are correctly left alone. I traced all three `enqueueBulkReminder` callers and both
  bypass paths to confirm this.
- **The error message names the offender verbatim** (`{{portal.link}} is not a merge
  field. Available fields are listed under MERGE FIELDS.`) with correct singular/plural
  handling — requirement 2, met to the letter.
- **Elements never jump.** The warning div is always rendered at a fixed `height: 58px`
  with `visibility: hidden` when clean, `role="alert"`/`aria-live` when not — the composer
  textarea never moves under the operator's cursor.
- **The `updateTemplate` refactor quietly fixed a pre-existing wart:** the unknown-key
  check used to run *after* the fallback row INSERT, leaving an orphan row behind on a bad
  PATCH; it now runs before any write.
- **Test quality is high.** Four contract tests cover refuse-by-name, known-field success,
  save-time refusal (both create and default-template PATCH), and stored-template
  revalidation at queue time — each asserting on outbox/template row counts, not just
  status codes, so "refused" provably means "nothing persisted." The rewritten AC-261 test
  keeps its preview-fidelity assertions while flipping delivery to the new contract.
