# MRQ-110 code review

Verdict: PASS

Reviewed commit: `28094db50515ba47a28068cf5f65624de38fcd1a` (branch HEAD),
stacked on parent `fd7e46a2a7b32cc6a1d4f270dfccfb3d0c54dbcb`.

The independent exact-head reviewer was allowed the full 600-second contract
timebox and returned no output; the Lattice daemon recorded a timeout. This is
the documented self-review fallback. The preceding independent FAIL findings
were triaged into Plan-Review Cycle 6 and fixed in `3006331`; `28094db` records
that authoritative resolution in the committed plan.

Adversarial review of the current tree:

- The mobile `Declare conflict` action has an explicit 48px target in
  `src/ui/review/review.css:136`, and the save-row controls share centered
  alignment and spacing via `.review-save-actions:65`. The standalone Save
  margin is neutralized only inside that row, preserving the comparison-card
  Save spacing. The source regression is in
  `tests/unit/reviewer-surface.AC-61-158-159.test.ts:50`.
- Chair coverage preserves three states in
  `src/ui/evaluation/EvaluationPage.tsx:442-451`: undefined is loading,
  null is unavailable, and an empty object is successful empty coverage. Only
  the coverage column prints the state sentence; the action column uses a dash
  without an action. The duplicate reminder notice now says it is queued
  today, matching the event-local-day idempotency key.
- Cross-event round pool inputs are rejected as field-addressable 422s by the
  `committeeForEvent` field seam in `src/routes/evaluation.routes.ts:294`,
  while direct committee routes retain their 404 behavior. Both create and
  patch paths are exercised in the integration test.
- The core MRQ-110 data contract remains intact: nullable round-scoped
  committees, abstention writes that clear review values, aggregate exclusion
  and visible reassignment state, and narrow idempotent reviewer outbox
  reminders outside the communications audience engine. Failed reviewer
  writes still preserve local drafts because `commitReview` updates drafts only
  after the awaited POST.

Verification at this exact head:

- `npm run pr-gate -- --ticket MRQ-110`: PASS; 134 tests, hermetic suite
  19,807 ms, total 23,327 ms, API 136 operations, and merged AC trace with
  zero warnings/errors/uncovered claims.
- `node scripts/schema-verify.mjs`: PASS — 48 tables, 121 named indexes, 92
  foreign keys, 3 triggers.
- `npm run check:seed`: PASS — 27,353 ms, deterministic local Wrangler seed
  checks green.
- Targeted API/UI tests: 27/27 passed; worker and client TypeScript checks
  passed; the generated API registry and trace checks passed.
- Live local validation: `/health` returned build `28094db50515`; the OpenAPI
  document served 200 with 136 operations; the evaluation shell served 200;
  the authenticated plans route correctly returned 401 without credentials.
  The c11 browser surface could not be opened after two socket timeouts, so no
  browser surface was left running; the local Vite server was stopped cleanly.

Findings: none.
