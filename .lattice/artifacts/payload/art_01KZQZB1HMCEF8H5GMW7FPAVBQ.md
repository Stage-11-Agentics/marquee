Final exact-head review: c0c4e98d523a65bd4e2b865cf53a7fc6361d2ecd against forgejo/master 2ebdc89631a35deefbbf2c449bf73a963347b02e.

Rebase review:
- Rebased through current master, including MRQ-31, MRQ-38, and SPEC Amendment 16.
- The prior plan commit was already upstream and was dropped as duplicate.
- No .lattice/** conflict occurred; the upstream plan content was retained.
- The only source conflict was AppShell.tsx; resolution retained upstream import/sessionize routes and the MRQ-30 API token route.
- The existing QuickSearch compatibility fix remains in the final commit.

Security review remains PASS: canonical credential resolver, real issuer membership intersection, organization event boundary, one-time secret/hash-only storage, immediate revocation, and conference restriction are all covered by AC-242 absence assertions and positive controls. No M-54 or AC-241 code is present or claimed. The ratified Amendment 16 six-event list is recorded for the deferred webhook pass.

Fresh validation:
- npm ci completed with 0 vulnerabilities, followed by the requested 20-second settle.
- npm run pr-gate -- --ticket MRQ-30: PASS, elapsedMs 15239, budgetMs 45000.
- 31 Vitest files and 177 tests passed; 47 Node tests passed.
- merged AC trace: 212 live, 0 uncovered, 0 errors.
- Worker/client/test types, production build, design contract, and diff checks passed.
- Remote branch will be verified against this exact head after attachment.