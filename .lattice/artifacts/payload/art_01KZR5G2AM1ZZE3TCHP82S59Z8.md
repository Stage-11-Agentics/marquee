# Plan Review: MRQ-53 — Audit: reset drill (A-11 / AC-230)

## 1. Verdict

**PASS** — Plan is complete, feasible, and aligned. Implementation can proceed.

## 2. Summary

Reviewed the cycle-2 plan for the A-11 reset-drill audit against the live codebase. The plan is unusually well-grounded: every machinery reference it makes was verified to exist (`npm run reset:demo` → `scripts/reset-demo.mjs` polling `POST /api/v1/admin/reset-demo` on `localhost:8787`; `WIPE_ORDER` in `src/lib/reset-demo/reseed-demo.ts:8`; exactly-one `mirror_reconcile` enqueue in `src/lib/reset-demo/reset-consumer.ts:25`; `check:seed`, `trace:ac`, and `pr-gate` scripts all present), the M-03 dependency is `done`, and — critically — the plan correctly treats the in-product button as an audit subject rather than assuming it works, which matters because the sidebar control is in fact a stub (`src/ui/shell/Sidebar.tsx:19` calls `unavailable(...)` and never hits the reset route, despite the route existing). Remaining issues are minor calibration points on the dirty-state inventory and the poller oracle; none blocks implementation.

## 3. Issues

**[MINOR] Method step 2 — Dirty-state inventory names surfaces that do not exist as drivable product paths**
Step 2 commits to driving "webhook … rows" through "the real API/UI paths," but there is no product webhook surface: the only webhook columns in the schema are Airtable-mirror bookkeeping on `mirror_state` (`migrations/0001_init.sql:652`), and the mirror itself is stubbed (`check:mirror` → stub for MRQ-25/MRQ-26). Executed literally, this drive step cannot succeed and risks either wasted time or a hand-inserted row that isn't "the real API path."
**Recommendation:** Per mutation class, first confirm the surface exists; where it doesn't, record "surface absent, class skipped" in the audit evidence instead of attempting the drive. The plan's general finding-routing posture already covers this — just apply it to the enumerated inventory rather than treating the list as guaranteed-drivable.

**[MINOR] Method step 3 — Observation mechanism for the queue assertion is unstated**
"Exactly one `mirror_reconcile` message is enqueued" is asserted, but the reconcile *consumer* doesn't exist yet (lands with M-25/M-26 per the comment in `reset-consumer.ts`), so the message can't be observed by watching it get consumed, and the local `wrangler dev` queue isn't trivially inspectable from outside. The plan doesn't say how this count will actually be observed.
**Recommendation:** Name the mechanism — e.g., a `@cloudflare/vitest-pool-workers` integration test invoking `runResetJob` with a spy/counting `MIRROR_QUEUE` binding (the `tests/integration/` harness already exists), or wrangler dev log capture. Same for "mirror change feed short-circuited": assert `mirror_outbox` row count is zero post-reset, which the schema supports directly.

**[MINOR] Method step 5 — Poller oracle is stricter than AC-230 and can false-fail across paired requests**
The oracle accepts only "the pre-reset dirty snapshot or the complete seeded snapshot" for every observed response/count pair. The public agenda and dashboard are fetched as separate requests; a pair that straddles the atomic commit will legitimately mix one dirty response with one seeded response — each individually coherent, jointly matching neither snapshot. AC-230 requires *per-observation coherence* (never zero sessions alongside non-zero speakers), not cross-request snapshot identity.
**Recommendation:** Define the oracle per response: each individual response must match one of the two snapshots for its own surface, and impossible intra-response combinations are rejected. Don't require the agenda+dashboard pair to come from the same snapshot when the requests are not atomic.

**[MINOR] Contract/Method — Scope is generous for a 1-hour fast-track ticket**
The method drives ~12 mutation classes twice, builds a poller harness, and adds a new migration-coverage guard test, against a 1-hour estimate. This is thoroughness rather than misalignment — the guard test is squarely within the "trivially safe audit-only test/guard change" allowance — but the timebox will not survive contact with all of it at equal depth.
**Recommendation:** If time pressure bites, protect the verbatim A-11 core first (mutate → command reset → button reset → double reset → concurrent poller → mirror short-circuit/reconcile) and let the extended side-effect inventory (R2 orphans, outbox drain, saved views, imports) degrade to spot checks with the degradation explicitly recorded.

## 4. Positive Observations

- **The button-as-audit-subject stance is exactly right, and it will pay off immediately.** The sidebar "Reset demo" control is a dead stub (`Sidebar.tsx:19`) even though the route it should call exists and works — precisely the false-green situation the plan's step 4 is designed to catch. The plan will surface a real, routable finding instead of rubber-stamping a label.
- **Grounded, not aspirational.** Every script, file, and mechanism the plan names was verified present: the CLI's job-polling shape matches `scripts/reset-demo.mjs` line-for-line, the exactly-one-reconcile claim matches `reset-consumer.ts`, and the `tests/ac-claims/MRQ-53.json` manifest format matches the existing convention (AC-230 ownership by MRQ-3 confirmed in `tests/ac-claims/MRQ-3.json`).
- **The `WIPE_ORDER`-vs-migrations guard is a genuinely durable artifact** — keyed on table names rather than line numbers, it converts a one-time audit into a standing invariant that catches every future migration that forgets the reset path.
- **Clean auditor discipline throughout:** independent baseline reconstruction, findings routed to owning tickets with `file:line`, explicit `owns: []` manifest, no product repairs, evidence kept outside the public tree, and honest boundary-stating ("do not claim deployed/browser proof if the surface was not reachable").
- **Cycle-1 resolutions are real resolutions**, not restatements — the button question was the load-bearing ambiguity and it was settled in the correct direction.
