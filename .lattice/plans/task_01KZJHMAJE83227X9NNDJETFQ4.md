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

## Rough implementation plan (MRQ-34)

1. Rebase `mrq-34-views` onto the current `forgejo/master`, refresh dependencies with
   `npm ci`, and inspect the MRQ-8/MRQ-9/MRQ-13/MRQ-33 contracts and existing route,
   schema, form-condition, list, builder, and auth patterns. Establish a baseline with
   the repository's focused tests and `npm run pr-gate -- --ticket MRQ-34` where practical.
2. Preserve and reuse the existing list query vocabulary (`page`, `per_page`, `q`,
   `sort`, `filters`) and `isFieldApplicable()` from `src/lib/form-conditions.ts`.
   Add only the shared behavior needed by the saved-view/Draft consumers; do not create
   a second evaluator or re-derive required fields.
3. Implement the fixed column registry and configurable submissions list behavior:
   exactly the eleven named columns, with Title always present and immovable; stable
   widths/order and honest empty values (`—`) in the UI.
4. Implement personal, conference-scoped saved-view CRUD for query/filters/sort/column
   order, with immutable built-ins and authorization through the credential-resolved
   form-admin/program-staff principal. Use generated `*.routes.ts` modules for every
   API route and keep the existing list response contract.
5. Implement the authorized `Drafts needing attention` surface with count, contact,
   last-save, and applicable missing fields. Prove the decisive hidden/revealed
   conditional-field pair: hidden missing is not attention; revealed missing is.
   Opening/editing a draft must remain read-only and never submit it. Prove unauthorized
   access with both status and absence of draft content in the response body.
6. Add the builder field-list condition summary affordance only; render the evaluator's
   known conditions without opening/editing a field. Keep the summary legible and
   non-layout-jumping per the binding prototype/design rules.
7. Add AC-tagged tests under `tests/` and `tests/ac-claims/MRQ-34.json`, run focused and
   full local validation, inspect the diff, and perform an inline self-review. Attach a
   standard-shape PASS review naming the exact HEAD, run the mandatory PR gate, commit
   meaningful units, push after the first and each subsequent meaningful commit, open
   the Forgejo PR against `master`, attach its reference, and finish at `pr_open`.

## Verification targets

- AC-134: condition summary is visible in the builder field list without opening a field.
- AC-247: event-scoped personal view CRUD round-trips the existing list query shape and
  built-ins cannot be mutated; authorization is enforced.
- AC-248: exactly the eleven registry columns are available and Title cannot be removed
  or reordered out.
- AC-249: Draft queue exposes count/contact/last-save/applicable missing fields, uses
  `isFieldApplicable()` output, preserves read-only behavior, and fails closed for an
  unauthorized reader without leaking draft content.

## Reset 2026-08-11 by agent:delegator-mrq-34

## Reset 2026-08-11 by agent:delegator-mrq-34
