# MRQ-63: Transit conflicts — geography as a scheduling constraint

BUILDPLAN M-58 · ACs AC-258, AC-259 · SPEC Amendment 14 · US-78.

Third conflict class in getConflicts beside room overlap and speaker double-booking: two sessions sharing a speaker, in different pinned buildings, whose gap is smaller than walk + destination access_minutes.

walk = haversine(a,b) * 1.3 / 80 metres-per-minute, floored at 1 minute. The 1.3 is a street-grid detour allowance; claim no more precision than that. Warns, never blocks — same contract as every other conflict.

Must flow into the existing dashboard count, conflicts drawer, and affected tiles through the ONE existing getConflicts call. A parallel path is a defect.

Message shape (from the prototype, verified): 'Transit — 12 min walk to AWS JFK27, plus 10 min building security. Ifeoma Adeyemi needs 22 min; has 10.'

NAMING IS BINDING: the class is Transit, never Travel. 'Travel and accommodation' is already a speaker task meaning flights and hotels, and both land on the same person. Rename across object kind, drawer, tile flag, dashboard label, API conflict type, and copy. AC-259 enforces it with a byte-scan.

Also: building band over the agenda room columns (one cell per contiguous run of rooms sharing a building — the grid encodes geography before any map does), and room headers drop the now-redundant building suffix.

Depends on M-57's re-seed. Without it there is nothing to detect and this ticket cannot demonstrate itself.

## Working plan (rough, written before implementation)

1. Reconcile the branch with the current `forgejo/master` boundary, then read the binding product/design artifacts and the merged MRQ-62/MRQ-20 code paths. Confirm the one authoritative `getConflicts` call, the seeded Transit fixture, and existing room/speaker conflict presentation before editing.
2. Establish a baseline with the relevant tests and checks. Preserve MRQ-62's geometry/helper ownership; do not add a haversine, walking-time formula, or parallel conflict evaluator. Keep the conflict kind and every surface/API label as `Transit`, while preserving the legitimate speaker task text.
3. Wire the existing conflict result through the existing agenda/dashboard data flow so Transit participates in the dashboard count, conflicts drawer, and affected tiles exactly like the other warning classes. Preserve warn-only placement behavior and the v1.9 stable layout contract; implement the building band and de-suffixed room headers if the current tree has not already received that portion of M-58.
4. Add an AC-tagged test under `tests/` that proves the surface-facing flow through the single `getConflicts` path, plus `tests/ac-claims/MRQ-63.json`. State explicitly that MRQ-62 owns geometry/seed existence for AC-259 and MRQ-63 owns surfacing it. Run the required `grep -rn "Travel" src/ scripts/ migrations/` scan and confirm every hit is the speaker task.
5. Self-review the complete diff inline (headless reviews are suspended), attach a standard-shape PASS review naming the exact HEAD, run the live validation path so the seeded Transit conflict is observed on dashboard load/count/drawer/tiles, then run `npm run pr-gate -- --ticket MRQ-63` and preserve its output.
6. Commit logical units with the worktree-root guard, push immediately after the first and every meaningful commit, open the Forgejo PR against `master`, attach the PR reference, and stop at `pr_open` after reporting the gate and live evidence to the Orchestrator.

## Scope and non-goals

- In scope: M-58/AC-258/AC-259 transit-conflict surfacing and the specified agenda geography presentation.
- Out of scope: replacing or duplicating MRQ-62 geometry/seed logic, changing speaker task semantics, blocking placement, editing contract documents, or merging the PR.
- Plan-review stage is skipped per the boot instruction that headless reviews are suspended; any implementation review findings will be resolved inline before validation.
