# Plan Review: MRQ-124 — Batch publish in the agenda builder

### 1. Verdict

**PASS** — Plan is complete, feasible, and aligned. Implementation can proceed, with the issues below addressed during implementation (none require returning to planning).

### 2. Summary

Reviewed the five-step delivery plan for AIA-07 batch publish plus the agenda-slot accessibility work, verified against the actual codebase (`submission-record.routes.ts` publish route, `agenda.routes.ts`, `AgendaPage.tsx`, spec section T-L in `sequence/eval-response-tickets.md`). The plan is faithful to the task, correctly preserves the reversal-safety `status='accepted'` guard, and explicitly excludes auto-schedule. The key concern is that publish eligibility in this codebase is **three-way** — scheduled AND accepted AND unpublished — and the plan's step 2 only names two of the three conditions; the implementer must mirror the per-record route's full semantics, including its dual-table write.

### 3. Issues

**[MAJOR] Delivery plan step 2 — Eligibility predicate is incomplete: "unpublished accepted" omits the scheduled-slot requirement**
The existing per-record route (`submission-record.routes.ts`, `publishSubmission`) enforces *two* preconditions: an `agenda_items` row must exist (`"schedule the Session before publishing it"`) **and** `status='accepted'`. The plan's read model describes "the exact unpublished accepted records available to publish" and the write validates "selected IDs and accepted status" — neither mentions the slot requirement. An accepted-but-unscheduled submission has nothing to publish; including it in the batch-eligible set (or in the "not yet public" counter denominator) would either fail or, worse, silently publish a slotless record. This also defines the counter: "23 live · 1 not yet public" must be computed over **scheduled** sessions (`agenda_items` rows), not all accepted submissions.
**Recommendation:** Define eligibility explicitly as: has an `agenda_items` row (kind='session'), `submissions.status='accepted'`, `is_published=0`. Derive both counter terms from `agenda_items` joined to `submissions` so the denominator matches what batch publish can actually act on.

**[MAJOR] Delivery plan step 2 — "One transaction" needs to be D1 `DB.batch()` with write-time guards, not read-then-write validation**
D1 has no interactive transactions; the codebase idiom is `context.env.DB.batch([...])` (used by the per-record publish and throughout `evaluation.routes.ts`/`forms.routes.ts`). That means any "validate then publish" sequence has a read-then-write gap: a reversal (withdraw/reject) landing between the validation read and the batch write would publish a no-longer-accepted speaker — exactly the bug class the reversal-safety comment exists to prevent, now with a wider window because N records are involved. Note also that publish is a **dual-table write**: the per-record route sets `is_published=1` on both `agenda_items` and `submissions`; the batch must do the same for every record or the two tables drift.
**Recommendation:** Validate up front for good error messages, but *also* guard the batch statements themselves — e.g. `UPDATE ... WHERE ... AND (SELECT status FROM submissions WHERE id = ?) = 'accepted'` or equivalent per-pair conditional statements — so accepted status is enforced at write time. Include both table updates per record in the same `DB.batch()` call, and reconcile the returned counts against the selection so the UI can report anything that was skipped.

**[MINOR] Delivery plan (whole) — Files to be created/modified are not named**
The plan speaks in conventions ("existing route/query conventions", "builder chrome") but never names concrete files. From the codebase, the likely touch set is: `src/routes/agenda.routes.ts` (or a new builder-scoped route module), `src/routes/agenda.queries.ts`, `src/ui/agenda/AgendaPage.tsx` (648 lines, five views: day/week/room/track/list), `src/ui/agenda/agenda.css`, `src/ui/agenda/track-board.tsx`, plus tests. Naming them would sharpen the file-ownership picture the ticket register depends on (T-L is listed as parallel-safe against other tickets given file-ownership rules).
**Recommendation:** List the intended files in the plan or the first implementation commit message, and confirm none collide with in-flight sibling tickets.

**[MINOR] Delivery plan step 4 — Accessibility scope should acknowledge what already exists and target the actual gap**
`AgendaPage.tsx` already carries partial ARIA (list view has `role="table"`/`role="row"`, resize buttons have `aria-label`s, view tabs are a proper `tablist`). The CFP-S4 failure was specifically **drop targets** (empty slot cells) exposing no accessible refs across the grid views. A blanket "add roles everywhere" pass risks churning working markup; the gap is the slot/drop-target cells and the unscheduled pool.
**Recommendation:** Scope step 4 to the drop-target cells (room/time/day context in the label, e.g. "Empty slot — Main Hall, Tuesday 10:00"), the unscheduled pool items, and any occupied-slot tiles that lack names — leaving the already-correct list view and tablist untouched.

### 4. Positive Observations

- **The reversal-safety guard is treated as load-bearing, not incidental.** The plan quotes the constraint, explains the failure mode, and step 5 includes a rejected/withdrawn negative-control test — exactly the right response to a bug class that was already caught once pre-merge.
- **Scope discipline is explicit.** Auto-schedule is named as out (matching T-L's "WON'T — 0.56 points" ruling), and step 1 opens with "do not broaden publishing" — the plan solves what was asked, no more.
- **Server-truth refresh** (step 2's "return the resulting public-agenda URL and count so the UI can refresh from server truth") and step 3's "controls that claim success without a server response" adversarial check directly target the honesty failures this eval has repeatedly punished.
- **The "elements never jump" rule is baked in** ("keep status regions space-reserved") rather than left to review — consistent with the standing UI ruling and the T-H precedent of reserving the status line's space.
- **Verification is honest about tooling limits:** the plan commits to a real browser pass through the full flow where possible, and to a precise N/A note rather than passing source tests off as browser proof.
- The verification section correctly enumerates the sharp edges (partial batch writes, stale counts, cross-event IDs, data leakage) — the adversarial checklist matches where the real risks are.
