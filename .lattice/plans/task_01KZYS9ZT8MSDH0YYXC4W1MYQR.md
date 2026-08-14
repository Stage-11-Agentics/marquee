# MRQ-179 implementation plan

## Goal

Make the publication gate cover every accepted session. An accepted but unscheduled session must be visible in the “Publish the program” panel with a disabled publication control and an explicit room/time reason; it must remain absent from the public agenda.

## Investigation

- Trace the publication-panel query, session status/record contract, and public-agenda filter.
- Determine whether the existing model can represent the required visibility without schema change.
- If a genuine per-session content/publication status field requires a migration, stop and flag the coordinator before editing migrations or implementation.

## Implementation

- Extend the existing publication-panel path and its canonical view model only as needed to include accepted unscheduled sessions.
- Preserve the existing publication safety gate and make the disabled reason explicit in rendered UI.
- Surface the session’s current publication/content state on the session record using the existing contract where possible.
- Add a regression test that proves both panel visibility/disabled state and public omission.

## Verification

- Establish the baseline test result before changes.
- Run focused regression tests, `npm test`, and the serialized `npm run pr-gate` command from the ticket.
- Inspect the rendered/running behavior if the touched surface supports a local Worker flow, and record the observed evidence separately from test inference.
- Commit, push, create one PR against `github/main`, comment the root cause/verification/PR number on MRQ-179, and transition the ticket according to the Lattice lifecycle without merging or deploying.
