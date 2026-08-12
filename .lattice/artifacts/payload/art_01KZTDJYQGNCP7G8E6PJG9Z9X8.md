# Plan Review: MRQ-125 — Shell truth: event name, branding, IA

### 1. Verdict

**PASS** — Plan is complete, feasible, and aligned. Implementation can proceed.

### 2. Summary

Reviewed the MRQ-125 plan against the task description, spec section T-N1 in `sequence/eval-response-tickets.md`, and the live codebase. Every factual claim in the plan verifies: the stale defaults exist at `src/ui/shell/AppShell.tsx:40` and `src/ui/health/DeliveryHealthShell.tsx:21`, the hardcoded hero note and footer are at `src/routes/landing.route.tsx:180` and `:203`, the seeded form name `"2026 CFP"` is at `scripts/seed/event.ts:243`, and — critically for feasibility — `/api/v1/auth/me` already calls `findDemoEvent()` which does `SELECT *` from `events`, so the event name is one field away from the response with zero new queries. The only concerns are minor: two existing test files carry the forbidden literal and will interact with the new guard, and the landing route actually has seven literal occurrences (the plan's "missing/error fallback" language covers the extra two, but the implementer should enumerate them).

### 3. Issues

**[MINOR] Implementation step 3 — Existing test files carry the forbidden literal and aren't named in the plan**
`tests/integration/auth-demo.test.ts` and `tests/integration/landing.test.ts` both contain `"AIE NYC 2026"`. The landing test almost certainly asserts on the hardcoded footer/hero copy this ticket removes, so it must be updated regardless — but the new guard's allowlist decision (are tests allowed to assert the seeded name, or must they read it from a fixture constant?) isn't made in the plan. An unconsidered allowlist here either breaks the suite or quietly exempts `tests/**`, weakening the guard.
**Recommendation:** During implementation, update `landing.test.ts` assertions to the new dynamic behavior, and decide explicitly whether test files asserting seeded values are allowlisted or refactored to import the name from the seed/fixture module. Prefer the fixture-constant approach — it keeps the guard's allowlist down to genuine seed/fixture paths (`scripts/seed/`, `src/lib/reset-demo/demo-fixture.ts`).

**[MINOR] Implementation step 2 — "Five strings" undercounts the landing route's literal occurrences**
Beyond the hero note (`landing.route.tsx:180`) and footer (`:203`), the literal also appears as the no-row fallback at `:109` and the error fallback at `:293`. The plan does cover these ("replace missing/error fallback names with neutral copy"), so this is a bookkeeping note, not a gap — but the guard added in step 3 will fail on any occurrence the implementer misses, so the count discrepancy should not surprise them mid-implementation.
**Recommendation:** Treat the guard script itself as the enumeration tool: write it first or early, run it, and fix every hit it reports rather than working from the count of five.

**[MINOR] Implementation step 1 — Loading-label behavior should not shift layout**
The plan correctly specifies a non-conference loading label while `/auth/me` is pending. Per the project's fixed-position UI rule, the swap from loading label to real event name must not move the breadcrumb or anything beside it.
**Recommendation:** Reserve stable width/height for the event-name slot (or use a same-length neutral placeholder) so the resolve doesn't cause a visible jump in the shell header.

### 4. Positive Observations

- **Grounded in verified code, not assumption.** The claim that `useIdentity`/`useSeat` already fetch `/auth/me` in the boot path is true, and the handler already loads the demo event row — the plan picked the one API extension that costs nothing extra at runtime, which matters under the R7 speed rule.
- **Excellent scope discipline.** The explicit non-goals (T-N2's public submit path, Section-4-owned `EvaluationPage.tsx`/`ReviewerPage.tsx`, uploads handlers, attachments SQL, `PublicAgendaPage.tsx`) match the file-ownership contracts in the spec exactly, and T-N1 is designated parallel-safe — this plan keeps it that way.
- **The regression guard is the right shape.** Making the prop required kills the type-level path back to a stale default, and the `scripts/checks/` literal guard registered in `pr-gate` kills the string-level path. Both directions of regrowth are closed, which is precisely what "so it cannot grow back" asks for.
- **Seed rename preserves stable identity.** Renaming `2026 CFP` → `Call for Speakers` without touching the form's slug/ID protects the public `/f/cfp` path and any in-flight references — the kind of second-order effect plans often miss.
- **Verification section respects fleet realities:** targeted tests during development, load-aware gate retry per the 45s/120s budget rules, evidence capture, and a clean stop at `pr_open` with no merge/deploy claims.
