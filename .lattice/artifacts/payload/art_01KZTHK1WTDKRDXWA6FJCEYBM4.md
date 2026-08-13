# MRQ-118 code review — commit 1418642722250343c94d8cb3ec178c4396960a09

Reviewer: single headless Claude (Opus) over `git diff github/main...HEAD`, three rounds
(review → fix → re-review → fix → verify), per COMMON.md inline-full. The lattice
auto-fired review returned no artifact ("No in-flight review found"), so this replaces it.

## Verdict: PASS

Round 3 returned **PASS-WITH-NITS** with one open nit (a Restore control offered to a
principal who may edit a draft but may not restore it). That nit was then fixed —
`actions.can_restore_content` was split from `actions.can_edit_content` because the two
controls go through endpoints with different policies — and pinned by a test
(`content-editing-history.MRQ-118.test.ts`, "a draft is editable without program:write but
not restorable"). No findings remain open.

## Findings, all resolved

| # | Severity | Finding | Resolution |
|---|---|---|---|
| 1 | BLOCKING | New D1 placeholder-expansion site in `src/lib/history.ts` was UNCLASSIFIED, red-ing `tests/node/bulk-paths.AC-66-69.test.mjs` | Classified in the inventory: bounded by the three-value `CONTENT_ACTIONS` taxonomy |
| 2 | BLOCKING | History offered "Restore this version" on statuses the server 409s; a click replaced the page with "Record unavailable" | Restore gated on a server-computed flag |
| 3 | Should fix | Client hardcoded `confirm_published: true`, waiving on the restore path the guard the editor takes two clicks to clear | `confirm_published` now derives from `slot.is_published`; the confirm names the public consequence |
| 4 | Should fix | ops/form-admin can READ the record but lack `program:write`, so they got an editor that 403s after typing | `actions.can_edit_content` computed server-side from the same grant the write routes enforce |
| 5 | Test coverage | No authorization test on either new route | Added: ops session 403s on both, cross-event write refused, flag agreement asserted |
| 6 | Nit | Hand-written `search_blob` was dead code disagreeing with the `submissions_search_blob_update` trigger (which trims) | Removed; the trigger owns the column, pinned by a discriminating test |
| 7 | Nit | Restore treated an absent `title` and an absent `abstract` asymmetrically | `contentOf` distinguishes absent from null; a title-only row no longer blanks an abstract |
| A | Regression from fix 4 | Gating the editor on `program:write` removed draft editing from form admins (AC-247–249 asserts they have it) | Drafts short-circuit the grant — the draft door is `requireDraftRead` |
| B | Regression from fix A | Restore reused the now-draft-permissive flag | Split into `can_restore_content` |

## What the reviewer confirmed holds

- **Restore is genuinely append-only** — `contentWriteStatements` only ever INSERTs; the byte-identical-earlier-rows test proves it.
- **The batch is atomic and inseparable** — the UPDATE and its audit row are produced as one array by one function into a single `DB.batch()`; no caller can split them.
- **The restore lookup is properly scoped** — id + event_id + entity_type + entity_id, narrowed to content actions.
- **`loadRecord`'s `canWriteProgram = true` default is correct at every defaulted call site** — all are `grants: ["program:write"]` routes; the two `authenticated` routes pass the resolved value.
- **Wire shapes survive** — portal `historyFor` is additive; the record's `history` drops only `entity_type`/`entity_id`, which nothing consumes.
- **`publishedGuard` matches the public site** — `public-site.ts` gates on `agenda_items.is_published = 1`, exactly what the guard reads.

## Accepted, not fixed (scope)

- **No optimistic concurrency** (`concurrency: "none"`): two simultaneous edits both record `before = X`. Consistent with every other submission write; only `agenda.routes.ts` uses `if-match`. Noted because an honest-history feature is where it costs most.
- **`src/api/router.ts`'s `roleForEvent` org gap** — pre-existing, not introduced here.
