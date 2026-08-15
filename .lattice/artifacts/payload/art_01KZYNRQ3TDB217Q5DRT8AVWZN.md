# Code Review: MRQ-173

## 1. Verdict

**PASS**

## 2. Summary

All three intake items are addressed and the implementation is unusually well-verified against its own claims: the recipient-resolution logic in `decisionRecipient()` is checked against the exact `ORDER BY` used by the real sender (`loadSubmission` in `src/jobs/cascade/decisions.ts`), the `decision_sends` query's `entity_id` matching is checked against every call site that writes decision-mail outbox rows (original send uses `submission.id`, resend and bulk-notify use `submission_decisions.id`), and the reused index (`idx_outbox_entity_status`) and CSS tokens (`--ink-soft`, `.portal-seat-actions`, `.portal-button.secondary`) all already exist. The 404-as-truth fix for the portal is scoped correctly — `/api/v1/me/portal` throws `ApiError.notFound("conference not found")` in exactly one place, precisely when an account holds neither a speaker nor a submitter seat, so mapping `error.status === 404` to `NoSeatNotice` cannot misfire on some other 404. No issues rise to blocking severity.

## 3. Issues

No issues found.

Two sub-critical observations that don't block merge, listed for awareness:

**[MINOR] src/routes/submission-record.routes.ts:135 (`DECISION_SEND_LIMIT`) — capped count is presented as an exact total**
When a record has been resent more than 6 times, `record.decision_sends.length` is silently capped at 6 by the `LIMIT ${DECISION_SEND_LIMIT}` in the query, but the UI's `Review previous sends (${record.decision_sends.length})` in `SubmissionRecordPage.tsx:416` renders that capped length as if it were the true count. An organizer with 10 sends on record sees "(6)" with no indication more exist. The docstring at `submission-record.routes.ts:129-134` explicitly accepts this as a tradeoff ("a delivery problem the outbox surface should answer, not a history the organizer reads on the record"), so this is a deliberate scope cut rather than an oversight — flagging only in case that tradeoff wasn't meant to extend to the displayed count itself.
**Fix (optional):** if exactness matters, either drop the count from the summary label or fetch `COUNT(*)` separately and show `"6 of 11"`.

**[MINOR] src/lib/decision-history.ts:80-91 (`decisionRecipient`) — reuses a count-shaped helper for a sort key**
`count(left.position) - count(right.position)` repurposes `count()`, whose name and existing doc comment ("count of cancelled things") signal a non-negative tally, not a general numeric coercion for sorting. It happens to be correct here only because participant `position` values are always non-negative in every insert path in this codebase (`public-form.routes.ts:268`, `submission-record.routes.ts:1007`) and because the input array is already pre-sorted by `(position, id)` from SQL, so JS's stable sort preserves the sender's `id ASC` tie-break implicitly. Nothing is wrong today, but a reader has to reconstruct that chain of invariants to trust the comparator — a `position(value)` alias (even as a one-line re-export) would make the intent legible without duplicating the coercion logic.
**Fix (optional):** none required; consider a differently-named wrapper if this function gets touched again.

## 4. Positive Observations

- **Cross-checked against the real sender, not just against itself.** `decisionRecipient()` mirrors `loadSubmission`'s SQL `ORDER BY`, and the test suite (`record-decision-delivery.test.ts`) directly encodes that mirroring ("Mirrors loadSubmission's ORDER BY..."). I independently traced the SQL and the JS comparator and they agree, including a fallback edge case in the SQL (`COALESCE(..., submitter.id)`) that turns out to be unreachable because every submission-creation path unconditionally inserts a `role='submitter'` participation row — so the simpler JS-only implementation is provably equivalent, not just coincidentally close.
- **The `entity_id` query in `loadRecord` was built with real knowledge of the write side.** It matches `submission.id` (original decide) OR any `submission_decisions.id` for this submission (resend, bulk-notify), and I confirmed both are the only two `entityId` shapes ever written for `template_key IN ('acceptance','rejection')` outbox rows across `decisions.ts`.
- **Delivery-state precedence in `sendOutcome()` is correct and matches the codebase's own stated invariant** in `mail-failure.ts` ("Nothing here may say delivered... a provider bounce never enters this classifier") — the diff checks `delivery_state` before `status`, so a `sent`-but-hard-bounced row correctly renders "Bounced" instead of the falsely reassuring "Sent".
- **Reuses existing design tokens and CSS classes instead of inventing new ones** — `.portal-seat-actions`, `.portal-button.secondary`, `--ink-soft`, and the `Chip` tone union (`"" | "success" | "warning" | "alarm"`) all already existed and are used exactly as elsewhere in the codebase.
- **Good test coverage on the actual regression risk.** The integration test (`recovery.MRQ-80.test.ts`) exercises a real resend through the API (not a mock), seeds an intentionally-mismatched old/new address, and asserts ordering (`created_at DESC`), the corrected recipient, and that unset delivery state renders as `unknown` rather than a fabricated value.
- **Accessibility details are correct, not just present**: `aria-expanded`/`aria-controls` on `ReversalRow`'s toggle button are verified via `preact-render-to-string` output, and the collapsed detail panel is asserted to carry the `hidden` attribute (removed from the a11y tree), not just visually hidden.
- **No dead ends**: every new terminal UI state (`NoSeatNotice`) offers at least one working route out, and the test suite explicitly checks for that ("every state has a way out"), consistent with this project's walkthrough-loop requirement.
