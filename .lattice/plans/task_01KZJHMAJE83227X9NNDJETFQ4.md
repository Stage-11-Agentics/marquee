# MRQ-34: Saved views, configurable columns, Draft queue, and builder condition summary

BUILDPLAN: M-55 (rank 6, US-76) + M-36 (rank 17, US-11) — Wave 2 (§5) · MERGED at mint (6 h + 1 h = 7 h; M-36's dependency set {M-12} is a subset of M-55's {M-08, M-12}, and both surface the same condition evaluator — AC-249's "applicable missing fields" is `isFieldApplicable()`'s output, AC-134 is the same conditions rendered in the builder list)

**M-55 — Saved views, configurable columns, Draft queue** (6 h, ACs AC-247 – AC-249, deps M-08/M-12)
Scope (verbatim): personal event-scoped view CRUD captures query/filters/sort/column order; immutable built-ins; fixed column registry with Title mandatory; `Drafts needing attention` count/contact/last-save/applicable-missing-fields **computed through M-12's `isFieldApplicable()` helper, never against the full required set** (a draft must not be marked incomplete for a field its submitter can never see); opening/editing never submits; form-admin/program-staff authorization.
Column registry (AC-248): Type, ID, Title, Speakers, Status, Tracks, Score, Submitted, Last updated, Origin, Missing fields. **Title is mandatory.**

**M-36 — Conditional logic, builder-list summary** (1 h, AC-134, dep M-12)
Scope (verbatim): **builder-list summary affordance only** — conditions visible in the field list without opening a field. The evaluator (schema, `isFieldApplicable()`, client show/hide, hidden-not-required) is M-12's, built in Wave 1.

ACs (union): **AC-134, AC-247 – AC-249**
Hours: 7 (6 + 1)
Workflow: sub-agent-full (≥7 h combined)
Shared files: consumes `src/lib/form-conditions.ts` (M-12's) and M-08's column registry — **add to them, never rewrite** (§7).
Deps: M-08, M-12
Plan: filled in by delegator's plan phase
