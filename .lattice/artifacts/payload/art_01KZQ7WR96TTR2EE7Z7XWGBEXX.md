Verdict: PASS
Reviewed commit: 58e6f24a67c83581fc4a2d88405255503b7b58ab
Base: forgejo/master @ 00069f6456e960470b5f017f3287c42bcb524f4e
Scope: canonical Principal/AuthContext reconciliation, D1 session and bearer resolver, event-aware API authorization, API composition wiring, and guardrail integration tests.
Findings: None in the reviewed resolver unit. Invalid or expired credentials fail with API 401; anonymous and cross-event protected reads do not invoke the handler or expose submission data; valid cookie and bearer paths resolve and authorize in-event admin access.
Verification: npx tsc --noEmit; focused resolver suite 5/5; npm test 15 files/75 tests; npm run check:api pass; npm run trace:ac pass; git diff --check pass.
Open integration gate: MRQ-9 is not on forgejo/master yet. After its merge, this branch must rebase and change GET /api/v1/events/{eventId}/submissions from public to admin-authenticated, including MRQ-9's unauthenticated and different-event 403/no-leak assertions. This review covers only the resolver unit and does not waive that gate.