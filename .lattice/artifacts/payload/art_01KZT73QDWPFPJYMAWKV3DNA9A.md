# Plan Review: MRQ-102

### 1. Verdict

**FAIL (plan-level)**

The plan is well-shaped but silent on a hard conflict baked into the ticket itself: AC-1 requires "System health" to be reachable from the sidebar in the `utility` group, and the sidebar physically cannot render a utility-group route without editing `src/ui/shell/Sidebar.tsx` — which is on the MUST NOT TOUCH list. That must be resolved (with the orchestrator, or by an amended ticket) before implementation starts, or the delegator discovers it mid-build and improvises.

### 2. Summary

Reviewed the MRQ-102 execution plan (split delivery health into Speaker follow-ups and System health, make the owed headline clickable, attribute the send allowance to the email configuration) against the ticket and the live code in `route-table.ts`, `Sidebar.tsx`, `app.tsx`, `delivery-health.ts`, `health-surface.routes.ts`, the design-contract check, and the route-table tests. The plan's scope, verification, and hygiene (worktree, rebase, MRQ-74 comment) are solid, but it never confronts the Sidebar.tsx ownership conflict, omits `src/ui/app.tsx` from its file inventory even though the entry dispatch must change, and asserts "no API or schema change" while planning a summary refactor that lives inside the API payload's zod schema.

### 3. Issues

**[CRITICAL] Implementation steps 3–4 — AC-1 is unreachable without touching Sidebar.tsx, which is forbidden**
`Sidebar.tsx` renders exactly three groups — `routesFor("home")`, `routesFor("pipeline")`, `routesFor("modules")` — and a hardcoded footer link (`⌘ API & CLI`). No code path renders utility-group routes; today no utility route even has `sidebar: true`. So adding `{ group: "utility", sidebar: true }` to the route table (the only lever inside the plan's ownership list) produces a route that appears nowhere. AC-1 demands System health be "reachable from the sidebar" in the utility group, while File ownership says MUST NOT TOUCH `src/ui/shell/Sidebar.tsx` (open PR #53). The plan's step 3 — "using the new labels and route groups" — assumes route-table edits are sufficient. They are not.
**Recommendation:** The plan must state its resolution explicitly before implementation: either (a) request a scoped exception from the orchestrator to add a utility-group render to Sidebar.tsx *after* rebasing past PR #53's merge (the ticket already expects #53 to land first), or (b) get the ticket amended on where System health actually surfaces. Do not leave this to be discovered at build time.

**[MAJOR] Scope / Implementation — `src/ui/app.tsx` must change but is absent from the plan and outside the ticket's OWNS list**
The client entry dispatches on pathname: `app.tsx:35` routes `/delivery-health` to `DeliveryHealthShell` and everything else non-public to `AppShell`. Two new external routes need two new dispatch branches, so `app.tsx` will be modified — yet the plan never names it, and the ticket's OWNS list doesn't include it (it is also not on MUST NOT TOUCH, so this is a gap, not a violation). The plan also never decides what happens to the old `/delivery-health` URL: with the dispatch branch removed, the SPA fallback serves the path but `matchRoute` misses and the operator's existing bookmark/muscle-memory URL dead-ends — on the very screen the operator was just using live.
**Recommendation:** Add `src/ui/app.tsx` to the plan's file inventory (and flag the ownership gap in the PR), and state the fate of `/delivery-health` explicitly — a redirect to `Speaker follow-ups` is the cheapest way to keep zero dead ends, which the walkthrough rubric grades.

**[MAJOR] Implementation step 2 — "two summaries, no API or schema change" is self-contradictory as written**
`summary` is not a UI-side derivation: it is a field of `DeliveryHealthSnapshot` (`delivery-health.ts:209`), which is the response body of `GET /api/v1/events/{eventId}/delivery-health`, validated by `deliveryHealthSchema` (`health-surface.routes.ts:477`). Refactoring `summarize()` into speaker-follow-up and system-health summaries either changes that payload (an API/schema change the plan forswears) or must be done another way. The snapshot already carries everything both pages need (`capabilities`, `quota`, `owed_urgent`, `owed_href`), so a clean no-API-change path exists — derive each page's summary client-side, or add fields additively — but the plan doesn't say which mechanism it intends.
**Recommendation:** Name the mechanism: e.g., "both pages fetch the existing snapshot; each derives its own summary in `src/lib/delivery-health.ts` functions consumed client-side; the existing `summary` field is left intact (or additively extended with a schema update, justified in the PR per the ticket's escape hatch)."

**[MINOR] Implementation step 2 — the headline-link destination is vaguer than it needs to be**
The snapshot already ships `owed_shown` and `owed_href`, and the ticket demands the count and destination agree even when `OWED_LEDGER_LIMIT` caps the ledger. The plan's "stable urgent-ledger destination whose filter semantics and displayed/capped count agree" restates the requirement without committing to a design (anchor on the same page? query-filtered view? reuse of `owed_href`?).
**Recommendation:** Pin the destination concretely — reusing/extending `owed_href` is the obvious seam — and state the capped-list notice copy obligation ("showing the 50 most urgent of 364") as an explicit deliverable tied to AC-4.

**[MINOR] Implementation step 4 — sidebar order within the modules group is unspecified**
`tests/unit/route-table.test.ts:5` pins the exact label order, and the ticket places Speaker follow-ups "near Communications." The plan says it will update the contract tests but not where the new entry slots, which is precisely the decision that contract exists to make deliberate. (Note also that `verify-design-contract.mjs:28`'s pinned label list does not currently contain "Delivery health," so the "update" there is *adding* the two new labels, not replacing one — worth knowing before editing.)
**Recommendation:** State the intended order (e.g., immediately after Communications) in the plan so the contract-test diff is a confirmation, not a choice made in passing.

### 4. Positive Observations

- The plan respects every piece of project hygiene that has bitten this repo before: isolated worktree off `github/main` (primary checkout stays parked), rebase immediately before the PR because PR #53 touches `DeliveryHealthShell.tsx`, no edits to MRQ-74's plan (comment instead), and no deployment claimed.
- Verification is the right kind: real timings against the 45s/120s budgets with a contention caveat, and browser-driven screenshots matching the ticket's three-artifact requirement, including the count-agreement shot for AC-4.
- Scope discipline is good — "no API or schema change" as a stated goal, the MUST NOT TOUCH list restated, and adversarial summary-separation tests planned for AC-2/AC-3, which is exactly the failure mode (infrastructure alarm headlining the people page) the operator complained about.
- Keeping the fixed-shape loading contract ("elements never jump") explicitly on *both* pages shows the plan read `DeliveryHealthPage.tsx`'s constraint rather than just the ticket.
