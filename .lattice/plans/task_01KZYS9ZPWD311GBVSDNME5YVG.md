# MRQ-178 implementation plan

1. Trace the onboarding deliverables grid from route data through rendered task-column order, styles, and existing tests; confirm why newly authored tasks land beyond the 1280px viewport.
2. Establish the baseline behavior and add a regression assertion that fails on `main` for the newest task's rendered column position/reachability while preserving the existing task-type filter and speaker row identity.
3. Implement the smallest canonical UI fix that makes the newest task visible at the grid's initial 1280px view, removes the apologetic non-affordance, and keeps geometry stable while filtering or changing columns.
4. Verify the regression and relevant suite, then run the serialized `npm run pr-gate` command from the ticket; inspect the exact diff, commit, push, and open one draft PR against `github/main`.
5. Comment on MRQ-178 with root cause, exact verification commands/A-B evidence, and PR number; transition the ticket to `pr_open` for the merge warden.

Non-goals: schema or migration work, deployment, changes to the evaluation machinery, unrelated onboarding behavior, or merging the PR.
