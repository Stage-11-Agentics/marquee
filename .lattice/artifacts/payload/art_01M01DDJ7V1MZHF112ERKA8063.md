# Code Review: MRQ-211 — Activity: one append-only log, three lenses

**Reviewed artifact:** PR #267 (`mrq-211-activity-lenses`, 3090-line diff, 38 files). Note for the record: the diff embedded in the review prompt was generated against a stale base — it was 5121 lines and included another ticket's Organization Home work, and was truncated at 5000 lines by Lattice. This review was performed against the actual PR #267 diff fetched from GitHub, with uncertain points verified against the code at `github/main`. The PR merged at 2026-08-15T00:17Z UTC with `fast-gate` green; this review therefore serves as the independent read of the diff.

### 1. Verdict

**PASS** — Implementation is correct, matches the plan closely, and meets the acceptance criteria. All findings below are minor.

### 2. Summary

The PR delivers exactly the plan's shape: `audit_log` becomes the single substrate (migration 0021 relaxes `event_id`, adds `org_id` + a `CHECK` that every row is scoped to something, snapshots `actor_name`), a named seam (`src/lib/org-activity.ts` + `ORG_ACTIVITY_ACTIONS`) instruments every org-level writer that exists on `main`, and three lenses read the one log through one shared server-side copy layer (`src/lib/activity-copy.ts`) with keyset pagination throughout. Quality is high — the migration reasoning, the append-safe cursor design, and the honest queued/sent mail split are all careful work, and the test file proves the properties that matter (scope CHECK, append-during-paging, cross-org isolation, secret non-leakage, authz). I verified the specific risks a cold read raises — audit bind order after the column additions, all three `auditStatementFromSelect` callers updated, `requireOrgAdmin`'s grant parameter, the route-table `sidebar` opt-in, decision template keys covering the consumer's classification — and each checks out.

### 3. Issues

**[MINOR] src/lib/org-activity.ts:1056 (also history.ts recordTimelinePage, personFeedPage) — `hasMore` false positive at exact page-size boundary**
All three pagers compute `hasMore: rows.results.length >= page.limit`. When the remaining rows are an exact multiple of the page size, the last full page reports `hasMore: true` with a valid cursor; the user clicks "Load more", receives an empty page, and only then sees "Complete". No row is lost or repeated, so this is cosmetic — one dead click at a boundary.
**Fix:** Fetch `limit + 1` rows and slice, setting `hasMore` from the overflow row; or derive it as `fetched-so-far < total`. Apply in one place (see next issue).

**[MINOR] src/lib/org-activity.ts + src/lib/history.ts — keyset paging logic implemented three times**
`orgActivityPage`, `personFeedPage`, and `recordTimelinePage` each hand-roll the same cursor `WHERE` fragment, the same `COUNT` + page `Promise.all`, and the same `{rows, total, nextCursor, hasMore}` envelope — two in positional-`?` style, one in numbered-`?N` style. Three copies means a fix like the `hasMore` boundary above must land three times or the lenses drift.
**Fix:** Extract a small shared helper in `src/api/pagination.ts` (cursor predicate + envelope assembly); the three readers keep their own SQL sources.

**[MINOR] src/jobs/mail/consumer.ts:373 — the "sent" audit row is a separate write after `markSent`**
`recordSentAudit` runs its own SELECT and INSERT after the outbox UPDATE commits. A worker death between the two leaves an outbox row marked `sent` whose timeline never gains its "sent" moment — permanently, since the sentinel guard means the row won't be reprocessed. The codebase explicitly accepts this class of trade elsewhere (the `removeOrganizer` session-count comment argues it well), and the queue-time `…_mail_queued` row means the timeline is never silent about the mail — it just may end at "queued".
**Fix (optional):** Batch the audit INSERT with the `markSent` UPDATE. The complication is that the audit row should only exist if the UPDATE changed a row, which `auditStatementFromSelect` with a predicate on the outbox row's `status` could express; only worth doing if a missing "sent" line would ever be operationally load-bearing.

**[MINOR] src/api/pagination.ts:154 — `parseKeysetCursor` accepts exotic numeric spellings**
`Number(value.slice(0, separator))` accepts `"1e3:abc"`, `"0x10:abc"`, and `" 12:abc"` as valid cursors. All are bound safely (never interpolated), so there is no injection surface — the cursor contract is just looser than the `created_at:id` shape the error message states.
**Fix:** `/^\d+$/.test(...)` before `Number(...)` if you want the contract literal. Cosmetic.

**[MINOR] src/lib/auth/instance-claim.ts:762 — activity write sits between link consumption and session creation**
`recordOrgActivity` is awaited after the magic link is consumed and membership upserted, but before `createSession`. An audit-write failure 500s a claim whose single-use link is already spent, leaving the claimant with no session and no retry. The window is one INSERT wide and the surrounding flow already has this sequential-failure shape, so this extends an existing exposure rather than creating one.
**Fix (optional):** Move the activity write after `createSession`, or fold it into a batch with the membership upsert.

### 4. Positive Observations

- **The migration is exemplary.** `migrations/0021_audit_log_org_scope.sql` names its transient table `audit_log_0021_new` specifically to survive the reset-wipe-order test's duplicate-`CREATE TABLE` refusal, deliberately preserves 0018's removal of the `event_id` FK (with the reasoning — audit history must outlive deleted conferences — written where the next rebuilder will read it), backfills `org_id` only where the event still exists so orphaned rows satisfy the CHECK on `event_id` alone, and adds `idx_audit_org_created` for the one query the new lens runs. `scripts/schema-verify.mjs`'s FK count was bumped in the same PR.
- **The append-safe pagination is actually proven, not just claimed.** The `(created_at, id)` keyset cursor is the right call for feeds that prepend while being read, and the test "keyset pages survive an append between reads" constructs the exact OFFSET failure mode (read page one, append, read page two) and asserts no row repeats or vanishes.
- **The scope-based lens design delivers the plan's forward-compatibility promise.** The org lens is `WHERE org_id = ?` with `describeActivity`'s `humanize` fallback, and the test suite proves both halves: a known future action (`org.ownership_transferred`) renders its copy, and a never-seen action (`org.branding_replaced`) degrades to "Branding replaced" instead of vanishing. MRQ-207/212 can write through the seam with zero edits here.
- **The queued/sent split is honest instrumentation.** Queue admission now writes `…_queued` and only the consumer — the party that actually sent — writes `…_sent`/`…_resent`, with `markSent`'s `changes === 1` gating the audit so a concurrently-processed row records nothing. The `mail.test.ts` contract test verifies the sequence end to end, and the two pre-existing tests that asserted the old conflated action were updated rather than deleted.
- **`actor_name` snapshotting closes a real hole**: demo-people cleanup severs `actor_person_id`, and every reader (`history.ts`, `org-home.routes.ts`, `submission-record.routes.ts`, both new lenses) now reads `COALESCE(audit.actor_name, person.name)` so authorship survives the cleanup. The comment added at the severing site in `delete-event.ts` points at the mechanism.
- **Security posture is right throughout**: token audit rows carry name and grants but never the secret or hash (asserted in a test against the raw payload), invite audit rows never carry the link, all cursor/scope values are bound parameters, the org lens requires org-wide admin (403 test for a reviewer seat), and the person feed's cross-org isolation has a dedicated adversarial test that plants a foreign org's row against a local person id.
- **Idempotency of the revoke writers**: both invite and token revocation only record when the revoke actually spent something (`row.revoked_at === null` / the guarded UPDATE), with tests asserting a retried DELETE writes no second row.
- **UI craft follows the house rules**: both "Load more" footers reserve their row ("Complete" holds the space the button leaves), detail rides the fact line without adding height, the org log's meta column is a fixed grid so timestamps stay in a readable column, and pages are concatenated on the server's cursor boundary rather than re-sorted client-side.
- **The person-record read got faster while gaining a feature**: three unbounded queries merged, sorted, and mostly discarded in JS were replaced by one SQL-paginated union — lens two arrived as a net simplification of the endpoint it extended.
