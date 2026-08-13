# MRQ-170 implementation plan

## Objective

Allow the submitter of a submitted-but-undecided response to edit it while the CFP is open, with the saved abstract surviving reload and appearing in the organizer's submission record.

## Scope

- Reuse the existing resume-token and authenticated submitter portal authorization seams.
- Expose a visible edit control on `/portal`; keep it present and disabled with an explanation after close or a decision.
- Persist edits through the existing submissions, answers, and audit-log tables; surface the edit in organizer history.
- Keep accepted-speaker editing behavior intact.
- Add regression coverage for persistence, organizer visibility/history, authorization, and unavailable states.

## Non-goals

- No schema migration.
- No deploy or merge.
- No changes to unrelated portal, CRM, or organizer workflows.

## Verification

- Run targeted MRQ-170 integration/UI tests against the seeded Worker.
- Run `npm test` within the 45s budget and classify any unrelated auth failures.
- Run serialized `flock /tmp/marquee-gate.lock -c 'npm run pr-gate'` before opening the PR.
- Capture the exact A/B or running-Worker command used for the ticket comment.

## Handoff

Commit, push, open one GitHub PR against `main`, comment the root cause and verification command on MRQ-170, set the ticket to `pr_open`, and stop for the coordinator/merge warden.
