# MRQ-176 implementation plan

1. Reproduce the hand-added speaker path against the current Worker route and inspect the
   hand-add and CSV write statements, the canonical roster source, and the FILES panel data
   contract. Confirm the defect on the baseline before changing code.
2. Add a route-level regression test that creates a speaker, reads the roster list and counts,
   checks the matching status tab, and repeats the create operation to prove idempotent counts.
   Keep the test on the real route rather than testing the membership helper in isolation.
3. Fix the canonical data/read seam that drops or misclassifies hand-added speakers without a
   migration. Make the FILES panel separate requested deliverables from profile attachments so
   every visible count describes only the rows it governs and layout remains stable.
4. Run focused tests, the full suite, and the serialized PR gate; inspect the exact diff and
   verify any running Worker/browser evidence required by the ticket. Commit and push the
   implementation, open the GitHub PR, comment the root cause/evidence/PR on MRQ-176, and move
   the ticket through its required validation/open state without merging or deploying.

## Non-goals

- No schema migration, deployment, unrelated roster redesign, or parallel roster query path.
- No merge; the merge warden owns `main`.
