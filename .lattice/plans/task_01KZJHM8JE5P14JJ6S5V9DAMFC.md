# MRQ-13: Form builder, catalog, and condition evaluator

BUILDPLAN: M-12 — Wave 1 (§4), walkthrough step 4 · longest single ticket in the plan

Scope (verbatim): Multiple independent event forms with name/kind/status/visibility/response count; new + duplicate (fields/rules, never responses); steps rail, immutable post-open target, all field CRUD/types, per-field validation, participant limits, form admins, lifecycle/open-close-reopen settings, and deep-equal live preview. Seeded baseline visibly includes title/abstract/outcome/format/multi-track, primary speaker profile/headshot, co-speaker, supporting file, and conditional vendor field. **Owns the condition *evaluator* (+2 h, moved out of M-36 by B-7):** the `form_fields.condition` schema shape, the shared `isFieldApplicable()` helper in `src/lib/form-conditions.ts`, client show/hide, and the server rule that a hidden field is neither required nor persisted. The evaluator is load-bearing for a Tier A screen on M-14 and for M-55's applicable-missing-fields computation, both of which land before rank 17 — building it here is what stops M-14 hardcoding a vendor conditional that M-36 would then have to unpick.

File surface: `src/routes/forms.routes.ts`, `forms.queries.ts`, `src/lib/form-conditions.ts`, `src/ui/forms/*`

ACs: AC-17 – AC-21, AC-24, AC-27 – AC-33, **AC-132, AC-133, AC-234**
Hours: 10
Workflow: sub-agent-full (≥7 h)
Shared files: `src/lib/form-conditions.ts` is created here and **added to, never rewritten** by M-14, M-36, and M-55 (§7 shared-helper rule).
Deps: M-09
Note: M-14 exercises AC-132/AC-133 on the public surface, but **M-12 owns those IDs for `trace:ac`**.
Plan: filled in by delegator's plan phase
