# MRQ-118: Organizer content editing with named history and restore

CNT-09 (w2), CNT-11 (w2), feeds CNT-12 (w3) — the largest lever in the content area; the triage assumed an editor that does not exist. patchDraft hard-rejects non-drafts (submission-record.routes.ts:793) and the record page renders its editor only for drafts — organizers cannot edit accepted session content AT ALL. (1) Extend the record editor to accepted/scheduled (explicit status allowlist; published behind a confirm). (2) Every write emits before/after audit rows composed into the same batch() as the change (src/lib/audit.ts:50-66 pattern). (3) LIFT the portal's proven history machinery (historyFor at portal.routes.ts:868-889 already joins people for actor_name and renders 'Priya Raman - 12 Aug - updated title') into src/lib/history.ts; add the missing people-join to the admin history query (~2 lines) and stop rendering the literal string 'user' (SubmissionRecordPage.tsx:173 prints actor_kind). (4) RESTORE IS A FORWARD EDIT: re-apply before_json through the same write path, emit content_restored with its own before/after; never rewrite or delete audit rows. Ownership: you own session content editing + the history component on the submission record; the roster ticket owns the speaker record and consumes your component. Full spec: section T-G. Register row 30.

---

## Ground truth verified in code (worktree `mrq-118-content-history`, cut from `github/main @ 23a06b0`)

| Claim | Verified at |
|---|---|
| `patchDraft` rejects every non-draft | `src/routes/submission-record.routes.ts:793` — `if (submission.status !== "draft") throw ApiError.conflict(...)`; the UPDATE also carries `AND status = 'draft'` in its WHERE (`:800`) |
| Record page renders its editor only for drafts | `src/ui/submissions/SubmissionRecordPage.tsx:163` — `{record.status === "draft" && <Card>…Draft editor…}` |
| Admin History card prints `actor_kind` | `SubmissionRecordPage.tsx:173` — `<span>{entry.actor_kind}</span>` → the literal string `user` |
| Admin history query has no people join | `submission-record.routes.ts:403-408` — selects `actor_person_id` but never joins `people` |
| Portal's `historyFor` is the proven pattern | `src/routes/portal.routes.ts:868-889` — `LEFT JOIN people person ON person.id = audit.actor_person_id`, returns parsed `before`/`after` |
| Portal's write is the batch pattern to copy | `portal.routes.ts:1346-1366` — one `batch([UPDATE, auditStatement(...)])` with `before`/`after` |
| Audit composition helper | `src/lib/audit.ts:50-66` — `auditStatement` returns a `D1PreparedStatement` for `batch()` |
| `patchDraft` never maintains `search_blob` | `:798-800` — the portal write does (`portal.routes.ts:1350`), so admin edits leave board/public search stale |
| Statuses | `src/db/schema.ts:50-58` — draft, submitted, in_review, accepted, waitlisted, rejected, withdrawn |
| "Scheduled"/"published" are not statuses | `status` stays `accepted`; scheduling is an `agenda_items` row, publishing is `agenda_items.is_published` (`submission-record.routes.ts:527`, `can_publish` at `:563`) |
| `patchDraft`'s only UI caller | `SubmissionRecordPage.tsx:152` (`saveDraft`) — no other caller in `src/` or `tests/` |

**Correction to the ticket text (deviate-with-flag, minor):** the ticket says "extend the record editor to accepted/scheduled". There is no `scheduled` status — scheduled and published are derived from `agenda_items`. The allowlist is therefore over `submissions.status`, and the published confirm keys off `slot.is_published`.

## Rubric targets

- **CNT-09 (w2, crud, CNT-S3 step 7):** organizer edits title + abstract from a central admin view; persists across navigate-away and reopen; the session list reflects the new title.
- **CNT-11 (w2, depth, CNT-S3 steps 8-9):** history panel lists ≥2 distinct timestamped entries **attributed to Jordan Alvarez** (a name, not "user"); restoring the earlier version removes the second edit's sentence and keeps the first.
- **CNT-12 (w3):** not mine to build (T-L owns batch publish); this ticket only has to leave the publish/approval controls intact and reachable, and must not let a content edit silently unpublish.
- CNT-S3 step 15 re-edits the title back to the original — the search index must follow the edit or later areas lose the session by title.

## Design

### 1. Write path — one shared helper, two doors

`patchDraft` stays the draft door (it owns `answers` editing and the form-admin permission model via `requireDraftRead`). A new route owns non-draft content.

**New:** `PATCH /api/v1/events/{eventId}/submissions/{submissionId}/content` — `operationId: updateSubmissionContent`, `policy.auth: { kind: "grants", grants: ["program:write"] }` (same as `scheduleSubmission`/`publishSubmission`).

Both doors funnel through one helper in `submission-record.routes.ts`:

```
contentWriteStatements(db, eventId, submissionId, current, next, actor, now, action)
  → [UPDATE submissions SET title, abstract, search_blob, last_saved_at, last_write_source='marquee', updated_at,
     auditStatement({ action, before: {title, abstract}, after: {title, abstract}, ... })]
```

Both are composed into a single `batch()` — the audit row can never land in a different transaction from the change (cross-cutting fact 6).

**Status allowlist (explicit, server-side):** `draft, submitted, in_review, accepted, waitlisted`. `rejected` and `withdrawn` → `409` with a message naming the status. A rejected talk's content is a historical record; editing it is not a thing organizers should be able to do by accident, and the honest 409 beats a silent success.

**Published confirm:** when the record's slot exists and `is_published === 1`, the request must carry `confirm_published: true` or the route returns `409 "this session is live on the public site — resend with confirm_published to update it publicly"`. The UI supplies the confirm. This is a real guard, not decoration: it is the only thing between a stray keystroke and a public-site change.

**No-op writes emit nothing.** If title and abstract are both unchanged, return the record without writing an audit row (portal pattern, `portal.routes.ts:1343`). A history full of "changed nothing" entries is the fastest way to make an honest history panel useless.

`patchDraft` also gains the audit row + `search_blob` maintenance — same helper, `action: "content_updated"`. Drafts get history for free and the search-index bug dies in both doors at once.

**Action vocabulary:** `content_updated` (both doors), `content_restored` (restore). The portal's existing `speaker_talk_updated` rows stay as they are — they are the same kind of fact from a different actor, and the history reader treats all three as content entries.

### 2. Restore — a forward edit

**New:** `POST /api/v1/events/{eventId}/submissions/{submissionId}/content/restore`, body `{ audit_id, confirm_published? }`, same grants.

1. Load the named audit row; 404 unless it belongs to this event + submission and its action is one of the three content actions.
2. Its `before_json` is the target. If `before_json` is null (nothing to restore to) → 422.
3. Re-apply through **the same helper** as a normal edit, `action: "content_restored"`, with `before` = the record as it is *now* and `after` = the restored values. The restore's own before/after is therefore truthful about what the restore changed.
4. Existing rows are never updated or deleted. History only grows.

This is what makes the panel trustworthy: after a restore the history shows three entries, and the third one says what it undid.

### 3. `src/lib/history.ts` — lifted, not rewritten

Exports:

- `CONTENT_ACTIONS = ["speaker_talk_updated", "content_updated", "content_restored"]`
- `contentHistoryFor(db, eventId, entityType, entityId)` — the portal query generalized over entity type and the action set, keeping the `LEFT JOIN people` and the parsed `before`/`after`. Returns `{ id, action, actor_person_id, actor_name, actor_kind, created_at, before, after }`.
- `recordHistoryFor(db, eventId, entityId)` — the admin full-audit query **with the people join added** (the ~2 lines the ticket names) and `before_json` parsed alongside `after_json`, so the History card can render a name and offer restore on content rows.

`portal.routes.ts`'s local `historyFor` is deleted and its two call sites point at `contentHistoryFor`. Its wire shape is preserved exactly (`id, actor_person_id, actor_name, created_at, before, after`) so the portal's response schema and tests do not move.

`entityType` is a parameter from the start because T-D1 consumes this for the speaker record (`people` entities) — that is the ownership contract in section 4 rule 7.

### 4. UI

**`src/ui/submissions/SubmissionRecordPage.tsx`**

- Replace the draft-only card with **"Session content"**, rendered whenever `record.status` is in the allowlist. Title input + abstract textarea + Save. Route selected by status: draft → `PATCH …/submissions/{id}`, otherwise → `PATCH …/content`.
- Header note is status-truthful: draft → "Saving keeps this record in Draft."; live → "This session is live on the public site."; otherwise → "Edits are recorded in the history below."
- Published: a confirm row appears above the Save button ("Saving updates the public site." + a checkbox-free two-step: Save → "Confirm public update"). **Elements never jump** — the confirm row occupies a reserved `min-height` slot that is present in every state, and the Save button carries a fixed width so "Save" → "Saving…" → "Confirm public update" does not resize it.
- History card renders `actor_name || "Conference team"` instead of `actor_kind`, a `statusLabel`'d action, a tabular timestamp, and — on content rows with a restorable `before` — a "Restore" control with an inline confirm. Row height is fixed whether or not a row carries the control.

**`src/ui/history/ContentHistory.tsx`** — the shared component T-D1 consumes. Props: `{ entries, onRestore?, busy? }`, no knowledge of submissions. The record page renders it; the speaker record will too.

CSS lives in `src/ui/submissions/record.css` (existing `.record-history-row` grid gains a fixed action column) plus a small `src/ui/history/history.css` for the shared component.

### 5. Discoverability (turn budget is scoring surface)

The editor is a card **in place** on the record the judge already has open — no modal, no extra route, no navigation. The history sits directly beneath it, so steps 7→8→9 of CNT-S3 are three saves and one click without leaving the page. Card titles use the nouns the spec searches for: "Session content", "History", "Restore".

## Files

| File | Change |
|---|---|
| `src/lib/history.ts` | **new** — `CONTENT_ACTIONS`, `contentHistoryFor`, `recordHistoryFor` |
| `src/routes/submission-record.routes.ts` | shared write helper; `updateSubmissionContent`; `restoreSubmissionContent`; `patchDraft` gains audit + search_blob; history query → `recordHistoryFor` |
| `src/routes/portal.routes.ts` | delete local `historyFor`, call `contentHistoryFor` |
| `src/ui/submissions/SubmissionRecordPage.tsx` | Session content editor for the allowlist; history card → shared component |
| `src/ui/history/ContentHistory.tsx` + `history.css` | **new** — shared, T-D1 consumes |
| `src/ui/submissions/record.css` | history row action column, reserved confirm slot, fixed button width |
| `tests/` | new `content-editing` suite; portal history regression |

No migration — `audit_log` already carries everything (`before_json`, `after_json`, `actor_person_id`, `request_id`).

## Collisions (section 4 file-ownership)

- Rule 7 — I build the history component, T-D1 consumes it. `src/ui/history/ContentHistory.tsx` is the contract; its props take entries, not a submission.
- `submission-record.routes.ts` — not listed as contended. T-L (batch publish) touches `publishSubmission`; my routes are new and my `patchDraft` edit is inside the handler body. Rebase-clean.
- `route-table.ts` — no new page routes, so untouched (rule 6 not engaged).
- `*.routes.ts` naming: both new endpoints live in the existing `submission-record.routes.ts`, so the `_manifest.ts` glob picks them up with no new file.

## Tests

Vitest (workers pool), targeted — never the full suite (fleet load rule). Names carry AC/rubric IDs per `trace:ac`.

1. `PATCH …/content` on an **accepted** submission updates title + abstract, returns the record, and the reload shows them (CNT-09).
2. The same write lands exactly one `content_updated` audit row with truthful `before` **and** `after`, in the same batch (assert both the submission row and the audit row after one call).
3. `search_blob` follows the edit (the CNT-S3 step-15 lookup-by-title path).
4. Status allowlist: `rejected` and `withdrawn` → 409; `draft`, `submitted`, `in_review`, `accepted`, `waitlisted` → 200.
5. Published guard: without `confirm_published` → 409; with it → 200.
6. No-op write emits no audit row.
7. History: two edits by the same organizer produce two entries **carrying `actor_name`**, newest first (CNT-11 attribution).
8. Restore: two appends, restore to the first version → abstract keeps sentence 1, loses sentence 2; **three** audit rows exist afterwards and the two originals are byte-identical to before (CNT-11 restore + "never rewrite history").
9. Restore rejects an `audit_id` from another submission (404) and one with a null `before_json` (422).
10. `patchDraft` still works, now emits an audit row, and still round-trips `answers`.
11. Portal talk-update history is unchanged after the lift (regression on the shared lib).

## Validation

`wrangler dev` + the c11 embedded browser, driving CNT-S3 steps 7-9 exactly as the judge would: open the accepted session, prefix the title with `UPDATED: `, append the live-demo sentence, save, navigate away, reopen, confirm persistence and the list title; second append; open History; confirm two named timestamped entries; Restore; confirm the abstract keeps the live-demo sentence and loses the laptop sentence. Screenshots attached with `--role validation`.

## Risks

- **Two write doors could drift.** Mitigated by the single `contentWriteStatements` helper — the routes differ only in permission and allowlist, never in what they write.
- **`speaker_talk_updated` rows are pre-existing history.** The reader must render them (they are real content edits by real people) but restore from them is the same operation, so no special case is needed beyond including the action in `CONTENT_ACTIONS`.
- **Published edits reach the public site.** That is the intended behaviour and the confirm makes it explicit; the alternative (silently editing a private copy) is exactly the dishonest-but-cheap shape the cross-cutting facts forbid.

---

## Plan-Review Cycle 1 Resolutions (AUTHORITATIVE)

Self-review, inline (COMMON.md permits self-review or one spawned reviewer; the box is at load 223 and the headless reviewer is better spent on the diff — noted in the completion comment).

**F1 — "Restore" is ambiguous and the ambiguity is scoring surface. ACCEPTED.**
An audit row is a *change*, not a *version*, so a bare "Restore" button on a row could plausibly mean "restore to what this row produced" or "restore to what preceded it". CNT-S3 step 9 asks the judge to "restore the version prior to the second edit" — if the control's meaning is guessable rather than stated, the judge can click the wrong row and the item fails on a label. **Resolution:** the control restores the row's `before_json` and the row renders, beside the button, a truncated preview of the title it will restore to. Button label "Restore this version"; the preview is what disambiguates it, on screen, without a click. Same reasoning a human deserves.

**F2 — Restore must be offered on content rows only. ACCEPTED (already implied, now explicit).**
`recordHistoryFor` returns every audit row for the entity (`scheduled`, `published`, decisions). Only rows whose action is in `CONTENT_ACTIONS` **and** whose `before_json` carries a title/abstract get the control. Everything else renders as a plain history line. An "undo" on a decision row would be a lie about what the button does.

**F3 — `search_blob` format must match the portal's exactly. ACCEPTED.**
`portal.routes.ts:1350` writes `` `${title} ${description ?? ""}`.toLowerCase() ``. The shared helper uses that expression verbatim, so an admin edit and a speaker edit leave the index in the same shape. Two formats for one column is a bug that only shows up as a search miss months later.

**F4 — `check:api` parity may require the new paths to be exercised. FLAGGED, resolve during implementation.**
COMMON.md's route-module note says `check:api` asserts parity between the generated manifest, the served OpenAPI document, and the paths an e2e run exercises. Both new endpoints are new paths. **Resolution:** read `scripts/checks/` before opening the PR; if e2e coverage is part of the assertion, add the two paths to the e2e run rather than allowlisting them out. An allowlist entry here would be exactly the "decided and named" exception the note reserves for genuine cases, and this is not one.

**F5 — `statusLabel` must render the new actions readably. ACCEPTED.**
`content_updated` / `content_restored` must not surface as raw snake_case. Verify `record-copy.ts`'s `statusLabel` humanises unknown keys; if it does not, add the two labels there ("Content updated", "Content restored") rather than special-casing at the call site.

**F6 — no-op suppression must not swallow a legitimate whitespace-only edit. NOTED, no change.**
Equality is compared on the exact stored strings, so trimming differences still count as a change. That is the truthful reading: if the stored value differs, something changed.

---

## Divergent copy preserved on reconcile (2026-08-13)

The board and the PR branch each carried edits the other lacked. The board copy is above; the PR-branch copy follows verbatim so neither is lost.

# MRQ-118: Organizer content editing with named history and restore

CNT-09 (w2), CNT-11 (w2), feeds CNT-12 (w3) — the largest lever in the content area; the triage assumed an editor that does not exist. patchDraft hard-rejects non-drafts (submission-record.routes.ts:793) and the record page renders its editor only for drafts — organizers cannot edit accepted session content AT ALL. (1) Extend the record editor to accepted/scheduled (explicit status allowlist; published behind a confirm). (2) Every write emits before/after audit rows composed into the same batch() as the change (src/lib/audit.ts:50-66 pattern). (3) LIFT the portal's proven history machinery (historyFor at portal.routes.ts:868-889 already joins people for actor_name and renders 'Priya Raman - 12 Aug - updated title') into src/lib/history.ts; add the missing people-join to the admin history query (~2 lines) and stop rendering the literal string 'user' (SubmissionRecordPage.tsx:173 prints actor_kind). (4) RESTORE IS A FORWARD EDIT: re-apply before_json through the same write path, emit content_restored with its own before/after; never rewrite or delete audit rows. Ownership: you own session content editing + the history component on the submission record; the roster ticket owns the speaker record and consumes your component. Full spec: section T-G. Register row 30.

---

## Ground truth verified in code (worktree `mrq-118-content-history`, cut from `github/main @ 23a06b0`)

| Claim | Verified at |
|---|---|
| `patchDraft` rejects every non-draft | `src/routes/submission-record.routes.ts:793` — `if (submission.status !== "draft") throw ApiError.conflict(...)`; the UPDATE also carries `AND status = 'draft'` in its WHERE (`:800`) |
| Record page renders its editor only for drafts | `src/ui/submissions/SubmissionRecordPage.tsx:163` — `{record.status === "draft" && <Card>…Draft editor…}` |
| Admin History card prints `actor_kind` | `SubmissionRecordPage.tsx:173` — `<span>{entry.actor_kind}</span>` → the literal string `user` |
| Admin history query has no people join | `submission-record.routes.ts:403-408` — selects `actor_person_id` but never joins `people` |
| Portal's `historyFor` is the proven pattern | `src/routes/portal.routes.ts:868-889` — `LEFT JOIN people person ON person.id = audit.actor_person_id`, returns parsed `before`/`after` |
| Portal's write is the batch pattern to copy | `portal.routes.ts:1346-1366` — one `batch([UPDATE, auditStatement(...)])` with `before`/`after` |
| Audit composition helper | `src/lib/audit.ts:50-66` — `auditStatement` returns a `D1PreparedStatement` for `batch()` |
| `patchDraft` never maintains `search_blob` | `:798-800` — the portal write does (`portal.routes.ts:1350`), so admin edits leave board/public search stale |
| Statuses | `src/db/schema.ts:50-58` — draft, submitted, in_review, accepted, waitlisted, rejected, withdrawn |
| "Scheduled"/"published" are not statuses | `status` stays `accepted`; scheduling is an `agenda_items` row, publishing is `agenda_items.is_published` (`submission-record.routes.ts:527`, `can_publish` at `:563`) |
| `patchDraft`'s only UI caller | `SubmissionRecordPage.tsx:152` (`saveDraft`) — no other caller in `src/` or `tests/` |

**Correction to the ticket text (deviate-with-flag, minor):** the ticket says "extend the record editor to accepted/scheduled". There is no `scheduled` status — scheduled and published are derived from `agenda_items`. The allowlist is therefore over `submissions.status`, and the published confirm keys off `slot.is_published`.

## Rubric targets

- **CNT-09 (w2, crud, CNT-S3 step 7):** organizer edits title + abstract from a central admin view; persists across navigate-away and reopen; the session list reflects the new title.
- **CNT-11 (w2, depth, CNT-S3 steps 8-9):** history panel lists ≥2 distinct timestamped entries **attributed to Jordan Alvarez** (a name, not "user"); restoring the earlier version removes the second edit's sentence and keeps the first.
- **CNT-12 (w3):** not mine to build (T-L owns batch publish); this ticket only has to leave the publish/approval controls intact and reachable, and must not let a content edit silently unpublish.
- CNT-S3 step 15 re-edits the title back to the original — the search index must follow the edit or later areas lose the session by title.

## Design

### 1. Write path — one shared helper, two doors

`patchDraft` stays the draft door (it owns `answers` editing and the form-admin permission model via `requireDraftRead`). A new route owns non-draft content.

**New:** `PATCH /api/v1/events/{eventId}/submissions/{submissionId}/content` — `operationId: updateSubmissionContent`, `policy.auth: { kind: "grants", grants: ["program:write"] }` (same as `scheduleSubmission`/`publishSubmission`).

Both doors funnel through one helper in `submission-record.routes.ts`:

```
contentWriteStatements(db, eventId, submissionId, current, next, actor, now, action)
  → [UPDATE submissions SET title, abstract, search_blob, last_saved_at, last_write_source='marquee', updated_at,
     auditStatement({ action, before: {title, abstract}, after: {title, abstract}, ... })]
```

Both are composed into a single `batch()` — the audit row can never land in a different transaction from the change (cross-cutting fact 6).

**Status allowlist (explicit, server-side):** `draft, submitted, in_review, accepted, waitlisted`. `rejected` and `withdrawn` → `409` with a message naming the status. A rejected talk's content is a historical record; editing it is not a thing organizers should be able to do by accident, and the honest 409 beats a silent success.

**Published confirm:** when the record's slot exists and `is_published === 1`, the request must carry `confirm_published: true` or the route returns `409 "this session is live on the public site — resend with confirm_published to update it publicly"`. The UI supplies the confirm. This is a real guard, not decoration: it is the only thing between a stray keystroke and a public-site change.

**No-op writes emit nothing.** If title and abstract are both unchanged, return the record without writing an audit row (portal pattern, `portal.routes.ts:1343`). A history full of "changed nothing" entries is the fastest way to make an honest history panel useless.

`patchDraft` also gains the audit row + `search_blob` maintenance — same helper, `action: "content_updated"`. Drafts get history for free and the search-index bug dies in both doors at once.

**Action vocabulary:** `content_updated` (both doors), `content_restored` (restore). The portal's existing `speaker_talk_updated` rows stay as they are — they are the same kind of fact from a different actor, and the history reader treats all three as content entries.

### 2. Restore — a forward edit

**New:** `POST /api/v1/events/{eventId}/submissions/{submissionId}/content/restore`, body `{ audit_id, confirm_published? }`, same grants.

1. Load the named audit row; 404 unless it belongs to this event + submission and its action is one of the three content actions.
2. Its `before_json` is the target. If `before_json` is null (nothing to restore to) → 422.
3. Re-apply through **the same helper** as a normal edit, `action: "content_restored"`, with `before` = the record as it is *now* and `after` = the restored values. The restore's own before/after is therefore truthful about what the restore changed.
4. Existing rows are never updated or deleted. History only grows.

This is what makes the panel trustworthy: after a restore the history shows three entries, and the third one says what it undid.

### 3. `src/lib/history.ts` — lifted, not rewritten

Exports:

- `CONTENT_ACTIONS = ["speaker_talk_updated", "content_updated", "content_restored"]`
- `contentHistoryFor(db, eventId, entityType, entityId)` — the portal query generalized over entity type and the action set, keeping the `LEFT JOIN people` and the parsed `before`/`after`. Returns `{ id, action, actor_person_id, actor_name, actor_kind, created_at, before, after }`.
- `recordHistoryFor(db, eventId, entityId)` — the admin full-audit query **with the people join added** (the ~2 lines the ticket names) and `before_json` parsed alongside `after_json`, so the History card can render a name and offer restore on content rows.

`portal.routes.ts`'s local `historyFor` is deleted and its two call sites point at `contentHistoryFor`. Its wire shape is preserved exactly (`id, actor_person_id, actor_name, created_at, before, after`) so the portal's response schema and tests do not move.

`entityType` is a parameter from the start because T-D1 consumes this for the speaker record (`people` entities) — that is the ownership contract in section 4 rule 7.

### 4. UI

**`src/ui/submissions/SubmissionRecordPage.tsx`**

- Replace the draft-only card with **"Session content"**, rendered whenever `record.status` is in the allowlist. Title input + abstract textarea + Save. Route selected by status: draft → `PATCH …/submissions/{id}`, otherwise → `PATCH …/content`.
- Header note is status-truthful: draft → "Saving keeps this record in Draft."; live → "This session is live on the public site."; otherwise → "Edits are recorded in the history below."
- Published: a confirm row appears above the Save button ("Saving updates the public site." + a checkbox-free two-step: Save → "Confirm public update"). **Elements never jump** — the confirm row occupies a reserved `min-height` slot that is present in every state, and the Save button carries a fixed width so "Save" → "Saving…" → "Confirm public update" does not resize it.
- History card renders `actor_name || "Conference team"` instead of `actor_kind`, a `statusLabel`'d action, a tabular timestamp, and — on content rows with a restorable `before` — a "Restore" control with an inline confirm. Row height is fixed whether or not a row carries the control.

**`src/ui/history/ContentHistory.tsx`** — the shared component T-D1 consumes. Props: `{ entries, onRestore?, busy? }`, no knowledge of submissions. The record page renders it; the speaker record will too.

CSS lives in `src/ui/submissions/record.css` (existing `.record-history-row` grid gains a fixed action column) plus a small `src/ui/history/history.css` for the shared component.

### 5. Discoverability (turn budget is scoring surface)

The editor is a card **in place** on the record the judge already has open — no modal, no extra route, no navigation. The history sits directly beneath it, so steps 7→8→9 of CNT-S3 are three saves and one click without leaving the page. Card titles use the nouns the spec searches for: "Session content", "History", "Restore".

## Files

| File | Change |
|---|---|
| `src/lib/history.ts` | **new** — `CONTENT_ACTIONS`, `contentHistoryFor`, `recordHistoryFor` |
| `src/routes/submission-record.routes.ts` | shared write helper; `updateSubmissionContent`; `restoreSubmissionContent`; `patchDraft` gains audit + search_blob; history query → `recordHistoryFor` |
| `src/routes/portal.routes.ts` | delete local `historyFor`, call `contentHistoryFor` |
| `src/ui/submissions/SubmissionRecordPage.tsx` | Session content editor for the allowlist; history card → shared component |
| `src/ui/history/ContentHistory.tsx` + `history.css` | **new** — shared, T-D1 consumes |
| `src/ui/submissions/record.css` | history row action column, reserved confirm slot, fixed button width |
| `tests/` | new `content-editing` suite; portal history regression |

No migration — `audit_log` already carries everything (`before_json`, `after_json`, `actor_person_id`, `request_id`).

## Collisions (section 4 file-ownership)

- Rule 7 — I build the history component, T-D1 consumes it. `src/ui/history/ContentHistory.tsx` is the contract; its props take entries, not a submission.
- `submission-record.routes.ts` — not listed as contended. T-L (batch publish) touches `publishSubmission`; my routes are new and my `patchDraft` edit is inside the handler body. Rebase-clean.
- `route-table.ts` — no new page routes, so untouched (rule 6 not engaged).
- `*.routes.ts` naming: both new endpoints live in the existing `submission-record.routes.ts`, so the `_manifest.ts` glob picks them up with no new file.

## Tests

Vitest (workers pool), targeted — never the full suite (fleet load rule). Names carry AC/rubric IDs per `trace:ac`.

1. `PATCH …/content` on an **accepted** submission updates title + abstract, returns the record, and the reload shows them (CNT-09).
2. The same write lands exactly one `content_updated` audit row with truthful `before` **and** `after`, in the same batch (assert both the submission row and the audit row after one call).
3. `search_blob` follows the edit (the CNT-S3 step-15 lookup-by-title path).
4. Status allowlist: `rejected` and `withdrawn` → 409; `draft`, `submitted`, `in_review`, `accepted`, `waitlisted` → 200.
5. Published guard: without `confirm_published` → 409; with it → 200.
6. No-op write emits no audit row.
7. History: two edits by the same organizer produce two entries **carrying `actor_name`**, newest first (CNT-11 attribution).
8. Restore: two appends, restore to the first version → abstract keeps sentence 1, loses sentence 2; **three** audit rows exist afterwards and the two originals are byte-identical to before (CNT-11 restore + "never rewrite history").
9. Restore rejects an `audit_id` from another submission (404) and one with a null `before_json` (422).
10. `patchDraft` still works, now emits an audit row, and still round-trips `answers`.
11. Portal talk-update history is unchanged after the lift (regression on the shared lib).

## Validation

`wrangler dev` + the c11 embedded browser, driving CNT-S3 steps 7-9 exactly as the judge would: open the accepted session, prefix the title with `UPDATED: `, append the live-demo sentence, save, navigate away, reopen, confirm persistence and the list title; second append; open History; confirm two named timestamped entries; Restore; confirm the abstract keeps the live-demo sentence and loses the laptop sentence. Screenshots attached with `--role validation`.

## Risks

- **Two write doors could drift.** Mitigated by the single `contentWriteStatements` helper — the routes differ only in permission and allowlist, never in what they write.
- **`speaker_talk_updated` rows are pre-existing history.** The reader must render them (they are real content edits by real people) but restore from them is the same operation, so no special case is needed beyond including the action in `CONTENT_ACTIONS`.
- **Published edits reach the public site.** That is the intended behaviour and the confirm makes it explicit; the alternative (silently editing a private copy) is exactly the dishonest-but-cheap shape the cross-cutting facts forbid.

---

## Plan-Review Cycle 1 Resolutions (AUTHORITATIVE)

_(appended after review)_
