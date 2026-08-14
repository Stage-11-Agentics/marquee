# MRQ-172 implementation plan

## Scope

- Inspect the submission-record evaluation data and the existing EVALUATION PANEL
  rendering, preserving `EvaluationEvidenceRow` as the canonical evidence card.
- Add an at-a-glance per-review summary in the EVALUATION PANEL that keeps the
  reviewer, recommendation, overall rating, and reviewer comment together.
- Preserve honest abstention behavior and make organizer overrides visibly
  distinct from reviewer-authored rating/comment content.
- If a long comment needs disclosure, reserve its layout space so expansion does
  not move surrounding controls or rows.
- Add a regression test that fails on main and proves the panel renders the
  reviewer comment and override provenance together.

## Verification

- Capture the current test baseline before implementation.
- Run the focused regression test, then `npm test`.
- Run the serialized `npm run pr-gate` command from the ticket before opening the
  PR; do not deploy or perform a migration.
- Re-read the ticket's verbatim pass criterion and record the actual test/runtime
  evidence in the ticket comment and PR handoff.
