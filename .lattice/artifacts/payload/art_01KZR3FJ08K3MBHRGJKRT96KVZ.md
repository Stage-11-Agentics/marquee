# Plan Review: MRQ-51 — Reviewer event/track isolation audit (Cycle 2)

### 1. Verdict

**PASS** — Plan is complete, feasible, and aligned. Implementation can proceed.

### 2. Summary

Reviewed the five-step audit plan (surface inventory → authority-layer source comparison → adversarial runtime probes → AST machine guard → self-review/pr-gate) together with the Cycle-1 resolutions, and verified its load-bearing claims against the repository. Every referenced artifact exists as described: `authorizeReviewerScope` is centralized in `src/lib/reviewer-scope.ts` and called from every `Reviewer`-tagged operation in `src/routes/review.routes.ts` (queue, queue context, comparison queue/write, record, files, export, evaluation write); the route manifest lives at `src/routes/_manifest.ts`; the MRQ-35 routing path exists in `src/routes/public-form-routing.ts`; `tests/node/` contains the AST-inventory pattern to model on; and `npm run pr-gate` is a real script. The plan is well-grounded, correctly scoped as audit-only, and covers both ACs; remaining concerns are minor.

### 3. Issues

**[MINOR] Step 1 — Round-one→round-two funnel may live outside the reviewer route file**
A quick scan finds no advance/promote funnel operation in `src/routes/review.routes.ts` or `src/routes/evaluation.routes.ts`, so the MRQ-28 funnel writer likely lives elsewhere. The plan already defends against this by committing to a manifest-driven inventory rather than an assumed list, but a file-scoped sweep could still miss it.
**Recommendation:** When executing step 1, locate the MRQ-28 funnel by operation/behavior (assignment- or evidence-creating writes) across all route modules, not by filename — the Cycle-1 resolution's "follow MRQ-28 and MRQ-35 into their non-`Reviewer` write paths" clause should be treated as binding here.

**[MINOR] Step 4 — Guard should sit beside, not duplicate, the existing A-5 boundary guard**
`tests/node/auth-boundary.test.mjs` is the A-5 audit's contract guard (session-writer enumeration) built on the same AST-walking helpers. The new reviewer-scope guard will re-implement `walk`/`callSites` style scaffolding.
**Recommendation:** Either share the AST helpers or accept the small duplication deliberately, but keep the new guard in its own file (e.g. `tests/node/reviewer-scope.AC-214-246.test.mjs`, matching the existing AC-suffixed naming convention) so the two audit contracts stay independently owned.

**[MINOR] Scope vs. budget — 1 hour is tight for five steps**
Adversarial fixtures across two rounds plus the automatic-routing path, before/after row-count snapshots on denied writes, a new AST guard, and the full pr-gate/PR ceremony is a lot for the 1-hour estimate, even on fast-track.
**Recommendation:** If time pressure hits, protect steps 2–3 (the actual audit findings and runtime proof) and the AC-214 out-of-scope ID probe first; the guard's inventory breadth can be trimmed to reviewer-tagged operations plus the two known non-`Reviewer` writers rather than a fully general sweep.

### 4. Positive Observations

- **The Cycle-1 resolutions closed the right gaps and are honored in the plan body.** The manifest-first inventory (no assumed route list), the explicit "scanned and excluded with reason" ledger for manifest-visible but reviewer-unreachable routes, and the hard "no product implementation change is authorized" boundary are exactly the disciplines an auditor-who-didn't-write-the-code ticket needs.
- **Non-vacuous testing is designed in, not bolted on.** Positive in-event/in-track controls before the denial probes, and row-count snapshots asserting denied writes change nothing, prevent the classic vacuous-audit failure where every assertion passes because the fixture never reached the guard.
- **The four authority layers are compared at source, by ticket lineage** (MRQ-3 schema constraint, MRQ-18 centralized helper, MRQ-33 pre-write guard, MRQ-35 routing path), with the specific failure mode named — duplicate SQL whose event boundary or track intersection diverges from the centralized helper. That is precisely where an isolation leak would hide, and the codebase check confirms the helper and both auxiliary paths exist where the plan says they do.
- **AC coverage is direct and testable:** the AC-214 probe (out-of-scope submission ID → 403 with no metadata) appears verbatim as a runtime assertion, and AC-246's audit-evidence obligation is satisfied by the findings ledger, the runtime proof, and the durable machine guard.
- **Public-repo hygiene is explicit** — the guard is specified as free of ticket, internal-host, and credential data, which matters given the competition's open-source requirement.
