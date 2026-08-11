# MRQ-11: Program dashboard

BUILDPLAN: M-10 — Wave 1 (§4), walkthrough step 3

Scope (verbatim): Seven-stage pipeline card (every count clickable to the filtered list behind it), Scheduled/Published explanatory sub-labels, attention strip, wave planner, work-in-motion metrics, speaker-task preview. 5 s SWR poll for liveness.

Recorded decision F-8: liveness is a **5 s poll**, not a push channel.
Amendment 5 fold (AC-240): the Scheduled and Published stage cards carry clarifying sub-labels — "placed on the working agenda" / "live on the public site". The copy is exact and gate-checked.
Felt checkpoint C2 runs against this surface: the operator opens it and names their next action without hunting. A report says what happened; a home says what to do.

File surface: `src/routes/dashboard.routes.ts`, `src/ui/dashboard/*`

ACs: AC-14 – AC-16, **AC-240**
Hours: 4
Workflow: inline-full
Shared files: none — module-local.
Deps: M-08
Speed: AC-16 is an AC-sourced budget — dashboard full render p95 ≤ 1000 ms against the seed, measured by `check:speed` on deployed infra.
Plan: filled in by delegator's plan phase

## Implementation plan

**Pinned base:** `forgejo/master @ 25b234d2bb0150b427f5dcb704c34bd1f59c883c`.

1. Add `src/routes/dashboard.routes.ts` (the required manifest-discoverable name) with an authenticated `GET /api/v1/events/{eventId}/dashboard` route. Its response will contain one D1-derived dashboard snapshot: all seven pipeline counts, track and format mixes, wave targets/progress, the attention-strip values, aggregate work-in-motion figures, and a bounded speaker-task preview. The route will not return a materialized dashboard or seed constants.

2. Make the dashboard's stage/category predicates the same predicates used by the submissions list, rather than reimplementing status derivation in the browser. Extend the existing list contract only where needed for an exact destination filter (`onboarding` derived from open speaker tasks and `format`); preserve scheduled/private versus published/public semantics. Dashboard count links will be generated from those server-recognized filters so every displayed count lands on a result set with the same cardinality.

3. Build `src/ui/dashboard/DashboardPage.tsx` and scoped Flight Deck CSS. Reproduce the prototype's seven-column instrument strip, exact Scheduled/Published sub-labels, attention strip, wave planner, work-in-motion panel, format/track pressure, and task preview. All counts use tabular monospaced figures and every count is a semantic button/link to the matching submissions filter. The dashboard does not invent status data, task data, or values from seed constants.

4. Implement an honest state machine: fixed-geometry loading placeholders; an empty state that preserves the pipeline shape at zero; a retryable error state that leaves prior successful data visible when possible. Fetch once on entry and revalidate the same snapshot every 5 seconds (F-8 SWR); clear the interval and abort an in-flight request on route exit.

5. Wire `/dashboard` in `AppShell` and add an AC-tagged integration/UI test under `tests/` plus `tests/ac-claims/MRQ-11.json`. The test will mutate the D1 fixture between requests and prove status, track, format, wave, and task-derived counts update from the database; it will assert every dashboard link's filter/result correspondence and exact AC-240 Scheduled/Published copy. It will also assert the declared five-second revalidation interval without using a wall-clock wait.

6. Self-review the exact diff and current `HEAD` inline (headless plan/code review is suspended), then run the focused test, `npm test`, `npm run check:api`, `npm run trace:ac -- --scope=merged --ticket MRQ-11`, build/type/design checks through `npm run pr-gate -- --ticket MRQ-11`, and a local `wrangler dev` + curl dashboard request for a real runtime validation. Record review and validation artifacts before PR creation.

## Risks and decisions

- The binding prototype's Scheduled visual total includes Published in its local mock state, while the shipped submissions API intentionally distinguishes private scheduled slots from published ones. The implementation uses the API's canonical filter semantics for both the tile and its destination, so AC-15's count-to-result invariant remains true; the visual structure and exact AC-240 explanatory copy remain unchanged.
- The prototype's onboarding value is speaker-oriented while the dashboard count must open a submission list. The route will count distinct submissions with open speaker tasks and use the same derived `status=onboarding` list predicate, while overdue speakers/tasks remain separately and explicitly labeled in the attention/task-preview surfaces.
- AC-240's list/record/portal/board slot rendering and publish action are owned by their respective surface tickets. This ticket implements the M-10 dashboard portion: exact Scheduled/Published stage copy and links into the authoritative list filters.
