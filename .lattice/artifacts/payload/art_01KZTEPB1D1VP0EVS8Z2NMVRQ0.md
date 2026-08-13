# Code Review: MRQ-118 — Organizer content editing with named history and restore

Reviewed at `mrq-118-content-history` @ `08ca861` (3 commits on `github/main @ 23a06b0`).

**Verification actually run** (not inferred from the diff):

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npx vitest run tests/integration/api/content-editing-history.MRQ-118.test.ts tests/integration/api/portal.AC-43-52-233-237-240.test.ts` | 31 passed |
| `npm run check:api` | `findings: []`, registry parity holds (F4 resolved) |
| `npm test` (full suite) | **FAILS** — `tests/node/bulk-paths.AC-66-69.test.mjs` |

---

## 1. Verdict

**FAIL (implementation-level)**

The plan is sound and the server-side design is the right one — I'd merge this shape. But the branch leaves `npm test` red, so `npm run pr-gate` cannot pass as-is. Three further defects are worth fixing in the same pass, one of which lands directly on the CNT-11 rubric target this ticket exists to win.

## 2. Summary

Reviewed the new `PATCH …/content` and `POST …/content/restore` routes, the lifted `src/lib/history.ts`, the `patchDraft` rework, the portal `historyFor` replacement, the shared `ContentHistory` component, and the 14-test MRQ-118 suite. The core is genuinely good: one write helper feeding a single `batch()`, restore implemented as a forward edit that never touches an existing row, `search_blob` maintained in the portal's exact expression, and a test that asserts the two original audit rows are byte-identical after a restore.

The key finding is that `src/lib/history.ts` introduces a new dynamic D1 placeholder site, and this repo has a repo-wide placeholder inventory guard (`bulk-paths.AC-66-69`) that fails on any unclassified new site. The suite is red on the branch. Secondarily, the History card renders a **date-only** timestamp, so the two edits CNT-11 asks the judge to distinguish render as identical rows, and the Restore control is offered on `rejected`/`withdrawn` records where the server will 409.

## 3. Issues

**[CRITICAL] src/lib/history.ts:516 — new D1 placeholder site is unclassified; `npm test` and therefore `pr-gate` are red**

`contentHistoryFor` builds its `IN (…)` list with `CONTENT_ACTIONS.map(() => "?")`. `tests/node/bulk-paths.AC-66-69.test.mjs:339` maintains `EXPECTED_PLACEHOLDER_SITES` — a repo-wide inventory of every map callback that emits a SQL placeholder — and asserts `deepEqual` against what it finds in `src/`. The new site appears as:

```
{ file: 'src/lib/history.ts', owner: 'contentHistoryFor',
  binding: 'placeholders', expression: 'CONTENT_ACTIONS.map(() => "?")',
  classification: 'UNCLASSIFIED' }
```

with the assertion message *"repo-wide D1 placeholder inventory changed; classify and re-audit the new site before changing this allowlist."* Confirmed by running `node --test tests/node/bulk-paths.AC-66-69.test.mjs` in isolation. The full-suite run also reported `status: "fail"` (134s, over the 45s budget — but the machine is carrying a large worktree fleet, so treat the duration as load, not as a defect; the assertion failure is the real one).

**Fix:** add the classification the guard is asking for, e.g. in `EXPECTED_PLACEHOLDER_SITES`:

```js
{ file: "src/lib/history.ts", owner: "contentHistoryFor", binding: "placeholders",
  expression: 'CONTENT_ACTIONS.map(() => "?")',
  classification: "bounded by the three-value CONTENT_ACTIONS taxonomy; not caller-supplied" },
```

The alternative — inlining a literal `IN ('speaker_talk_updated', 'content_updated', 'content_restored')` built from the constant at module load — dodges the guard rather than answering it; the classification is the honest move and the guard is doing exactly its job here. Then re-run `npm run pr-gate`.

---

**[MAJOR] src/ui/submissions/record-copy.ts:10 (via SubmissionRecordPage.tsx:225) — history timestamps are date-only, so CNT-11's "two distinct timestamped entries" render identically**

`ContentHistory` receives `moment` from `record-copy.ts`, which formats `{ month, day, year }` and nothing else. CNT-S3 steps 8–9 have the judge make two edits minutes apart and then read the History panel. Both rows will render:

```
Content Updated   Jordan Alvarez   Aug 12, 2026
Content Updated   Jordan Alvarez   Aug 12, 2026
```

Same label, same name, same date. Worse, both edits in the CNT-S3 script only append to the *abstract*, so `titleBefore()` returns the same title for both and even the disambiguating `Restores: "…"` preview is identical. The judge is asked to click the row that restores the version prior to the second edit and has no on-screen way to tell the two apart — which is precisely the failure mode F1 in the plan was written to prevent, reintroduced through the time format rather than the label.

**Fix:** give `ContentHistory` a time-bearing formatter rather than reusing the record's date-only `moment`. Either pass a local helper (`Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })`) as the `moment` prop from `SubmissionRecordPage.tsx:225`, or add `historyMoment` to `record-copy.ts` beside `moment` and unit-test it there with the other copy helpers. Keep the `tabular` class so the column stays fixed-width. Consider also widening the preview to name the field that changed when the title is unchanged (`Restores the abstract as of …`) — but the timestamp alone resolves the rubric item.

---

**[MAJOR] src/ui/submissions/SubmissionRecordPage.tsx:225 — Restore is offered on records the server refuses to edit, and the 409 destroys the page**

`onRestore` is passed unconditionally, and `restorable` is computed in `loadRecord` purely from the audit row (`isRestorable` = content action + readable `before`), with no status awareness. A `rejected` or `withdrawn` record that was edited earlier in its life therefore shows live "Restore this version" buttons, while `editableContentFor` (`submission-record.routes.ts:300`) throws `409 "a rejected record's content cannot be edited"`.

This directly contradicts the rule the same file states for the editor at line 22 — *"Mirrors the server's allowlist … so the editor is never rendered over a write that would come back 409 — an editable-looking field that cannot save is worse than no field."* The Session content card honours it; the Restore control does not.

The failure is also loud: `act()` (line 129–131) catches and calls `setState({ kind: "error", … })`, which replaces the entire record page with the "Record unavailable" screen. The organizer loses the record they were reading because of a button that should not have been offered.

**Fix:** gate the prop on the same allowlist already in scope —

```tsx
onRestore={EDITABLE_CONTENT_STATUSES.includes(record.status) ? (entryId) => void restoreVersion(entryId) : undefined}
```

`ContentHistory` already renders read-only when `onRestore` is omitted (line 1039: `Boolean(onRestore && entry.restorable)`), and the reserved `.history-action` column keeps the geometry identical, so no layout follows.

---

**[MINOR] src/ui/submissions/SubmissionRecordPage.tsx:194-201 — restore hardcodes `confirm_published: true`, so the public-site guard never fires for a restore**

`restoreVersion` always sends `confirm_published: true`, meaning `publishedGuard` is unconditionally short-circuited on the restore path. The inline comment claims the restore "carries the same confirmation," but what it actually carries is `ContentHistory`'s generic two-step (`Restore this version` → `Confirm`), whose copy says nothing about the public site. On a live Session the plan's stated invariant — *"the only thing between a stray keystroke and a public-site change"* — is not what ships: the edit path warns ("This replaces what attendees see on the public agenda"), the restore path does not.

**Fix:** send `confirm_published: isLivePublicly` and let the server 409 surface only when it should; and pass the live state down so the inline confirm can say what a restore on a live Session does. Simplest version: pass a `confirmCopy?: string` prop to `ContentHistory` and render it beside `Confirm` when the record is live.

---

**[MINOR] src/routes/submission-record.routes.ts:257 (via patchDraft:934) — the draft write lost its `AND status = 'draft'` guard**

The original `patchDraft` UPDATE carried `AND status = 'draft'` in its WHERE. `contentWriteStatements` writes `WHERE id = ? AND event_id = ?` only, so when a draft's content changed the status predicate is gone; only the no-op branch at line 936 still has it. The status is checked at line 921 against a row read *outside* the batch, so a submission that leaves draft between the SELECT and the batch would be written by a caller holding only `requireDraftRead` (the route's policy is `kind: "authenticated"`, weaker than the `program:write` the content door requires). Narrow window, but it was previously closed for free.

**Fix:** either accept a status predicate parameter on `contentWriteStatements` (`WHERE id = ? AND event_id = ?` + optional `AND status = ?`), or re-read and re-assert status inside the batch. The parameterised WHERE is two lines and keeps the "one helper, no drift" property intact.

---

**[MINOR] tests/integration/api/content-editing-history.MRQ-118.test.ts:1496 — the test named for the 422 path asserts 404 and never reaches it**

*"restore refuses a history row that records no earlier content"* inserts a `published` action row with `before_json = NULL` and expects 404. That 404 comes from `!isContentAction(entry.action)` at `submission-record.routes.ts:1034` — the action allowlist — not from the `ApiError.unprocessable` at :1043 the test name describes. Plan test #9 asked for 422 on a null `before_json`; that branch has zero coverage, and the test's name misdescribes what it pins.

Worth knowing: the 422 branch is arguably unreachable today, since every writer of a `CONTENT_ACTIONS` row emits a full `{title, abstract}` (or `{title, description}`) before-payload. That makes it defensive rather than dead — fine to keep, but the test should say so.

**Fix:** rename this test to what it verifies (`restore refuses a non-content history row`) and add a second one that inserts a `content_updated` row with `before_json = NULL` and asserts 422, or a row whose `before_json` is `'{}'`. Either exercises `contentOf`'s null return through the route.

---

**[MINOR] src/ui/history/history.css:1097 + src/ui/submissions/record.css:62 — `.history-preview` adds a third grid row, and the old `.record-history*` rules are now dead**

`.history-row` is `grid-template-columns: 1fr 190px` and `.history-preview` sets `grid-column: 1 / -1`, so rows carrying a preview are one line taller than rows that don't. Nothing *jumps* — the preview is static per entry, not state-driven — so the "elements never jump" rule is not violated, but the plan's claim that "row height is fixed whether or not a row carries the control" isn't what the CSS does. Separately, `.record-history` and `.record-history-row` in `record.css:48,62-64` no longer match anything now that the card renders `ContentHistory`.

**Fix:** delete the three dead `.record-history*` rules from `record.css`. If uniform row height is wanted, give `.history-row` a `min-height` sized to the two-line case rather than letting the preview grow it.

---

**[MINOR] src/routes/submission-record.routes.ts:815 (loadRecord) — every record load now ships both audit payloads for every row, unbounded**

`recordHistoryFor` selects `before_json` *and* `after_json` for every audit row on the entity with no LIMIT, and `loadRecord` then emits `before`, `after`, *and* a duplicate `after_json` per entry. The old query selected `after_json` alone, so a busy record's history payload roughly triples. R7 ("speed is a feature") makes this worth a glance, though the unbounded-history part is pre-existing.

**Fix:** drop the duplicated `after_json` key if nothing still reads it (grep says only `RecordData` typed it, and the page now reads `entry.before`/`entry.after`), and consider a `LIMIT 200` on `recordHistoryFor` with the panel saying so. Not a merge blocker.

## 4. Positive Observations

- **The restore-as-forward-edit property is genuinely tested, not just asserted in prose.** `expect(afterRestore.slice(0, 2)).toEqual(originals)` is the right assertion — it pins byte-identity of the prior rows rather than just counting to three. That is the load-bearing claim of the whole feature and it has a real oracle.
- **One helper, two doors, one `batch()`.** `contentWriteStatements` returning a `D1PreparedStatement[]` that a caller cannot separate is the correct shape for "the audit row can never land in a different transaction from the change," and the comment explains *why* rather than *what*.
- **`search_blob` maintained in the portal's exact expression.** F3 was honoured verbatim (`` `${title} ${abstract ?? ""}`.toLowerCase() ``), and `search_blob` maintenance was correctly extended to `patchDraft` too — killing a real pre-existing bug that was out of the ticket's literal scope.
- **The status-allowlist correction was the right call and was flagged, not silently absorbed.** There is no `scheduled` status; keying the published confirm off `agenda_items.is_published` while the allowlist covers `submissions.status` is the accurate model, and `loadRecord:170` already normalises it to a boolean so `isLivePublicly === true` is safe.
- **`contentOf` tolerating both `description` (portal) and `abstract` (organizer) instead of migrating old rows.** Normalising the key would have been a history rewrite in a feature whose central promise is that history is never rewritten. The reader absorbs the cost; the writer emits one shape. Correct instinct, and the comment says exactly that.
- **The portal lift went further than the plan and is better for it.** `historyFor` now returns all `CONTENT_ACTIONS`, so a speaker sees an organizer's edit to their own talk by name instead of finding their title silently changed. The portal's `z.any()` schema and its "updated title or description" rendering both absorb the widening — verified by running the portal regression test.
- **`key={entry.id}`** replaces the old `${created_at}-${action}` composite, which could collide for two rows written in the same batch. Small, real fix.
- **Test names carry their rubric IDs** (`CNT-09:`, `CNT-11:`, `MRQ-118:`) per `trace:ac`, and each reads as a behavioural claim rather than a description of the code under it.
