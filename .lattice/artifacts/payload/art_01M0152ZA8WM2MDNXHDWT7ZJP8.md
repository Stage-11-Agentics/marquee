# Code Review: MRQ-211 — Activity: one append-only log, three lenses

## 1. Verdict

**PASS** — Implementation is correct, matches the plan, and meets the acceptance criteria. The issues found are minor polish items, none of which block merge.

*Verification note:* this review is static, from the diff, cross-checked against the base code (helper signatures, call-site scopes, route registration, fixture exports). I did not run the test suite or the gate; the PR gate remains the executable check.

## 2. Summary

Reviewed the full MRQ-211 diff: the `audit_log` org-scope migration (0019), the org-activity writer/reader seam, three lens endpoints (org log, person feed, submission timeline), instrumentation of the org-level writers that exist on `main`, the shared server-side copy layer, three UI surfaces, and the integration test file. The implementation is faithful to the plan — one substrate, three queries, no second table, scope-based org lens rather than an action allowlist — and the tricky parts (nullable `event_id` with a CHECK, preserving 0018's no-FK decision, backfill that survives deleted conferences, audit rows composed into the same D1 batch as the change they describe) are all handled correctly. The only findings are small: one writer inconsistency on repeated token revocation, and a handful of UI-level nits.

Facts verified against the codebase rather than assumed:

- `requireOrgAdmin` does accept a grant parameter (`grant: ApiGrant = "program:write"`), so `requireOrgAdmin(context, "program:read")` in the new org-activity route is valid and correctly lets a read-scoped token in while still requiring org-wide admin membership.
- Route registration is by `import.meta.glob` over `*.routes.ts` (`src/routes/_manifest.ts`), so `org-activity.routes.ts` mounts automatically — no missing registration.
- `auditStatementFromSelect` has exactly two call sites (`agenda.routes.ts`, `submission-record.routes.ts`) and both hunks remove the now-server-built `SELECT ?, …` line; the 12-placeholder projection matches the 12-value bind order.
- All variables the new writer code references in surrounding scopes exist: `row`/`eventId`/`auth` in `tokens.routes.ts`, `auth`/`memberships` in `removeOrganizer`, `row` in the invite revoke handler.
- `orgActor` matches the `Principal` union exactly (`session`→`personId`, `token`→`actingPersonId`).
- `exchangeInstanceLink` is reachable only from `claim.routes.ts` with purposes `claim | org_invite` — ordinary sign-in cannot mis-record as "Invite accepted".
- The new `recordTimelinePage` count predicate (`event_id = ? AND entity_id = ?`) exactly matches the predicate `recordHistoryFor` already used, so the count and the page cannot disagree, and behavior parity with the old History card is preserved.
- `handlePublicSubmission` rejects a re-submit of an already-submitted record (`status !== "draft"` → 409) before the new intake audit rows, so "Submitted" is written once per genuine submit.
- The 105→106 FK bump in `schema-verify.mjs` matches the single FK added (`org_id REFERENCES organizations`); `event_id` deliberately keeps 0018's no-FK stance, with the backfill CHECK-safe for rows whose conference is already deleted.
- Route table group `"utility"` is the non-sidebar catch-all (deep routes like `/settings/tasks` live there), so "no sidebar row" holds.

## 3. Issues

**[MINOR] src/routes/tokens.routes.ts:239 (revoke handler) — Repeated token revocation re-records**
Revoking an already-revoked token returns 200 (the UPDATE is a `COALESCE` no-op) and the new writer records a fresh `org.token_revoked` row on every call. This contradicts the principle the diff itself establishes and tests for invites ("a revoke that changes nothing writes nothing" — the invite path 404s and the test pins that no second row appears). A retried DELETE, or an agent replaying a call, produces duplicate revocations in the log.
**Fix:** After loading `row`, skip `recordOrgActivity` when `row.revoked_at !== null` (the fetch already happens, so the check is free).

**[MINOR] src/ui/settings/OrgActivityPage.tsx (useEffect / load) — No AbortController on the initial fetch**
`PersonDrawer` sets the repo pattern: fetch with an `AbortController`, ignore errors after abort. `OrgActivityPage` fetches without one, so navigating away mid-load calls `setState` on an unmounted component.
**Fix:** Mirror the `PersonDrawer` pattern — controller in the effect, `if (!controller.signal.aborted)` guard before `setState`, abort on cleanup.

**[MINOR] src/ui/settings/OrgActivityPage.tsx — `route: "org-activity"` breaks the diagnostic-label convention**
Every other `apiFetch` caller passes the API route template (`people-api.ts` passes `"/api/v1/org/people/{personId}/activity"`); this one passes a slug, so the error-diagnostic report for this page reads differently from every other surface.
**Fix:** `route: "/api/v1/org/activity"`.

**[MINOR] All three "Load more" surfaces — Concatenation can duplicate rows when the log grows between pages**
`OrgActivityPage`, `PersonDrawer`, and `SubmissionRecordPage` append page N+1 to what is shown. A row written between fetches shifts the offset window, so page N+1 can repeat the tail of page N: duplicate ids as Preact `key`s (console warning, potential render glitches) and the same fact listed twice. The org log is the surface most exposed — it is org-wide and multi-writer.
**Fix:** When appending, filter incoming rows against the ids already shown (`const seen = new Set(existing.map(r => r.id))`). Three lines, once per surface — or once in a tiny shared helper.

**[MINOR] src/ui/settings/OrgActivityPage.tsx — `activityMoment` constructs a new `Intl.DateTimeFormat` per row, per render**
Formatter construction is the expensive part of `Intl`; at 50 rows × every render it is measurable, and this project treats slow lists as defects (R7).
**Fix:** Hoist the formatter to a module-level constant.

**[MINOR] src/routes/org-people.routes.ts:197 (removeOrganizer) — Session count is read outside the batch**
The live-session count is taken before the batch that revokes them, so a session minted in the gap is revoked but uncounted (and if the batch fails, nothing was written anyway, so no phantom row — that side is fine). The window is milliseconds and the number is descriptive, not authoritative; this is an accepted-risk note, not a required change.
**Fix:** Optional — extend the comment to name the race so a future reader doesn't "fix" it into a worse cross-transaction shape.

## 4. Positive Observations

- **The migration is the best artifact in the diff.** It preserves 0018's deliberate no-FK `event_id` (and says why re-adding the FK would silently regress MRQ-204), backfills `org_id` via the event join so pre-existing history enters the org lens, and the CHECK is written so a row whose conference was already deleted stays valid on `event_id` alone. The comment block would let a cold reader reconstruct every decision.
- **The scope-based org lens (`org_id = ?`, no action allowlist) is exactly the right seam** for the parallel tickets, and the test for it is the right test: it inserts an action the vocabulary has never met and asserts it renders via the humanize fallback rather than vanishing. That is the failure mode this feature is actually prone to, tested directly.
- **`auditStatementFromSelect` refactor removes a real footgun.** The eleven-question-mark projection was a column count three files had to agree on; building it server-side from `PLACEHOLDERS` made the twelfth column a one-place change, and both call sites were updated.
- **Atomicity where it matters:** the `org.member_removed` row rides in the same `batch()` as the membership delete and session revocation, so the log cannot report a removal that didn't land. The plan called this out; the implementation honors it.
- **Security posture is careful throughout:** the token writer records name and grants, never the secret (and the test asserts the secret is absent from the stored payloads); the invite writer records that an invite exists, never the link; all new SQL is parameterized; the numbered-parameter union (`?1` reused across three sources) binds correctly for both the count and the page.
- **The person feed rewrite is a genuine R7 improvement,** replacing three unbounded reads merged and mostly discarded in JS with one SQL-paginated union — while keeping the wire shape the drawer already used.
- **Tests verify behavior end-to-end** — real writers through real routes, then the lens — including the properties easiest to fake: page 1 ≠ page 2 with `per_page=1` (defeats a client-side-slice implementation), the record read and the paged endpoint agreeing on `total` and row one, the reviewer seat getting 403, and the schema refusing a row scoped to nothing.
- **UI stability rules are followed:** the count/"Load more" footer keeps a fixed row ("Complete" holds the space), detail rides the fact line without adding height, and the meta column grid is fixed so timestamps stay in their column — with comments explaining each in terms of the no-jump rule.
