Review: MRQ-16 self-review
Reviewed HEAD: 86fe439172e585456eb629abbc7c34895cebff03
Base: forgejo/master @ 6e869881e2fcb5eaaaf65ac2bc4e5101bb0d5cd2
Verdict: PASS
Findings:
- None.

Review scope:
- Portal routes and UI are session-scoped to the authenticated speaker and constrain event, task, submission, profile, upload, and history reads/writes to that speaker.
- Task rows render and validate acknowledge, form, and file payloads; conditional form fields use the inherited shared evaluator and hidden values are not required.
- Status hero, wave/slot, schedule, handbook, profile/headshot editing, organizer talk-edit override, immutable talk history, fixed task geometry, and honest loading/error/empty states are covered.
- Decision feedback is read-only; no lifecycle mutation is added. AC-240 is exercised in this portal slice while MRQ-11 remains its trace owner.
- AC-233 is included; it was not cut.

Validation:
- npm run pr-gate -- --ticket MRQ-16: PASS; 22.613s; 34 test files and 188 tests passed; worker/client/test types, production build, design contract, and merged AC trace all passed.
- trace:ac: 212 live criteria, 46 test files, 22 claims, 0 uncovered, 0 errors.
- Local wrangler dev + curl: anonymous portal request returned 401 without portal data; demo speaker login returned 200; authenticated portal request returned 200 with the seeded speaker's own profile, submission, wave, and tasks.

The branch is clean at the reviewed HEAD.