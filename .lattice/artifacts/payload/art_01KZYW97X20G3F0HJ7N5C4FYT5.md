# Code Review: MRQ-179 — unscheduled accepted sessions in the publication panel

## 1. Verdict

**PASS** — Implementation is correct and meets acceptance criteria. Four minor
polish items are listed below; none blocks merge.

## 2. Summary

Reviewed the 13-file diff (branch `MRQ-179`, PR #207) that widens the "Publish
the program" panel from scheduled-only to every accepted, not-yet-public
submission, marking unscheduled ones visible-but-disabled with an explicit
reason, and surfaces publication status on the submission record. The approach
is exactly what the ticket asked for — derived state, no schema change, no
migration — and the publish gate is actually *triple*-enforced (UI disable, API
`can_publish` check, and the untouched SQL count-guard that still requires
scheduled+accepted at write time). I verified the branch matches this diff,
ran the touched node, unit, and integration tests in the `MRQ-179` worktree
(all green), and confirmed `tsc --noEmit` is clean; the regression requirement
holds by construction, since `main`'s own version of the integration test
asserts `not_yet_public: 1` where the branch asserts `2` plus the new candidate
fields. CI fast-gate was still in progress at review time.

Key facts checked against the codebase, not assumed:

- `submission-record.routes.ts:777` already returns top-level `is_published`,
  so the UI-only `RecordData` addition is real data, not a phantom field.
- `agenda_items.room_id` and `rooms.building_id` are both `NOT NULL`
  (migration 0001), so the JOIN→LEFT JOIN rewrite cannot reclassify or newly
  admit any *scheduled* item — the LEFT JOINs only exist to carry the
  unscheduled rows.
- The unscheduled pool (`readPool`) has no `kind` filter either, so accepted
  abstracts appearing in the panel with "needs a room and time" is consistent:
  they genuinely can be dragged onto the agenda from the pool.
- The three untouched unit tests that build `AgendaSnapshot` fixtures all use
  `candidates: []`, so the widened candidate interface breaks no other test.
- D1 `batch()` is transactional and both publish paths dual-write
  `agenda_items.is_published` and `submissions.is_published` together, so the
  new `submission.is_published = 0` predicate and the join's
  `item.is_published = 0` cannot drift apart in practice.

## 3. Issues

**[MINOR] src/ui/agenda/agenda.css:23 — `--warning` token does not exist; the reason line silently renders muted**
The new rule is `color: var(--warning, var(--muted))`, but the design system
defines `--warn`, `--warning-ink`, `--warning-soft`, `--warning-line` — never
`--warning`. The fallback always wins, so the blocked-reason line renders in
the same muted color as the rest of the detail text and the intended warning
tone never appears. Functionally fine (the reason is still visible and
tested), but the styling intent is dead on arrival.
**Fix:** Use `var(--warn, var(--muted))` (defined in both light and dark
token sets) or `--warning-ink` if the wash treatment is wanted.

**[MINOR] src/ui/agenda/AgendaPage.tsx:799 — intro copy overclaims the panel's population**
"Every accepted Session is listed here" is not true once sessions go live:
published accepted sessions leave the list (`submission.is_published = 0`).
The empty state gets this right ("Everything accepted is public"); the intro
contradicts it.
**Fix:** Something like "Every accepted Session that isn't public yet is
listed here. Select a scheduled Session to…".

**[MINOR] src/ui/agenda/AgendaPage.tsx:787 — "Select all 0 Sessions" when every candidate is blocked**
With only unscheduled candidates, the select-all row renders a disabled
checkbox labeled "Select all 0 Sessions". Correctly inert (the diff's added
`disabled={!selectableCandidates.length}` is right), but the copy reads as a
glitch on exactly the screen this ticket creates — a panel full of
visible-but-disabled rows.
**Fix:** When `selectableCandidates.length === 0`, swap the label to e.g.
"Nothing is ready to publish yet" (keep the row rendered so nothing jumps).

**[MINOR] src/ui/agenda/AgendaPage.tsx:803 — batching note keys off total candidates, not publishable ones**
"Publish in batches of up to 90 Sessions" shows when
`publication.candidates.length > MAX_BATCH_PUBLISH_IDS`, which now counts
blocked candidates — e.g. 80 publishable + 20 blocked shows the note even
though no batching will occur. Cosmetic.
**Fix:** Compare `selectableCandidates.length` (pre-slice publishable count)
against the cap instead.

Two non-issues worth recording so the next reader doesn't re-derive them:
the guard added inside `publicationDateTime` is unreachable (the caller
already branches on `candidate.scheduled`, and `starts_at` is `NOT NULL` for
scheduled items) — harmless defensive redundancy; and `scheduled` /
`can_publish` are currently the same SQL expression — a deliberate API
distinction that lets approval diverge from scheduling later without a
contract change, which the ticket's framing explicitly anticipates.

## 4. Positive Observations

- **The gate did not move.** The ticket's hardest constraint — widen what is
  visible, never what is publishable — is honored in depth: the row checkbox
  disables, `batchPublishRoute` now rejects on `!candidate.can_publish` (which
  also subsumes the old missing-id conflict via `get()?.` returning
  `undefined`), and the SQL count-guard in the publish UPDATE still
  independently requires a scheduled, accepted, unpublished agenda item. Even
  a forged API call cannot publish an unscheduled session.
- **No schema change, as instructed.** Publication readiness is derived from
  `agenda_items` presence rather than a new status column, exactly matching
  the "schema questions stop at the operator" rule — and the API shape leaves
  room to introduce one later without breaking consumers.
- **Selection hygiene is complete.** `setPublishSelection` refiltering,
  `selectedCandidates`, `selectableCandidates`, and toggle-all were all
  updated to the `can_publish` subset — no path lets a blocked id linger in
  selection state after a refresh.
- **Test coverage hits both halves of the acceptance criterion in one place**:
  the integration test asserts the unscheduled candidate's full projected
  shape (`scheduled: false`, `can_publish: false`, the exact reason string,
  null slot fields) *and* its absence from the real public API response — and
  it fails on `main` by construction. The unit test renders the actual
  disabled row; the node contract tests pin the source-level invariants.
- **Element stability was taken seriously**: `min-height` on the reason span
  and on the record page's new "Public status" cell, and the record page keeps
  its always-rendered status span rather than swapping layout when a slot
  appears.
- **Accessibility didn't lag the visuals**: the blocked reason is carried in
  the checkbox `aria-label` and `title`, not just as adjacent text, and the
  unscheduled rows sort after scheduled ones so the actionable set stays on
  top.
