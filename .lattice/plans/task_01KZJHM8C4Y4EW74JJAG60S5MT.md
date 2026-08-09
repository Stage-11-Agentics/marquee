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
