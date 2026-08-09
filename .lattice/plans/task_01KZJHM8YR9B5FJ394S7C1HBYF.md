# MRQ-17: Evaluation plan, committees, and reviewer track scopes

BUILDPLAN: M-16 — Wave 1 (§4), walkthrough step 7

Scope (verbatim): Plan, optional weighted scorecard, two rounds, committees, both assignment modes, per-reviewer progress, and explicit one-or-more reviewer track responsibilities editable by managers. One centralized intersection helper is exported for M-17 and audits.

Binding: the centralized helper `src/lib/reviewer-scope.ts` is **the** authorization path. Every reviewer route — queue, record, file, export, evaluation-write — invokes it; A-9 scans for a route that does not.
Non-goal (EVALUATION §5): multi-round beyond two. Two ordered rounds and funnel promotion ship; the schema is round-aware from the first migration, so a third round is data, not a migration.

File surface: `src/routes/evaluation.routes.ts`, `src/lib/reviewer-scope.ts`, `src/ui/evaluation/*`

ACs: AC-53 – AC-58, AC-98, **AC-246**
Hours: 7
Workflow: sub-agent-full (≥7 h)
Shared files: `src/lib/reviewer-scope.ts` — created here, **added to, never rewritten** by M-17 and the audits.
Deps: M-08
Audit that keys off this ticket: A-9 (reviewer event+track isolation), from CP-2
Plan: filled in by delegator's plan phase
