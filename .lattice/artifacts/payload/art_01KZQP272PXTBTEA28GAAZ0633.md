# Code Review: MRQ-21 — Agenda track swimlane and conflicts

Reviewed from the actual branch (`mrq-21-swimlane` at `79609f1`, worktree `Marquee-worktrees/mrq-21-swimlane`), diffed against its merge-base with `forgejo/master` (`246311f`). Note: the diff embedded in this review prompt was computed against a stale base and truncated at 5,000 of 10,450 lines — it is ~95% other tickets' already-merged work (calendar invites, speaker portal, `.lattice` artifacts). The true MRQ-21 surface is 11 files, +494/−60, and that is what was reviewed.

## 1. Verdict

**FAIL (implementation-level)** — the plan is sound and the implementation is close to excellent, but the branch fails its own mandatory PR gate (`test types` check), which the plan's verification order requires before `pr_open`. Two type errors, both one-line fixes. Return to `in_progress` for the trivial rework; everything else verified green.

## 2. Summary

The implementation delivers exactly what the plan promised: a role-aware conflict projection in a new `src/lib/conflicts.ts` feeding the single `getConflicts` aggregator (person overlap **and** Transit `person_ids`), and a structurally honest track board (`src/ui/agenda/track-board.tsx`) with real per-track lane containers, day bands, slot columns, inspectable data attributes, and a conflict-drawer jump action. I independently ran the unit suites (69/69 pass), the agenda integration suite including the new AC-75+AC-79 test, the MRQ-63 transit regression contract (explicitly required by the plan — passes untouched), and the full PR gate. The gate fails at `tsc -p tsconfig.test.json` with two errors introduced by this branch; master passes the same check. With those two lines patched, the **entire** gate passes at 26.2s (budget 30s), including production build, design contract, hermetic fast suite, and merged AC trace with zero uncovered ACs.

## 3. Issues

**[MAJOR] tests/unit/agenda-track-board.AC-78-81.test.ts:116 — PR gate fails: `Map<string, string>` is not assignable to `ConflictMarkers`**
`conflicts: new Map([[agentsSession.id, "Conflict"]])` infers `Map<string, string>`, but `SessionTile` takes `ConflictMarkers = ReadonlyMap<string, ConflictMarker>` where `ConflictMarker = "Conflict" | "Transit"` (AgendaPage.tsx:132–133). Vitest transpiles without type-checking, so the suite runs green, but the gate's `test types` check (`tsc -p tsconfig.test.json`) fails — `npm run pr-gate -- --ticket MRQ-21` exits with `failedCheck: "test types"`. Master passes this check; the branch introduces the failure.
**Fix:** `new Map([[agentsSession.id, "Conflict" as const]])` (verified: this exact change compiles).

**[MAJOR] src/ui/agenda/AgendaPage.tsx:40 — second `test types` error: typed callback on `response.json()`**
`response.json().then((body: { error?: { message?: string } }) => …)` fails under `tsconfig.test.json`, where `json()` returns `Promise<unknown>` (workers-typed lib) rather than the DOM lib's `Promise<any>`. This is latent code, but it is *newly pulled into the test compilation by this branch* — the new unit test is the first test to import from `AgendaPage.tsx` — so the gate failure is this ticket's to fix.
**Fix:** take the parameter as inferred and cast in the body: `.then((body) => (body as { error?: { message?: string } }).error?.message ?? fallback)` (verified compiling). With both fixes applied the full gate passes end-to-end in 26.2s.

**[MINOR] src/ui/agenda/track-board.tsx:100–124 — `localParts`/`sessionDay`/`sessionTime` duplicated from AgendaPage.tsx**
The extraction copied the timezone bucketing helpers instead of sharing them; AgendaPage keeps its own identical copies for the other boards, and track-board also introduces a second `DropCell` implementation alongside AgendaPage's. If the two `Intl.DateTimeFormat` recipes ever drift, tiles could bucket differently per view with no test catching it.
**Fix:** export the helpers (and optionally a data-attributed `DropCell`) from `track-board.tsx` and import them in `AgendaPage.tsx`. Fine to defer to a cleanup ticket given the deadline; flagging so it doesn't fossilize.

**[MINOR] src/ui/agenda/AgendaPage.tsx:608–612 — jump scan enumerates every tile**
`[...querySelectorAll("[data-session-id]")].find(…)` walks all tiles per jump. Harmless at conference scale, but `boardRef.current?.querySelector(`[data-session-id="${CSS.escape(sessionId)}"]`)` is simpler and direct. Also note the single `requestAnimationFrame` after three state updates works because Preact flushes on a microtask before rAF — worth a one-line comment since it's timing-sensitive.
**Fix:** optional simplification; behavior is correct as written.

## 4. Positive Observations

- **AC-81 is genuinely structural, not cosmetic.** One `section[data-track-lane]` per track, `data-track-day-band` per day, `data-track-slot` per cell, tiles nested as lane descendants — and the unit test asserts *containment* (session markup inside its own lane's `<section>` slice, absent from every other lane) plus lane-count invariance under an active track filter. This is exactly the "colour overlay alone fails" contract the ticket demanded.
- **AC-77 coverage is the right shape:** parameterized over all four roles, plus the two-roles-one-person case asserting exactly one person conflict, plus the submitter-role exclusion implicitly proven by the priority dedupe test. The `rolePriority` design (agenda role > roleless legacy fixture > non-schedulable role) keeps old in-memory fixtures working while making the SQL path role-aware — with deterministic winner selection backed by `ORDER BY participation.position` in `SPEAKERS_JSON`.
- **One conflict path preserved.** `sharedConflictParticipants` slots into `getConflicts` without touching Transit geometry or the MRQ-63 message; `transitInputs` uses the same filtered projection, so a submitter can no longer generate a phantom transit conflict. The MRQ-63 contract test passes byte-for-byte, and `deriveConflicts` is kept as an alias so MRQ-20's contract keeps its name.
- **Warn-never-block proven at the API seam:** the AC-75+AC-79 integration test asserts the conflicting POST returns `201`, persists, and surfaces through the same shared `conflicts` payload — the plan's exact evidence commitment.
- **The always-rendered, visibility-hidden conflict flag with `min-height`** (agenda.css:53–54) is a careful application of the elements-never-jump rule — a tile gaining a conflict no longer reflows its neighbors — with `aria-hidden` handled correctly on the placeholder state.
- **Claims hygiene:** `tests/ac-claims/MRQ-21.json` follows the manifest shape, C5 is honestly recorded as an operator/deployed-infra verdict rather than self-signed, and the merged AC trace reports zero uncovered ACs.

## Independent validation evidence

| Check | Result |
|---|---|
| `tests/unit/agenda-conflicts.AC-76-77.test.ts` + `agenda-track-board.AC-78-81.test.ts` | 5/5 pass |
| Full unit suite | 15 files, 69/69 pass |
| `agenda.AC-70-74-252-253` integration (incl. new AC-75+AC-79) + `agenda-transit.AC-258-259` regression | 9/9 pass |
| `tsc -p tsconfig.json` (worker types) | pass |
| `npm run pr-gate -- --ticket MRQ-21` **as committed** | **FAIL — `test types`, 2 errors** |
| Same gate with the two one-line fixes above (patched, verified, then reverted; worktree left clean) | **PASS, 26.2s / 30s budget**, AC trace `uncovered: []` |
