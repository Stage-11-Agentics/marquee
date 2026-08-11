# Plan Review: MRQ-52 — Audit — bulk-write path and chunking (Cycle 2)

### 1. Verdict

**PASS** — Plan is complete, feasible, and aligned. Implementation can proceed.

### 2. Summary

Reviewed the MRQ-52 plan (audit ticket A-10, fast-track, post-M-18) against the task description, BUILDPLAN §5, EVALUATION.md, and the live codebase. The plan is unusually strong: every factual anchor it cites was verified real — `runBulkByIds` exists in `src/api/bulk.ts` as the S-3-settled single ID-set transport, M-18 and the S-3 spike are both `done` in Lattice, the outbox idempotency key is in fact `sha256Hex([templateKey, entityId, personId])` (`src/jobs/mail/outbox.ts:38`), `recipientsFor` exists, `pr-gate --ticket` and `trace:ac --ticket` are the real script interfaces, and the `tests/ac-claims/` manifest pattern is established. The only remaining concerns are minor sharpenings around what actually constitutes proof of the D1 parameter cap in a local harness, and the breadth-versus-1-hour tension inherent to fast-track.

### 3. Issues

**[MINOR] Method step 2 / Expected artifacts — Local runtime may not reproduce D1's 100-bound-parameter cap**
Trap 11's whole premise is that the cap "throws only under real data, only at scale" — but the local Worker harness (wrangler/miniflare's SQLite-backed D1) may enforce a different variable limit (SQLite defaults are 999 or 32766, not 100). A 1,000-record drive that *succeeds* locally therefore does not by itself prove no path binds >100 parameters; a bypass could pass the drive locally and still explode in production. The plan partially covers this ("D1 statement/binding observations where observable" and the semantic inventory), but it never states which leg carries the proof.
**Recommendation:** State explicitly in the plan/evidence that Trap 11 compliance is proven by (a) the static inventory/guard showing every ID-set write routes through `runBulkByIds`, plus (b) observed per-statement binding counts where capturable — and that drive *success* alone is treated as completion/notification evidence, not cap evidence. One sentence in the validation section closes this.

**[MINOR] Method scope vs. Hours: 1 — Breadth exceeds the fast-track estimate**
The plan commits to: an AST/source inventory with positive controls, 150- and 1,000-record real-route drives across six bulk families, duplicate-fire idempotency with positive controls, durable-completion assertions, an optional interruption test, empty-selection sweeps across three selector shapes per entry point, and a future-proof guard test. That is excellent audit design but is realistically 2–4× the 1-hour budget.
**Recommendation:** Order the work so the contract-critical core lands first (inventory + guard, 150/1,000 drives, idempotency duplicate-fire, empty-selection on reminders — the AC-66–69/AC-117 spine), with the interruption test and secondary-family empty-selection sweeps as explicitly droppable if time runs out, recorded as "not exercised" in the manifest rather than silently skipped. The plan already conditionalizes the interruption test; extend that framing.

**[MINOR] Method step 4 / claim manifest — AC-69's evaluation method is speed, not durable state**
EVALUATION.md defines AC-69 as `speed:` "bulk-accept 150 records — completes without timeout; longest main-thread task ≤ 100ms (Long Tasks API)." The plan asserts AC-69 "completion from durable state," which exercises the completion half but produces no Long Tasks evidence. The plan's own rule ("only where the evidence actually covers them") handles this in principle, but AC-69 is the one AC where the gap between "exercised" and "evidence type matches" is easy to blur.
**Recommendation:** In `tests/ac-claims/MRQ-52.json`, annotate AC-69 as exercised for completion semantics only, with the main-thread-latency leg explicitly left to its owning speed instrument.

### 4. Positive Observations

- **Every load-bearing claim is real.** This plan names exact files, functions, script flags, and schema fields — and all of them verified against the working tree (`src/api/bulk.ts:135`, `src/jobs/mail/outbox.ts:38`, `scripts/checks/pr-gate.mjs`'s `--ticket` requirement, the `tests/ac-claims/` convention). That is rare in plan review and dramatically de-risks implementation.
- **Vacuity is designed out.** Positive controls appear at every layer — the inventory can't pass empty, the duplicate-fire assertion can't pass on a disabled path, empty-selection checks are paired with non-empty counterparts. This is the single most common audit failure mode and the plan preempts it systematically.
- **The safe/unsafe classification is exactly right.** Distinguishing ID-set placeholder expansion (the Trap 11 hazard) from fixed-binding per-row work prevents both false negatives and a guard that cries wolf on safe imports — and keying the guard on operation/helper/table identity rather than line numbers makes it durable.
- **Auditor discipline is preserved.** `owns: []`, no product fixes in-scope, findings routed with `file:line` + reproduction, and honest labeling ("do not label completion as transactional" without interruption evidence) all match A-10's independent-auditor mandate.
- **Handoff mechanics are complete and correct.** Branch naming, plan-first commit, the full Lattice state chain with actor ID, `pr_open` as terminal, and the c11 handoff target are all specified — nothing for the delegator to improvise.
